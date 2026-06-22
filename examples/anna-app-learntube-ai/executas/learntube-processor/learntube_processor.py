#!/usr/bin/env python3
"""LearnTube Processor - Anna Executa JSON-RPC tool.

The tool has two jobs:

1. Best-effort YouTube metadata/transcript extraction.
2. Deterministic learning-artifact generation when Anna LLM is unavailable.

It never claims captions exist when they cannot be fetched. Manual transcript
text supplied by the app is always preferred.
"""

from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any
from xml.etree import ElementTree

USER_AGENT = "LearnTubeAI/0.1 (+https://anna.partners)"
MAX_TRANSCRIPT_CHARS = 24_000
DEFAULT_TIMEOUT = 8


MANIFEST: dict[str, Any] = {
    "name": "tool-nikku696969-learntube-processor-adb7bdym",
    "display_name": "LearnTube Processor",
    "version": "0.1.2",
    "description": "Extracts YouTube lesson metadata/transcripts and creates study artifacts.",
    "author": "Anna Developer",
    "homepage": "https://github.com/imthegoodboy/learntube-ai-anna-app",
    "license": "MIT",
    "tags": ["education", "youtube", "learning", "transcript", "anna-app"],
    "tools": [
        {
            "name": "process_videos",
            "description": "Analyze one or more YouTube URLs and optional transcript text into a learning workspace.",
            "parameters": [
                {
                    "name": "urls",
                    "type": "array",
                    "items_type": "string",
                    "required": False,
                    "default": [],
                    "description": "YouTube video or playlist URLs.",
                },
                {
                    "name": "manual_transcript",
                    "type": "string",
                    "required": False,
                    "default": "",
                    "description": "Optional user-pasted transcript or notes. Preferred over fetched captions.",
                },
                {
                    "name": "goal",
                    "type": "string",
                    "required": False,
                    "default": "",
                    "description": "Learner goal, e.g. DSA interview readiness.",
                },
                {
                    "name": "days",
                    "type": "integer",
                    "required": False,
                    "default": 30,
                    "description": "Planning timeframe in days.",
                },
            ],
        },
        {
            "name": "answer_question",
            "description": "Answer a learner question from provided workspace evidence only.",
            "parameters": [
                {
                    "name": "workspace",
                    "type": "object",
                    "required": True,
                    "description": "Compact workspace evidence from the app.",
                },
                {
                    "name": "question",
                    "type": "string",
                    "required": True,
                    "description": "Learner question.",
                },
            ],
        },
    ],
    "runtime": {"type": "uv", "min_version": "0.1.0"},
}


@dataclass
class VideoInfo:
    url: str
    video_id: str
    title: str
    transcript: str
    transcript_source: str
    warnings: list[str]


def _http_get(url: str, timeout: int = DEFAULT_TIMEOUT) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - user-provided public URLs only
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def _extract_video_id(url: str) -> str:
    text = (url or "").strip()
    if not text:
        return ""
    parsed = urllib.parse.urlparse(text)
    if parsed.netloc.endswith("youtu.be"):
        return parsed.path.strip("/").split("/")[0]
    qs = urllib.parse.parse_qs(parsed.query)
    if "v" in qs and qs["v"]:
        return qs["v"][0]
    match = re.search(r"(?:embed|shorts)/([A-Za-z0-9_-]{6,})", parsed.path)
    return match.group(1) if match else ""


def _fetch_title(url: str, video_id: str) -> str:
    try:
        noembed = "https://noembed.com/embed?" + urllib.parse.urlencode({"url": url})
        data = json.loads(_http_get(noembed))
        title = data.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
    except Exception:
        pass
    return f"YouTube lesson {video_id}" if video_id else "Untitled YouTube lesson"


