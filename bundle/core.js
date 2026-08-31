export const STATE_VERSION = 1;
export const APP_INDEX_KEY = "learntube/index";
export const APP_PROFILE_KEY = "learntube/profile";
export const LESSON_KEY_PREFIX = "learntube/lessons/";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeId(value) {
  const raw = String(value || "").trim();
  if (YOUTUBE_ID.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] || "";
    return YOUTUBE_ID.test(id) ? id : null;
  }

  if (!host.endsWith("youtube.com")) return null;
  const candidates = [
    url.searchParams.get("v"),
    ...url.pathname.split("/").filter(Boolean).slice(1),
  ];
  return candidates.find((candidate) => YOUTUBE_ID.test(candidate || "")) || null;
}

export function stripCodeFence(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

export function parseStructuredJson(value) {
  const text = stripCodeFence(value);
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("The model response did not contain a JSON object.");
  }
}

export function cleanText(value, fallback = "") {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text || fallback;
}

export function cleanStringArray(value, limit = 12) {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item)).filter(Boolean).slice(0, limit)
    : [];
}

function cleanObjectArray(value, mapper, limit) {
  return Array.isArray(value)
    ? value.map(mapper).filter(Boolean).slice(0, limit)
    : [];
}

export function normalizeLesson(raw, source, now = new Date()) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const title = cleanText(safe.title, cleanText(source.title, "Untitled lesson"));
  const summary = cleanText(safe.summary);
  const objectives = cleanStringArray(safe.objectives, 6);
  let keyIdeas = cleanObjectArray(
    safe.keyIdeas,
    (item) => {
      if (!item || typeof item !== "object") return null;
      const heading = cleanText(item.heading);
      const explanation = cleanText(item.explanation);
      if (!heading && !explanation) return null;
      return {
        heading: heading || "Key idea",
        explanation,
        example: cleanText(item.example),
        watchOut: cleanText(item.watchOut),
        evidenceQuote: cleanText(item.evidenceQuote),
      };
    },
    7,
  );

  if (!keyIdeas.length) {
    const ideaSeeds = objectives.length
      ? objectives
      : summary.split(/(?<=[.!?])\s+/).map((item) => cleanText(item)).filter(Boolean);
    keyIdeas = ideaSeeds.slice(0, 6).map((text) => ({
      heading: cleanText(text.split(/\s+/).slice(0, 8).join(" ").replace(/[.,;:!?]+$/, ""), "Key idea"),
      explanation: text,
      example: "",
      watchOut: "",
      evidenceQuote: "",
    }));
  }

  let flashcards = cleanObjectArray(
    safe.flashcards,
    (item, index) => {
      if (!item || typeof item !== "object") return null;
      const front = cleanText(item.front);
      const back = cleanText(item.back);
      if (!front || !back) return null;
      return {
        id: `card-${index + 1}`,
        front,
        back,
        concept: cleanText(item.concept, front),
      };
    },
    14,
  );

  if (!flashcards.length) {
    flashcards = keyIdeas.slice(0, 10).map((idea, index) => ({
      id: `card-${index + 1}`,
      front: `Explain: ${idea.heading}`,
      back: idea.explanation,
      concept: idea.heading,
    }));
  }

  let quiz = cleanObjectArray(
    safe.quiz,
    (item, index) => {
      if (!item || typeof item !== "object") return null;
      const question = cleanText(item.question);
      const options = cleanStringArray(item.options, 4);
      const rawIndex = Number(item.answerIndex);
      const answerIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < options.length
        ? rawIndex
        : 0;
      if (!question || options.length < 2) return null;
      return {
        id: `question-${index + 1}`,
        question,
        options,
        answerIndex,
        explanation: cleanText(item.explanation),
        concept: cleanText(item.concept, question),
      };
    },
    10,
  );

  if (!quiz.length) {
    const answers = [...new Set(flashcards.map((card) => card.back).filter(Boolean))];
    quiz = flashcards.slice(0, 6).map((card, index) => {
      const distractors = answers.filter((answer) => answer !== card.back).slice(0, 3);
      const options = [card.back, ...distractors];
      if (options.length < 2) options.push("This point is not supported by the lesson.");
      const answerIndex = index % options.length;
      options.splice(answerIndex, 0, options.shift());
      return {
        id: `question-${index + 1}`,
        question: `Which answer best explains “${card.concept}”?`,
        options,
        answerIndex,
        explanation: card.back,
        concept: card.concept,
      };
    });
  }

  let actions = cleanObjectArray(
    safe.actions,
    (item) => {
      if (typeof item === "string") return { text: cleanText(item), dueHint: "" };
      if (!item || typeof item !== "object") return null;
      const text = cleanText(item.text);
      return text ? { text, dueHint: cleanText(item.dueHint) } : null;
    },
    8,
  );

  let roadmap = cleanObjectArray(
    safe.roadmap,
    (item) => {
      if (!item || typeof item !== "object") return null;
      const stepTitle = cleanText(item.title);
      if (!stepTitle) return null;
      const minutes = Math.max(1, Math.min(180, Number(item.minutes) || 10));
      return { title: stepTitle, why: cleanText(item.why), minutes };
    },
    8,
  );

  // The host may stop a long JSON response at its output-token ceiling. Keep
  // every declared workspace surface useful in that case by deriving concise
  // practice items from the model's already-grounded ideas/objectives. These
  // are not invented lesson facts; they are study prompts about content that
  // is already present in the normalized lesson.
  const practiceSeeds = keyIdeas.length
    ? keyIdeas
    : objectives.map((text) => ({ heading: cleanText(text), explanation: cleanText(text) }));

  if (!actions.length) {
    actions = practiceSeeds.slice(0, 5).map((idea, index) => ({
      text: `Explain “${idea.heading}” from memory, then check each claim against the lesson evidence.`,
      dueHint: index === 0 ? "Start today" : "Next study session",
    }));
  }

  if (!roadmap.length) {
    roadmap = practiceSeeds.slice(0, 5).map((idea, index) => ({
      title: idea.heading || `Lesson idea ${index + 1}`,
      why: idea.explanation
        ? `Review this source-grounded idea before moving on: ${idea.explanation}`
        : "Review this source-grounded idea before moving on.",
      minutes: 15,
    }));
  }

  const cheat = safe.cheatSheet && typeof safe.cheatSheet === "object" ? safe.cheatSheet : {};
  const fallbackEssentials = practiceSeeds
    .map((idea) => [idea.heading, idea.explanation].filter(Boolean).join(": "))
    .filter(Boolean)
    .slice(0, 6);
  const fallbackWorkflow = [
    "Read one key idea and its source evidence.",
    "Close the source and explain the idea from memory.",
    "Reopen the source and correct any unsupported or missing detail.",
  ];
  const fallbackTraps = keyIdeas.map((idea) => cleanText(idea.watchOut)).filter(Boolean).slice(0, 6);
  if (!fallbackTraps.length) fallbackTraps.push("Do not add claims that are not supported by this lesson.");
  const suggestedQuestions = cleanStringArray(safe.suggestedQuestions, 5);
  if (!suggestedQuestions.length) {
    suggestedQuestions.push(...practiceSeeds.slice(0, 5).map((idea) =>
      `Can you explain “${idea.heading}” using the evidence and example from this lesson?`));
  }
  const createdAt = now.toISOString();
  const id = source.id || createId(now.getTime());

  return {
    version: STATE_VERSION,
    id,
    createdAt,
    updatedAt: createdAt,
    title,
    sourceType: source.type,
    sourceUrl: cleanText(source.url),
    sourceLabel: cleanText(safe.sourceLabel, cleanText(source.label, source.type === "youtube" ? "YouTube lesson" : "Pasted transcript")),
    sourceText: String(source.text || "").trim(),
    sourceLanguage: cleanText(source.language),
    sourceTruncated: Boolean(source.truncated),
    durationSeconds: Math.max(0, Number(source.durationSeconds) || 0),
    summary,
    objectives,
    keyIdeas,
    flashcards,
    quiz,
    actions,
    roadmap,
    cheatSheet: {
      headline: cleanText(cheat.headline, summary),
      essentials: cleanStringArray(cheat.essentials, 8).length
        ? cleanStringArray(cheat.essentials, 8)
        : fallbackEssentials,
      workflow: cleanStringArray(cheat.workflow, 8).length
        ? cleanStringArray(cheat.workflow, 8)
        : fallbackWorkflow,
      traps: cleanStringArray(cheat.traps, 6).length
        ? cleanStringArray(cheat.traps, 6)
        : fallbackTraps,
    },
    suggestedQuestions,
    progress: {
      cards: {},
      quizAnswers: {},
      weakConcepts: {},
      actionsDone: {},
      mentor: [],
      quizRuns: 0,
      quizBest: 0,
    },
  };
}

