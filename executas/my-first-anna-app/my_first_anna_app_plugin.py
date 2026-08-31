"""Anna Executa for retrieving public YouTube captions.

The App keeps LLM and persistence calls on Anna's Host API. This process does
one job the Host API does not currently provide: turn a public YouTube URL into
timestamped caption evidence for the learner's workspace.
"""

from __future__ import annotations

import html
import json
import re
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen

import requests
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
)

TOOL_ID = "tool-nikku696969-learntube-study-transcript-ujzngt7x"
TOOL_METHOD = "youtube.transcript"
MAX_TRANSCRIPT_CHARS = 180_000
MAX_EDGE_RESPONSE_BYTES = 2_000_000
EDGE_TRANSCRIPT_ORIGIN = "https://youtube-transcript.ai"
NETWORK_CONNECT_TIMEOUT_SECONDS = 8
NETWORK_READ_TIMEOUT_SECONDS = 20
EDGE_TIMEOUT_SECONDS = 25
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

MANIFEST = {
    "name": TOOL_ID,
    "display_name": "LearnTube Study Transcript",
    "version": "1.0.5",
    "description": (
        "Retrieves public YouTube captions and metadata for source-grounded "
        "LearnTube AI lessons."
    ),
    "author": "LearnTube AI",
    "tools": [
        {
            "name": TOOL_METHOD,
            "description": (
                "Retrieve timestamped captions and public metadata for a YouTube "
                "video so LearnTube can build a source-grounded study workspace."
            ),
            "parameters": [
                {
                    "name": "url",
                    "type": "string",
                    "description": "YouTube video URL or 11-character ID.",
                    "required": True,
                },
                {
                    "name": "languages",
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Preferred caption language codes, in order.",
                    "required": False,
                    "default": ["en"],
                },
            ],
        }
    ],
}


class _BoundedSession(requests.Session):
    """Give every youtube-transcript-api request a finite connect/read budget."""

    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        kwargs.setdefault(
            "timeout",
            (NETWORK_CONNECT_TIMEOUT_SECONDS, NETWORK_READ_TIMEOUT_SECONDS),
        )
        return super().request(method, url, **kwargs)


def extract_video_id(value: str) -> str | None:
    """Return an 11-character ID for standard YouTube URL shapes."""

    raw = (value or "").strip()
    if YOUTUBE_ID_RE.fullmatch(raw):
        return raw

    try:
        parsed = urlparse(raw)
    except ValueError:
        return None

    host = (parsed.hostname or "").lower().removeprefix("www.")
    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
        return candidate if YOUTUBE_ID_RE.fullmatch(candidate) else None
    if not host.endswith("youtube.com"):
        return None

    query_id = parse_qs(parsed.query).get("v", [""])[0]
    if YOUTUBE_ID_RE.fullmatch(query_id):
        return query_id
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 2 and parts[0] in {"embed", "shorts", "live", "v"}:
        return parts[1] if YOUTUBE_ID_RE.fullmatch(parts[1]) else None
    return None


def _timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def _metadata(video_id: str) -> dict[str, str]:
    """Read public title/channel via YouTube's no-key oEmbed endpoint."""

    watch_url = f"https://www.youtube.com/watch?v={video_id}"
    endpoint = f"https://www.youtube.com/oembed?url={quote(watch_url, safe='')}&format=json"
    request = Request(endpoint, headers={"User-Agent": "LearnTube-Anna/1.0"})
    try:
        with urlopen(request, timeout=8) as response:  # noqa: S310 - fixed YouTube endpoint
            payload = json.loads(response.read().decode("utf-8"))
        return {
            "title": str(payload.get("title") or "YouTube lesson").strip(),
            "channel": str(payload.get("author_name") or "").strip(),
        }
    except (OSError, ValueError, json.JSONDecodeError):
        return {"title": "YouTube lesson", "channel": ""}