def _extract_json_after_marker(page: str, marker: str) -> dict[str, Any] | None:
    idx = page.find(marker)
    if idx < 0:
        return None
    start = page.find("{", idx)
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(page)):
        ch = page[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(page[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _caption_tracks(player_response: dict[str, Any]) -> list[dict[str, Any]]:
    captions = player_response.get("captions") or {}
    renderer = captions.get("playerCaptionsTracklistRenderer") or {}
    tracks = renderer.get("captionTracks") or []
    return [track for track in tracks if isinstance(track, dict) and track.get("baseUrl")]


def _parse_xml_transcript(text: str) -> str:
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return ""
    segments = []
    for elem in root.iter():
        if elem.tag.endswith("text") and elem.text:
            segments.append(html.unescape(elem.text).strip())
    return " ".join(segment for segment in segments if segment)


def _parse_json3_transcript(text: str) -> str:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return ""
    parts: list[str] = []
    for event in data.get("events") or []:
        segs = event.get("segs") or []
        for seg in segs:
            value = seg.get("utf8")
            if isinstance(value, str):
                parts.append(value.strip())
    return " ".join(part for part in parts if part)


def _fetch_transcript(url: str) -> tuple[str, str, list[str]]:
    warnings: list[str] = []
    try:
        page = _http_get(url, timeout=DEFAULT_TIMEOUT + 4)
    except Exception as exc:  # noqa: BLE001
        return "", "none", [f"Could not fetch YouTube page: {exc}"]

    player = _extract_json_after_marker(page, "ytInitialPlayerResponse")
    if not player:
        return "", "none", ["Could not locate YouTube player response."]

    tracks = _caption_tracks(player)
    if not tracks:
        return "", "none", ["No public caption track was found. Paste transcript for stronger results."]

    preferred = sorted(
        tracks,
        key=lambda item: (
            0 if (item.get("languageCode") or "").startswith("en") else 1,
            0 if item.get("kind") != "asr" else 1,
        ),
    )[0]
    base = html.unescape(preferred["baseUrl"])
    for fmt in ("json3", ""):
        transcript_url = base + ("&fmt=json3" if fmt and "fmt=" not in base else "")
        try:
            raw = _http_get(transcript_url, timeout=DEFAULT_TIMEOUT + 4)
            transcript = _parse_json3_transcript(raw) if fmt else _parse_xml_transcript(raw)
            transcript = re.sub(r"\s+", " ", transcript).strip()
            if transcript:
                return transcript[:MAX_TRANSCRIPT_CHARS], "youtube_captions", warnings
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Caption fetch failed ({fmt or 'xml'}): {exc}")
    return "", "none", warnings or ["Caption track existed but could not be parsed."]


def _collect_video_info(urls: list[str], manual_transcript: str) -> list[VideoInfo]:
    infos: list[VideoInfo] = []
    for raw_url in urls[:8]:
        video_id = _extract_video_id(raw_url)
        title = _title_from_manual(manual_transcript) if manual_transcript else _fetch_title(raw_url, video_id)
        transcript = ""
        source = "none"
        warnings: list[str] = []
        if not manual_transcript:
            transcript, source, warnings = _fetch_transcript(raw_url)
        infos.append(
            VideoInfo(
                url=raw_url,
                video_id=video_id,
                title=title,
                transcript=transcript,
                transcript_source=source,
                warnings=warnings,
            )
        )
    if not infos and manual_transcript:
        infos.append(
            VideoInfo(
                url="manual transcript",
                video_id="manual",
                title="Manual lesson notes",
                transcript="",
                transcript_source="manual",
                warnings=[],
            )
        )
    return infos


def _title_from_manual(manual_transcript: str) -> str:
    text = (manual_transcript or "").lower()
    if "binary search" in text:
        return "Binary Search Explained"
    if "sorting" in text:
        return "Sorting Patterns"
    if "system design" in text:
        return "System Design Lesson"
    if "javascript" in text or "react" in text:
        return "JavaScript Lesson"
    if "ai" in text or "llm" in text:
        return "Applied AI Lesson"
    return "Manual YouTube Lesson"


def _infer_domain(text: str, title: str) -> tuple[str, str, str, list[str]]:
    joined = f"{title}\n{text}".lower()
    if "binary search" in joined or "lower bound" in joined:
        return "DSA", "Binary Search", "Beginner", ["Sorted arrays", "Loops", "Indexes"]
    if "sorting" in joined or "merge sort" in joined or "quick sort" in joined:
        return "DSA", "Sorting", "Beginner", ["Arrays", "Comparators", "Recursion"]
    if "system design" in joined or "load balancer" in joined:
        return "System Design", "Scalable Architecture", "Intermediate", ["HTTP", "Databases", "Caching"]
    if "javascript" in joined or "react" in joined:
        return "JavaScript", "Frontend Engineering", "Beginner", ["HTML", "CSS", "Functions"]
    if "ai" in joined or "llm" in joined or "prompt" in joined:
        return "AI", "Applied AI", "Intermediate", ["APIs", "Tokens", "Evaluation"]
    return "Learning", "Core Concepts", "Beginner", ["Basic vocabulary", "Examples", "Practice"]


def _sentences(text: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    return [part.strip() for part in parts if len(part.strip()) > 12]


def _keyword_phrases(text: str, subtopic: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9+-]{2,}", text.lower())
    stop = {
        "the",
        "and",
        "that",
        "this",
        "with",
        "from",
        "into",
        "when",
        "then",
        "your",
        "they",
        "what",
        "about",
        "video",
        "lesson",
        "because",
        "should",
    }
    counts: dict[str, int] = {}
    for word in words:
        if word not in stop:
            counts[word] = counts.get(word, 0) + 1
    ranked = sorted(counts, key=lambda item: (-counts[item], item))[:6]
    base = [subtopic] + [word.replace("-", " ").title() for word in ranked]
    return list(dict.fromkeys(base))[:6]


def _workspace_from_text(infos: list[VideoInfo], manual_transcript: str, goal: str, days: int) -> dict[str, Any]:
    title = infos[0].title if infos else "Learning workspace"
    transcript = manual_transcript.strip() or " ".join(info.transcript for info in infos if info.transcript)
    if not transcript:
        transcript = (
            f"{title}. No transcript was available, so this workspace is a cautious outline. "
            "Paste transcript text to make notes and quiz evidence stronger."
        )

    topic, subtopic, difficulty, prereqs = _infer_domain(transcript, title)
    sentences = _sentences(transcript)
    snippets = (sentences[:8] or [transcript[:220]])[:8]
    keywords = _keyword_phrases(transcript, subtopic)
    first = snippets[0] if snippets else f"{subtopic} is the central concept."
    summary = _summary_for(subtopic, first, transcript)
    workspace_id = "lt-" + uuid.uuid5(uuid.NAMESPACE_URL, title + transcript[:200]).hex[:12]
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    return {
        "id": workspace_id,
        "title": title,
        "sourceLabel": infos[0].url if infos else "manual transcript",
        "videoIds": [info.video_id for info in infos if info.video_id],
        "topic": topic,
        "subtopic": subtopic,
        "difficulty": difficulty,
        "goal": goal or "Learning plan",
        "days": max(1, min(365, int(days or 30))),
        "summary": summary,
        "prerequisites": prereqs,
        "transcriptSnippets": snippets,
        "chapters": _chapters(subtopic, snippets),
        "detailedNotes": _notes(subtopic, snippets, keywords),
        "flashcards": _flashcards(subtopic, keywords, summary),
        "quiz": _quiz(subtopic, topic),
        "actionItems": _actions(subtopic, topic),
        "roadmap": _roadmap(topic, subtopic),
        "weakConcepts": _weak_concepts(subtopic),
        "codeExample": _code_example(subtopic),
        "nextRevisionLabel": "1 day",
        "createdAt": now,
        "transcriptSource": "manual" if manual_transcript.strip() else (infos[0].transcript_source if infos else "none"),
        "warnings": [w for info in infos for w in info.warnings],
    }


def _summary_for(subtopic: str, first: str, transcript: str) -> str:
    lower = f"{subtopic}\n{transcript}".lower()
    if "binary search" in lower:
        return "Binary search cuts a sorted search space in half after each comparison. The main work is keeping the boundaries correct until the target is found or the range is empty."
    if "sorting" in lower:
        return "Sorting rearranges data into an order that makes later operations, such as searching or grouping, easier to reason about."
    if "system design" in lower or "load balancer" in lower:
        return "The lesson explains how components share load, store data, and keep a service reliable as traffic grows."
    return first[:260]


def _chapters(subtopic: str, snippets: list[str]) -> list[dict[str, str]]:
    labels = ["Core idea", "Walkthrough", "Edge cases", "Practice"]
    return [
        {
            "time": f"{index * 2:02d}:{(index * 17) % 60:02d}",
            "title": labels[index] if index < len(labels) else f"{subtopic} detail",
            "note": snippets[index] if index < len(snippets) else f"Review how {subtopic} changes with examples.",
        }
        for index in range(min(4, max(1, len(labels))))
    ]


def _notes(subtopic: str, snippets: list[str], keywords: list[str]) -> list[dict[str, Any]]:
    return [
        {
            "heading": "What to remember",
            "points": snippets[:3] or [f"{subtopic} is the main concept in this lesson."],
        },
        {
            "heading": "Concept map",
            "points": [f"{keywords[i]} connects to {keywords[i + 1]}." for i in range(max(0, min(3, len(keywords) - 1)))]
            or [f"Map {subtopic} to examples, mistakes, and practice tasks."],
        },
        {
            "heading": "Watch-outs",
            "points": _weak_concepts(subtopic),
        },
    ]


def _flashcards(subtopic: str, keywords: list[str], summary: str) -> list[dict[str, str]]:
    cards = [
        {"id": "card-main", "front": f"What is {subtopic}?", "back": summary},
        {"id": "card-why", "front": f"Why does {subtopic} matter?", "back": f"It gives you a repeatable way to solve the lesson's core problem."},
        {"id": "card-mistake", "front": f"What is an easy mistake with {subtopic}?", "back": _weak_concepts(subtopic)[0]},
    ]
    for i, key in enumerate(keywords[1:3], start=1):
        cards.append({"id": f"card-key-{i}", "front": f"How does {key} fit?", "back": f"{key} is one supporting idea in the {subtopic} workspace."})
    return cards[:5]


def _quiz(subtopic: str, topic: str) -> list[dict[str, Any]]:
    if subtopic == "Binary Search":
        return [
            {
                "id": "quiz-time",
                "question": "What is binary search's usual time complexity?",
                "choices": ["O(n)", "O(log n)", "O(n^2)", "O(1)"],
                "answerIndex": 1,
                "concept": "Complexity",
                "explanation": "The search range is cut roughly in half at each comparison.",
            },
            {
                "id": "quiz-condition",
                "question": "What condition must the array satisfy?",
                "choices": ["It must be sorted", "It must contain no duplicates", "It must be small", "It must be reversed"],
                "answerIndex": 0,
                "concept": "Prerequisites",
                "explanation": "Binary search relies on sorted order to discard half the search space.",
            },
            {
                "id": "quiz-bound",
                "question": "If the middle value is too small, what moves?",
                "choices": ["The right boundary moves left", "The left boundary moves right", "Both boundaries reset", "The target changes"],
                "answerIndex": 1,
                "concept": "Boundary updates",
                "explanation": "Everything at or left of the middle is too small, so the left boundary moves right.",
            },
        ]
    return [
        {
            "id": "quiz-main",
            "question": f"What is the main topic of this workspace?",
            "choices": [subtopic, "Database indexing", "CSS layout", "OAuth setup"],
            "answerIndex": 0,
            "concept": subtopic,
            "explanation": f"The workspace is organized around {subtopic}.",
        },
        {
            "id": "quiz-practice",
            "question": "What should you do after studying the notes?",
            "choices": ["Close the app", "Practice with examples", "Skip revision", "Delete history"],
            "answerIndex": 1,
            "concept": "Practice",
            "explanation": "Recall and practice turn passive watching into retained knowledge.",
        },
        {
            "id": "quiz-topic",
            "question": "Which track does this lesson belong to?",
            "choices": [topic, "Cooking", "Travel", "Finance"],
            "answerIndex": 0,
            "concept": "Classification",
            "explanation": f"The detected topic is {topic}.",
        },
    ]


def _actions(subtopic: str, topic: str) -> list[dict[str, str]]:
    return [
        {
            "id": "action-practice",
            "title": f"Solve three {subtopic} practice prompts",
            "reason": "Recall needs application, not rereading.",
            "effort": "30 min",
        },
        {
            "id": "action-cheat",
            "title": "Write a one-page cheat sheet",
            "reason": "Compression reveals missing understanding.",
            "effort": "15 min",
        },
        {
            "id": "action-revision",
            "title": "Schedule spaced revision",
            "reason": "Revisit after 1, 3, and 7 days.",
            "effort": "5 min",
        },
        {
            "id": "action-next",
            "title": f"Queue the next {topic} topic",
            "reason": "Keeps the roadmap moving.",
            "effort": "10 min",
        },
    ]


def _roadmap(topic: str, subtopic: str) -> list[dict[str, str]]:
    if topic == "DSA":
        titles = ["Arrays", subtopic, "Sorting", "Recursion", "Trees", "Graphs"]
    elif topic == "System Design":
        titles = ["HTTP basics", subtopic, "Caching", "Queues", "Databases", "Observability"]
    elif topic == "AI":
        titles = ["Prompts", subtopic, "Evaluation", "Retrieval", "Agents", "Deployment"]
    else:
        titles = ["Vocabulary", subtopic, "Examples", "Practice", "Revision", "Project"]
    return [
        {
            "id": f"node-{re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-') or i}",
            "title": title,
            "note": _roadmap_note(title),
            "status": "done" if i == 0 else "current" if title == subtopic else "next" if i < 4 else "locked",
        }
        for i, title in enumerate(titles)
    ]


def _roadmap_note(title: str) -> str:
    return {
        "Arrays": "Understand index-based access and traversal.",
        "Sorting": "Prepare data for ordered reasoning.",
        "Recursion": "Build divide-and-conquer intuition.",
        "Trees": "Move from linear to hierarchical search.",
        "Graphs": "Model relationships and traversal.",
    }.get(title, f"Study {title} with examples and recall prompts.")


def _weak_concepts(subtopic: str) -> list[str]:
    if subtopic == "Binary Search":
        return ["Boundary updates", "Lower bound", "Sorted input assumption"]
    if subtopic == "Sorting":
        return ["Stability", "Partitioning", "Big-O tradeoffs"]
    if subtopic == "Scalable Architecture":
        return ["Bottlenecks", "Caching tradeoffs", "Failure modes"]
    return [f"{subtopic} vocabulary", "Transfer to practice", "Revision timing"]


def _code_example(subtopic: str) -> str:
    if subtopic == "Binary Search":
        return "\n".join(
            [
                "while left <= right:",
                "    mid = (left + right) // 2",
                "    if nums[mid] == target: return mid",
                "    if nums[mid] < target: left = mid + 1",
                "    else: right = mid - 1",
            ]
        )
    return f"1. Explain {subtopic}\n2. Recall it without notes\n3. Solve one fresh example\n4. Schedule revision"


def process_videos(
    urls: list[str] | None = None,
    manual_transcript: str = "",
    goal: str = "",
    days: int = 30,
) -> dict[str, Any]:
    safe_urls = [str(url).strip() for url in (urls or []) if str(url).strip()]
    transcript = str(manual_transcript or "")[:MAX_TRANSCRIPT_CHARS]
    infos = _collect_video_info(safe_urls, transcript)
    workspace = _workspace_from_text(infos, transcript, str(goal or ""), int(days or 30))
    return {"workspace": workspace, "videos": [info.__dict__ for info in infos]}


def answer_question(workspace: dict[str, Any], question: str) -> dict[str, str]:
    evidence = json.dumps(workspace or {}, ensure_ascii=False).lower()
    q = (question or "").lower()
    title = (workspace or {}).get("title") or "this lesson"
    summary = (workspace or {}).get("summary") or ""
    weak = (workspace or {}).get("quizWeakConcepts") or []
    if "weak" in q or "revise" in q:
        focus = ", ".join(weak[:3]) if weak else "the concepts you marked hard or missed in quiz mode"
        answer = f"From {title}, revise {focus}. Start with a flashcard pass, then answer two quiz questions without notes."
    elif "like" in q and ("10" in q or "child" in q):
        answer = f"Think of {title} as a step-by-step rule. {summary} Use the first example, then try one tiny version yourself."
    elif summary:
        answer = f"From the available lesson evidence: {summary}"
    else:
        answer = "I do not have enough lesson evidence to answer. Paste the transcript or generate a workspace first."
    if not evidence.strip() or len(evidence) < 80:
        answer += " Evidence is thin, so treat this as a cautious answer."
    return {"answer": answer}


TOOL_DISPATCH = {
    "process_videos": process_videos,
    "answer_question": answer_question,
}


def _make_response(req_id: Any, *, result: Any = None, error: dict[str, Any] | None = None) -> dict[str, Any]:
    out = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        out["error"] = error
    else:
        out["result"] = result
    return out


def handle_describe(_params: dict[str, Any]) -> dict[str, Any]:
    return MANIFEST


def handle_health(_params: dict[str, Any]) -> dict[str, Any]:
    return {"status": "ok", "version": MANIFEST["version"], "timestamp": time.time()}


def handle_invoke(params: dict[str, Any]) -> dict[str, Any]:
    tool_name = params.get("tool")
    args = params.get("arguments") or {}
    if not isinstance(args, dict):
        return {"success": False, "error": "`arguments` must be an object"}
    fn = TOOL_DISPATCH.get(tool_name)
    if not fn:
        return {"success": False, "error": f"unknown tool: {tool_name!r}"}
    try:
        return {"success": True, "data": fn(**args)}
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


METHOD_DISPATCH = {
    "describe": handle_describe,
    "health": handle_health,
    "invoke": handle_invoke,
}


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    print("[learntube-processor] ready", file=sys.stderr)
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            send(_make_response(None, error={"code": -32700, "message": f"parse error: {exc}"}))
            continue
        method = request.get("method")
        req_id = request.get("id")
        params = request.get("params") or {}
        handler = METHOD_DISPATCH.get(method)
        if not handler:
            send(_make_response(req_id, error={"code": -32601, "message": f"method not found: {method}"}))
            continue
        try:
            send(_make_response(req_id, result=handler(params)))
        except Exception as exc:  # noqa: BLE001
            send(_make_response(req_id, error={"code": -32000, "message": str(exc)}))


if __name__ == "__main__":
    main()