export function createId(seed = Date.now()) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `lesson-${seed}-${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultProfile() {
  return {
    version: STATE_VERSION,
    xp: 0,
    streak: 0,
    lastStudyDate: null,
    lessonsCreated: 0,
    questionsAnswered: 0,
    cardsReviewed: 0,
  };
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function touchStudyDay(profile, now = new Date()) {
  const next = { ...defaultProfile(), ...(profile || {}) };
  const today = localDateKey(now);
  if (next.lastStudyDate === today) return next;

  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateKey(yesterdayDate);
  next.streak = next.lastStudyDate === yesterday ? Math.max(1, next.streak + 1) : 1;
  next.lastStudyDate = today;
  return next;
}

export function scheduleCard(previous, rating, now = new Date()) {
  const current = previous && typeof previous === "object" ? previous : {};
  const priorInterval = Math.max(0, Number(current.intervalDays) || 0);
  const priorReps = Math.max(0, Number(current.reps) || 0);
  const isEasy = rating === "easy";
  let intervalDays;
  let reps;

  if (isEasy) {
    reps = priorReps + 1;
    intervalDays = priorReps === 0 ? 1 : priorReps === 1 ? 3 : Math.max(4, Math.round(priorInterval * 2.2));
  } else {
    reps = Math.max(0, priorReps - 1);
    intervalDays = Math.max(1, Math.round(priorInterval * 0.6) || 1);
  }

  const due = new Date(now);
  due.setDate(due.getDate() + intervalDays);
  return {
    rating: isEasy ? "easy" : "hard",
    reps,
    intervalDays,
    reviewedAt: now.toISOString(),
    dueAt: due.toISOString(),
  };
}

export function isDue(review, now = new Date()) {
  if (!review?.dueAt) return true;
  return new Date(review.dueAt).getTime() <= now.getTime();
}

export function dueCardCount(lesson, now = new Date()) {
  if (!lesson) return 0;
  return lesson.flashcards.filter((card) => isDue(lesson.progress?.cards?.[card.id], now)).length;
}

export function weakConceptList(lesson) {
  const entries = Object.entries(lesson?.progress?.weakConcepts || {});
  return entries
    .map(([concept, misses]) => ({ concept, misses: Number(misses) || 0 }))
    .filter((item) => item.concept && item.misses > 0)
    .sort((a, b) => b.misses - a.misses);
}

export function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  if (!value) return "Unknown length";
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function splitSource(text, chunkSize = 22000, maxChunks = 7) {
  const clean = String(text || "").trim();
  if (!clean) return [];
  const chunks = [];
  let cursor = 0;
  while (cursor < clean.length && chunks.length < maxChunks) {
    let end = Math.min(clean.length, cursor + chunkSize);
    if (end < clean.length) {
      const boundary = Math.max(clean.lastIndexOf("\n", end), clean.lastIndexOf(". ", end));
      if (boundary > cursor + chunkSize * 0.65) end = boundary + 1;
    }
    chunks.push(clean.slice(cursor, end).trim());
    cursor = end;
  }
  return chunks.filter(Boolean);
}

export function lessonMatches(lesson, query) {
  const needle = cleanText(query).toLowerCase();
  if (!needle) return true;
  const haystack = [
    lesson?.title,
    lesson?.summary,
    lesson?.sourceLabel,
    ...(lesson?.keyIdeas || []).map((idea) => idea.heading),
  ].join(" ").toLowerCase();
  return haystack.includes(needle);
}

const MENTOR_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "by", "do", "does",
  "for", "from", "how", "i", "in", "instead", "is", "it", "of", "on", "or",
  "that", "the", "this", "to", "use", "uses", "what", "when", "where", "which",
  "why", "with",
]);

function mentorTerms(value) {
  return (String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((term) => term.length > 1 && !MENTOR_STOP_WORDS.has(term));
}

export function groundedMentorFallback(lesson, question) {
  const queryTerms = new Set(mentorTerms(question));
  const ideas = Array.isArray(lesson?.keyIdeas) ? lesson.keyIdeas : [];
  const ranked = ideas.map((idea, index) => {
    const text = [idea.heading, idea.explanation, idea.example, idea.watchOut].join(" ");
    const score = mentorTerms(text).reduce((total, term) => total + (queryTerms.has(term) ? 1 : 0), 0);
    return { idea, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const best = ranked[0];
  if (!best || best.score === 0) {
    return "That is not covered in this lesson. Try asking about one of the key ideas shown in the lesson notes.";
  }

  const answer = [String(best.idea.explanation || "").trim()];
  if (best.idea.example) answer.push(`Lesson example: ${String(best.idea.example).trim()}`);
  if (best.idea.evidenceQuote) answer.push(`Source cue: “${String(best.idea.evidenceQuote).trim()}”`);
  return answer.filter(Boolean).join("\n\n");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function clampText(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

export function transcriptToolErrorMessage(error) {
  const message = String(error?.message || error || "").trim();
  if (/not deployed on the selected agent|not installed on the selected agent/i.test(message)) {
    return "The transcript helper is not ready on this Anna Agent yet. Update or reinstall LearnTube AI for this agent, then retry—or choose Paste transcript to continue now.";
  }
  if (/timed?\s*out|timeout/i.test(message)) {
    return "The transcript helper took too long to respond. Retry once, or choose Paste transcript to continue now.";
  }
  return message
    ? `${message} You can still use this lesson by choosing Paste transcript.`
    : "The transcript helper could not run. Retry, or choose Paste transcript to continue now.";
}