def _fetch_transcript(video_id: str, preferred_languages: list[str]) -> dict[str, Any]:
    # The library's default requests session has no timeout. On a Cloud Agent,
    # that can leave a caption lookup hanging until Anna kills the whole tool.
    api = YouTubeTranscriptApi(http_client=_BoundedSession())
    transcript_list = api.list(video_id)
    transcript = None
    if preferred_languages:
        try:
            transcript = transcript_list.find_transcript(preferred_languages)
        except NoTranscriptFound:
            transcript = None
    if transcript is None:
        transcript = next(iter(transcript_list), None)
    if transcript is None:
        raise NoTranscriptFound(video_id, preferred_languages, transcript_list)

    fetched = transcript.fetch()
    lines: list[str] = []
    duration_seconds = 0.0
    truncated = False
    for snippet in fetched:
        text = re.sub(r"\s+", " ", html.unescape(snippet.text or "")).strip()
        if not text:
            continue
        line = f"[{_timestamp(snippet.start)}] {text}"
        if sum(len(existing) + 1 for existing in lines) + len(line) > MAX_TRANSCRIPT_CHARS:
            truncated = True
            break
        lines.append(line)
        duration_seconds = max(duration_seconds, float(snippet.start) + float(snippet.duration))

    return {
        "transcript": "\n".join(lines),
        "language": transcript.language,
        "languageCode": transcript.language_code,
        "isGenerated": bool(transcript.is_generated),
        "durationSeconds": round(duration_seconds, 2),
        "segmentCount": len(lines),
        "truncated": truncated,
        "retrievalMode": "youtube_captions",
    }


def _duration_from_header(header: str) -> float:
    match = re.search(r"\bDuration:\s*((?:\d+:){1,2}\d+)\b", header, flags=re.IGNORECASE)
    if not match:
        return 0.0
    parts = [int(part) for part in match.group(1).split(":")]
    if len(parts) == 2:
        minutes, seconds = parts
        return float(minutes * 60 + seconds)
    hours, minutes, seconds = parts
    return float(hours * 3600 + minutes * 60 + seconds)


def _fetch_edge_transcript(video_id: str, preferred_languages: list[str]) -> dict[str, Any]:
    """Fetch a public transcript through a caption edge cache.

    YouTube frequently blocks datacenter IPs even for public caption tracks.
    The edge route is used only after that specific block and keeps the App's
    URL flow functional on Anna Cloud Agents without an API key or user OAuth.
    """

    preferred = next((language for language in preferred_languages if language), "")
    query = f"?{urlencode({'lang': preferred})}" if preferred else ""
    endpoint = f"{EDGE_TRANSCRIPT_ORIGIN}/transcript/{video_id}.txt{query}"
    request = Request(
        endpoint,
        headers={
            "Accept": "text/markdown,text/plain;q=0.9",
            "User-Agent": "LearnTube-Anna/1.0 (+https://anna.partners)",
        },
    )
    with urlopen(request, timeout=EDGE_TIMEOUT_SECONDS) as response:  # noqa: S310 - fixed HTTPS origin
        body = response.read(MAX_EDGE_RESPONSE_BYTES + 1)

    truncated = len(body) > MAX_EDGE_RESPONSE_BYTES
    text = body[:MAX_EDGE_RESPONSE_BYTES].decode("utf-8", errors="replace").strip()
    if "## Transcript" not in text:
        raise ValueError("caption edge response did not contain a transcript")

    header, transcript_text = text.split("## Transcript", 1)
    transcript_text = transcript_text.strip()
    if len(transcript_text) < 40:
        raise ValueError("caption edge response was empty")

    title_match = re.search(r"^#\s*Transcript:\s*(.+)$", header, flags=re.MULTILINE)
    language_match = re.search(r"^Language:\s*([^\s(·]+)", header, flags=re.MULTILINE | re.IGNORECASE)
    language_code = language_match.group(1).strip() if language_match else preferred
    is_generated = bool(re.search(r"auto-generated", header, flags=re.IGNORECASE))
    segment_count = sum(1 for line in transcript_text.splitlines() if line.strip())

    return {
        "transcript": transcript_text[:MAX_TRANSCRIPT_CHARS],
        "language": language_code or "Unknown",
        "languageCode": language_code,
        "isGenerated": is_generated,
        "durationSeconds": _duration_from_header(header),
        "segmentCount": segment_count,
        "truncated": truncated or len(transcript_text) > MAX_TRANSCRIPT_CHARS,
        "titleHint": title_match.group(1).strip() if title_match else "",
        "retrievalMode": "caption_edge_fallback",
    }


