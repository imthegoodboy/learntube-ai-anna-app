from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

import my_first_anna_app_plugin as plugin


def test_production_agent_handshake() -> None:
    initialized = plugin.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2.0"},
        }
    )
    assert initialized == {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "protocolVersion": "2.0",
            "serverInfo": {"name": "LearnTube Study Transcript", "version": "1.0.5"},
            "client_capabilities": {},
            "capabilities": {},
        },
    }
    assert plugin.handle_request({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
    assert plugin.handle_request({"jsonrpc": "2.0", "id": 2, "method": "shutdown"}) == {
        "jsonrpc": "2.0",
        "id": 2,
        "result": {"ok": True},
    }


def test_describe_uses_agent_manifest_parameter_shape() -> None:
    described = plugin.handle_request({"jsonrpc": "2.0", "id": 3, "method": "describe"})
    manifest = described["result"]
    assert manifest["display_name"] == "LearnTube Study Transcript"
    assert isinstance(manifest["tools"][0]["parameters"], list)
    assert manifest["tools"][0]["parameters"][0]["name"] == "url"


def test_extract_video_id_supported_shapes() -> None:
    video_id = "UF8uR6Z6KLc"
    assert plugin.extract_video_id(f"https://www.youtube.com/watch?v={video_id}") == video_id
    assert plugin.extract_video_id(f"https://youtu.be/{video_id}") == video_id
    assert plugin.extract_video_id(f"https://youtube.com/shorts/{video_id}") == video_id
    assert plugin.extract_video_id("https://example.com/video") is None


def test_transcript_result_formats_timestamped_evidence() -> None:
    transcript = {
        "transcript": "[00:00] First idea\n[00:04] Second idea",
        "language": "English",
        "languageCode": "en",
        "isGenerated": False,
        "durationSeconds": 8.0,
        "segmentCount": 2,
        "truncated": False,
    }
    with patch.object(plugin, "_fetch_transcript", return_value=transcript), patch.object(
        plugin, "_metadata", return_value={"title": "Lesson", "channel": "Teacher"}
    ):
        result = plugin.transcript_result({"url": "https://youtu.be/UF8uR6Z6KLc"})
    assert result["ok"] is True
    assert result["title"] == "Lesson"
    assert "[00:04]" in result["transcript"]


def test_marketplace_review_video_uses_the_production_transcript_path() -> None:
    transcript = {
        "transcript": "[00:00] Build and publish an Anna app from a working local project.",
        "language": "English",
        "languageCode": "en",
        "isGenerated": False,
        "durationSeconds": 4.0,
        "segmentCount": 1,
        "truncated": False,
        "retrievalMode": "youtube_captions",
    }
    with patch.object(plugin, "_fetch_transcript", return_value=transcript), patch.object(
        plugin,
        "_metadata",
        return_value={
            "title": "Build & Publish Your First Anna App: Step by Step",
            "channel": "Anna",
        },
    ):
        result = plugin.transcript_result(
            {"url": "https://www.youtube.com/watch?v=97BK06JjDmE", "languages": ["en"]}
        )

    assert result["ok"] is True
    assert result["videoId"] == "97BK06JjDmE"
    assert result["retrievalMode"] == "youtube_captions"
    assert result["segmentCount"] == 1


def test_invoke_returns_dispatcher_envelope_for_expected_errors() -> None:
    response = plugin.invoke(plugin.TOOL_METHOD, {"url": "not a youtube url"})
    assert response["success"] is True
    assert response["data"]["code"] == "INVALID_YOUTUBE_URL"


def test_fetch_transcript_falls_back_to_first_available_language() -> None:
    snippets = [SimpleNamespace(text="Hello", start=0.0, duration=2.0)]
    transcript = SimpleNamespace(
        language="Spanish",
        language_code="es",
        is_generated=True,
        fetch=lambda: snippets,
    )

    class TranscriptList:
        def find_transcript(self, _languages):
            raise plugin.NoTranscriptFound("id", ["en"], self)

        def __iter__(self):
            return iter([transcript])

    class Api:
        def list(self, _video_id):
            return TranscriptList()

    with patch.object(plugin, "YouTubeTranscriptApi", return_value=Api()):
        result = plugin._fetch_transcript("UF8uR6Z6KLc", ["en"])
    assert result["languageCode"] == "es"
    assert result["transcript"] == "[00:00] Hello"


def test_bounded_session_adds_finite_timeout_when_library_omits_one() -> None:
    with patch.object(plugin.requests.Session, "request", return_value=object()) as request:
        session = plugin._BoundedSession()
        session.request("GET", "https://example.test/captions")
    assert request.call_args.kwargs["timeout"] == (
        plugin.NETWORK_CONNECT_TIMEOUT_SECONDS,
        plugin.NETWORK_READ_TIMEOUT_SECONDS,
    )


def test_transcript_timeout_returns_a_stable_user_facing_code() -> None:
    with patch.object(
        plugin,
        "_fetch_transcript",
        side_effect=plugin.requests.exceptions.ReadTimeout("caption request stalled"),
    ), patch.object(plugin, "_fetch_edge_transcript", side_effect=TimeoutError("edge stalled")):
        result = plugin.transcript_result({"url": "https://youtu.be/vf-cxgUXcMk"})
    assert result == {
        "ok": False,
        "code": "TRANSCRIPT_TIMEOUT",
        "message": "Caption retrieval timed out while contacting YouTube.",
    }


def test_cloud_ip_block_uses_keyless_caption_edge_fallback() -> None:
    edge_body = b"""# Transcript: Graph traversal lesson

Source video: https://www.youtube.com/watch?v=UF8uR6Z6KLc
Language: en (auto-generated) \xc2\xb7 Duration: 12:34 \xc2\xb7 Words: 4000

## Transcript
[0:02] Breadth-first search visits a graph level by level.
[0:08] Depth-first search explores one branch before backtracking.
"""

    class Response(BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.close()

    with patch.object(plugin, "urlopen", return_value=Response(edge_body)):
        result = plugin._fetch_edge_transcript("UF8uR6Z6KLc", ["en"])

    assert result["retrievalMode"] == "caption_edge_fallback"
    assert result["titleHint"] == "Graph traversal lesson"
    assert result["languageCode"] == "en"
    assert result["durationSeconds"] == 754.0
    assert "Depth-first search" in result["transcript"]


def test_transcript_result_recovers_from_cloud_ip_block() -> None:
    fallback = {
        "transcript": "[0:02] Caption evidence from the resilient route.",
        "language": "en",
        "languageCode": "en",
        "isGenerated": True,
        "durationSeconds": 2.0,
        "segmentCount": 1,
        "truncated": False,
        "titleHint": "Recovered lesson",
        "retrievalMode": "caption_edge_fallback",
    }
    with patch.object(plugin, "_fetch_transcript", side_effect=plugin.IpBlocked("UF8uR6Z6KLc")), patch.object(
        plugin, "_fetch_edge_transcript", return_value=fallback
    ), patch.object(plugin, "_metadata", return_value={"title": "YouTube lesson", "channel": ""}):
        result = plugin.transcript_result({"url": "https://youtu.be/UF8uR6Z6KLc"})

    assert result["ok"] is True
    assert result["title"] == "Recovered lesson"
    assert result["retrievalMode"] == "caption_edge_fallback"
