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
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
)

TOOL_ID = "tool-dev-learntube-transcript"
TOOL_METHOD = "youtube.transcript"
MAX_TRANSCRIPT_CHARS = 180_000
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

MANIFEST = {
    "name": TOOL_ID,
    "version": "1.0.1",
    "tools": [
        {
            "name": TOOL_METHOD,
            "description": (
                "Retrieve timestamped captions and public metadata for a YouTube "
                "video so LearnTube can build a source-grounded study workspace."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "YouTube video URL or 11-character ID."},
                    "languages": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Preferred caption language codes, in order.",
                    },
                },
                "required": ["url"],
                "additionalProperties": False,
            },
        }
    ],
}


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
    api = YouTubeTranscriptApi()
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
        transcript = _fetch_transcript(video_id, languages)
        if not transcript["transcript"]:
            return {
                "ok": False,
                "code": "EMPTY_TRANSCRIPT",
                "message": "YouTube returned captions, but they did not contain readable text.",
            }
        return {
            "ok": True,
            "videoId": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            **_metadata(video_id),
            **transcript,
        }
    except TranscriptsDisabled:
        return {"ok": False, "code": "CAPTIONS_DISABLED", "message": "Captions are disabled for this video."}
    except NoTranscriptFound:
        return {"ok": False, "code": "NO_TRANSCRIPT", "message": "No usable captions were found for this video."}
    except VideoUnavailable:
        return {"ok": False, "code": "VIDEO_UNAVAILABLE", "message": "This video is private, unavailable, or region restricted."}
    except (RequestBlocked, IpBlocked):
        return {
            "ok": False,
            "code": "YOUTUBE_BLOCKED",
            "message": "YouTube blocked caption access from the current Anna Agent.",
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


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request: dict[str, Any] = {}
        try:
            request = json.loads(line)
            rpc_method = request.get("method")
            if rpc_method == "describe":
                result = MANIFEST
            elif rpc_method == "health":
                result = {"status": "ready"}
            elif rpc_method == "invoke":
                params = request.get("params") or {}
                result = invoke(str(params.get("tool") or ""), params.get("arguments") or {})
            else:
                raise ValueError(f"unknown rpc: {rpc_method}")
            response = {"jsonrpc": "2.0", "id": request.get("id"), "result": result}
        except Exception as exc:  # noqa: BLE001 - keep stdout protocol valid
            response = {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "error": {"code": -32601, "message": str(exc)},
            }
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