def transcript_result(args: dict[str, Any]) -> dict[str, Any]:
    video_id = extract_video_id(str(args.get("url") or ""))
    if not video_id:
        return {
            "ok": False,
            "code": "INVALID_YOUTUBE_URL",
            "message": "That does not look like a valid YouTube video link.",
        }

    raw_languages = args.get("languages")
    languages = [str(item).strip() for item in raw_languages or ["en"] if str(item).strip()][:8]
    try:
        try:
            transcript = _fetch_transcript(video_id, languages)
        except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable):
            raise
        except Exception:  # YouTube uses several changing block/network error classes.
            transcript = _fetch_edge_transcript(video_id, languages)
        if not transcript["transcript"]:
            return {
                "ok": False,
                "code": "EMPTY_TRANSCRIPT",
                "message": "YouTube returned captions, but they did not contain readable text.",
            }
        metadata = _metadata(video_id)
        if metadata["title"] == "YouTube lesson" and transcript.get("titleHint"):
            metadata["title"] = str(transcript["titleHint"])
        return {
            "ok": True,
            "videoId": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            **metadata,
            **transcript,
        }
    except TranscriptsDisabled:
        return {"ok": False, "code": "CAPTIONS_DISABLED", "message": "Captions are disabled for this video."}
    except NoTranscriptFound:
        return {"ok": False, "code": "NO_TRANSCRIPT", "message": "No usable captions were found for this video."}
    except VideoUnavailable:
        return {"ok": False, "code": "VIDEO_UNAVAILABLE", "message": "This video is private, unavailable, or region restricted."}
    except (requests.exceptions.Timeout, TimeoutError):
        return {
            "ok": False,
            "code": "TRANSCRIPT_TIMEOUT",
            "message": "Caption retrieval timed out while contacting YouTube.",
        }
    except (RequestBlocked, IpBlocked, HTTPError, URLError):
        return {
            "ok": False,
            "code": "YOUTUBE_BLOCKED",
            "message": "The public caption services could not reach this video. Please retry in a moment.",
        }
    except Exception as exc:  # noqa: BLE001 - protocol boundary must return a stable envelope
        return {
            "ok": False,
            "code": "TRANSCRIPT_ERROR",
            "message": f"Caption retrieval failed: {type(exc).__name__}.",
        }


def invoke(method: str, args: dict[str, Any]) -> dict[str, Any]:
    if method == TOOL_METHOD:
        return {"success": True, "data": transcript_result(args)}
    return {"success": False, "error": f"unknown method: {method}"}


def handle_request(request: dict[str, Any]) -> dict[str, Any] | None:
    """Handle one Executa JSON-RPC message.

    Production Anna Agents negotiate the protocol with ``initialize`` before
    requesting ``describe``. Notifications do not receive a response.
    """

    rpc_method = request.get("method")
    request_id = request.get("id")
    params = request.get("params") or {}

    if rpc_method == "initialize":
        offered_protocol = str(params.get("protocolVersion") or "1.1")
        protocol_version = offered_protocol if offered_protocol in {"1.1", "2.0"} else "2.0"
        result = {
            "protocolVersion": protocol_version,
            "serverInfo": {"name": MANIFEST["display_name"], "version": MANIFEST["version"]},
            "client_capabilities": {},
            "capabilities": {},
        }
    elif rpc_method == "describe":
        result = MANIFEST
    elif rpc_method == "health":
        result = {"status": "healthy", "version": MANIFEST["version"]}
    elif rpc_method == "invoke":
        result = invoke(str(params.get("tool") or ""), params.get("arguments") or {})
    elif rpc_method == "shutdown":
        result = {"ok": True}
    else:
        if request_id is None:
            return None
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"Method not found: {rpc_method}"},
        }

    if request_id is None:
        return None
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise TypeError("request must be a JSON object")
            response = handle_request(request)
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Parse error: {exc}"},
            }
        if response is None:
            continue
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
