from __future__ import annotations

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
            "serverInfo": {"name": "LearnTube Study Transcript", "version": "1.0.3"},
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
