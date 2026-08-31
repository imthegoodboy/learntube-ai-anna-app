import test from "node:test";
import assert from "node:assert/strict";

import {
  extractYouTubeId,
  groundedMentorFallback,
  mentorAnswerText,
  normalizeLesson,
  parseLessonCoreText,
  parseStructuredJson,
  sampledSourceEvidence,
  scheduleCard,
  sourceGroundedLessonFallback,
  splitSource,
  transcriptToolErrorMessage,
  touchStudyDay,
} from "../bundle/core.js";
import { createCheatSheetPdf } from "../bundle/pdf.js";

test("extractYouTubeId accepts supported URL forms and rejects other hosts", () => {
  const id = "UF8uR6Z6KLc";
  assert.equal(extractYouTubeId(`https://www.youtube.com/watch?v=${id}&t=3`), id);
  assert.equal(extractYouTubeId(`https://youtu.be/${id}`), id);
  assert.equal(extractYouTubeId(`https://youtube.com/shorts/${id}`), id);
  assert.equal(extractYouTubeId(`https://youtube.com/embed/${id}`), id);
  assert.equal(extractYouTubeId("https://example.com/watch?v=UF8uR6Z6KLc"), null);
});

test("extractYouTubeId accepts the Marketplace review video", () => {
  assert.equal(
    extractYouTubeId("https://www.youtube.com/watch?v=97BK06JjDmE"),
    "97BK06JjDmE",
  );
});

test("parseStructuredJson tolerates a fenced model response", () => {
  assert.deepEqual(parseStructuredJson("```json\n{\"ok\":true}\n```"), { ok: true });
});

test("groundedMentorFallback answers from the closest lesson evidence", () => {
  const lesson = {
    keyIdeas: [{
      heading: "BFS Data Structure",
      explanation: "Breadth-first search uses a FIFO queue so earlier discovered nodes are explored first.",
      example: "Neighbors 1 and 3 are processed in insertion order.",
      evidenceQuote: "for BFS traversal a queue data structure is used",
    }],
  };
  const answer = groundedMentorFallback(lesson, "Why does BFS use a queue instead of a stack?");
  assert.match(answer, /FIFO queue/);
  assert.match(answer, /Source cue/);
});

test("groundedMentorFallback refuses unrelated questions", () => {
  const lesson = { keyIdeas: [{ heading: "BFS", explanation: "Breadth-first traversal uses a queue." }] };
  assert.match(groundedMentorFallback(lesson, "Explain quantum entanglement"), /not covered in this lesson/i);
});

test("mentorAnswerText keeps a normal plain-text mentor reply", () => {
  const answer = mentorAnswerText(
    "BFS uses a queue so it can explore the graph one layer at a time.",
    { title: "Graph search", keyIdeas: [] },
    "How does BFS work?",
  );
  assert.equal(answer, "BFS uses a queue so it can explore the graph one layer at a time.");
});

test("mentorAnswerText unwraps a structured answer field", () => {
  const answer = mentorAnswerText(
    '{"answer":"DFS follows one branch deeply before backtracking."}',
    { title: "Graph search", keyIdeas: [] },
    "How does DFS work?",
  );
  assert.equal(answer, "DFS follows one branch deeply before backtracking.");
});

test("mentorAnswerText replaces lesson-shaped JSON with saved evidence", () => {
  const lesson = {
    title: "Graph search",
    keyIdeas: [{
      heading: "BFS Data Structure",
      explanation: "Breadth-first search uses a FIFO queue.",
      evidenceQuote: "BFS requires a queue data structure",
    }],
  };
  const accidentalWorkspace = JSON.stringify({
    title: "Wrong fixture lesson",
    summary: "Unrelated generated content.",
    keyIdeas: [],
    flashcards: [],
    quiz: [],
  });
  const answer = mentorAnswerText(accidentalWorkspace, lesson, "Why does BFS use a queue?");
  assert.match(answer, /FIFO queue/);
  assert.doesNotMatch(answer, /Wrong fixture lesson|flashcards|quiz/);
});

test("mentorAnswerText gives greetings a lesson-aware welcome", () => {
  const answer = mentorAnswerText(
    '{"title":"Unexpected lesson JSON","flashcards":[]}',
    { title: "Graph search", keyIdeas: [] },
    "Hey",
  );
  assert.match(answer, /Graph search/);
  assert.match(answer, /explain, compare, recap, or quiz/i);
  assert.doesNotMatch(answer, /Unexpected lesson JSON/);
});

test("normalizeLesson validates generated collections and initializes progress", () => {
  const lesson = normalizeLesson(
    {
      title: "A lesson",
      summary: "A grounded summary.",
      keyIdeas: [{ heading: "Idea", explanation: "Explanation" }],
      flashcards: [{ front: "Question", back: "Answer", concept: "Idea" }],
      quiz: [{ question: "Which?", options: ["A", "B"], answerIndex: 1, concept: "Idea" }],
      actions: ["Practice"],
      roadmap: [{ title: "Next", why: "It follows", minutes: 20 }],
    },
    { type: "transcript", text: "Evidence", label: "Transcript" },
    new Date("2026-08-23T00:00:00.000Z"),
  );
  assert.equal(lesson.flashcards[0].id, "card-1");
  assert.equal(lesson.quiz[0].answerIndex, 1);
  assert.deepEqual(lesson.progress.weakConcepts, {});
  assert.equal(lesson.roadmap[0].minutes, 20);
});

test("normalizeLesson recovers a quiz answer supplied as option text", () => {
  const lesson = normalizeLesson(
    {
      title: "Line graph lesson",
      summary: "A concise lesson.",
      keyIdeas: [{ heading: "Chart insertion", explanation: "Use the Insert tab." }],
      flashcards: [{ front: "Where?", back: "Insert tab", concept: "Chart insertion" }],
      quiz: [{
        question: "Where is the line graph inserted?",
        options: ["Home tab", "Insert tab", "Data tab", "View tab"],
        answer: "Insert tab",
      }],
    },
    { type: "youtube", text: "Evidence", title: "Line graph lesson" },
    new Date("2026-08-23T00:00:00.000Z"),
  );
  assert.equal(lesson.quiz[0].answerIndex, 1);
  assert.equal(lesson.quiz[0].options[lesson.quiz[0].answerIndex], "Insert tab");
  assert.ok(lesson.quiz.length >= 1);
});

test("normalizeLesson derives source-grounded practice when the model omits collections", () => {
  const objectives = [
    "Differentiate breadth-first and depth-first traversal.",
    "Match breadth-first search with a queue.",
    "Match depth-first search with a stack.",
  ];
  const lesson = normalizeLesson(
    {
      title: "Graph traversal",
      summary: "Breadth-first and depth-first search traverse a graph in different orders.",
      objectives,
      keyIdeas: [],
      flashcards: [],
      quiz: [],
    },
    { type: "youtube", text: "Caption evidence", title: "Graph traversal" },
    new Date("2026-08-23T00:00:00.000Z"),
  );

  assert.equal(lesson.keyIdeas.length, 3);
  assert.equal(lesson.flashcards.length, 3);
  assert.equal(lesson.quiz.length, 3);
  assert.equal(lesson.actions.length, 3);
  assert.equal(lesson.roadmap.length, 3);
  assert.equal(lesson.cheatSheet.essentials.length, 3);
  assert.equal(lesson.cheatSheet.workflow.length, 3);
  assert.ok(lesson.cheatSheet.traps.length >= 1);
  assert.equal(lesson.suggestedQuestions.length, 3);
  assert.deepEqual(lesson.flashcards.map((card) => card.back), objectives);
  for (const question of lesson.quiz) {
    assert.equal(question.options[question.answerIndex], question.explanation);
    assert.ok(objectives.includes(question.explanation));
  }
});

test("normalizeLesson completes promised practice counts from rich grounded ideas", () => {
  const keyIdeas = Array.from({ length: 4 }, (_, index) => ({
    heading: `Idea ${index + 1}`,
    explanation: `Grounded explanation ${index + 1}`,
    example: `Grounded example ${index + 1}`,
    watchOut: `Grounded warning ${index + 1}`,
    evidenceQuote: `Source cue ${index + 1}`,
  }));
  const lesson = normalizeLesson(
    {
      title: "Rich lesson",
      summary: "A compact source-grounded lesson.",
      keyIdeas,
      flashcards: [],
      quiz: [],
      actions: [],
      roadmap: [],
    },
    { type: "youtube", text: "Caption evidence", title: "Rich lesson" },
    new Date("2026-08-23T00:00:00.000Z"),
  );

  assert.equal(lesson.keyIdeas.length, 4);
  assert.equal(lesson.flashcards.length, 6);
  assert.equal(lesson.quiz.length, 5);
  assert.equal(lesson.actions.length, 3);
  assert.equal(lesson.roadmap.length, 3);
  assert.ok(lesson.quiz.every((question) => question.options.length === 4));
  assert.ok(lesson.quiz.every((question) => question.options[question.answerIndex] === question.explanation));
});

test("sourceGroundedLessonFallback stays usable when Anna returns no visible text", () => {
  const source = {
    type: "youtube",
    title: "A real lesson",
    label: "A real lesson · Teacher",
    text: "[00:00] First supported explanation has enough detail to become a useful lesson excerpt. [01:00] Second supported explanation has enough detail to become another useful excerpt. [02:00] Third supported explanation adds a procedure grounded in the transcript. [03:00] Fourth supported explanation closes the lesson with a warning grounded in the transcript.",
  };
  const core = sourceGroundedLessonFallback(source);
  const lesson = normalizeLesson(core, source, new Date("2026-08-31T00:00:00.000Z"));
  assert.equal(lesson.title, "A real lesson");
  assert.equal(lesson.keyIdeas.length, 4);
  assert.equal(lesson.flashcards.length, 6);
  assert.ok(lesson.summary.includes("supported explanation"));
});

test("parseLessonCoreText reads the compact non-JSON lesson protocol", () => {
  const parsed = parseLessonCoreText([
    "TITLE: Absolute Value Graphs",
    "SOURCE: YouTube lesson",
    "SUMMARY: One. Two. Three.",
    "OBJECTIVES: Plot a graph || Find its range || Explain a reflection",
    "IDEA1: Parent graph || It is V-shaped. || Plot (0,0). || Keep symmetry. || looks like a v",
    "IDEA2: Reflections || An outside negative flips it. || y=-|x| || Inside does not flip. || reflect over x-axis",
    "IDEA3: Shifts || Inside moves horizontally. || x-3 moves right. || Check the sign. || shift three units",
    "IDEA4: Range || Opening sets the bound. || [2,infinity) || Include the vertex. || zero is included",
  ].join("\n"));
  assert.equal(parsed.title, "Absolute Value Graphs");
  assert.equal(parsed.objectives.length, 3);
  assert.equal(parsed.keyIdeas.length, 4);
  assert.equal(parsed.keyIdeas[1].heading, "Reflections");
});

test("sampledSourceEvidence keeps compact beginning-to-end transcript coverage", () => {
  const transcript = Array.from({ length: 40 }, (_, index) =>
    `[${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}] caption ${index} explains source point ${index}`,
  ).join("\n");
  const sample = sampledSourceEvidence(transcript, 8);
  assert.ok(sample.length < transcript.length);
  assert.match(sample, /caption 0|caption 1/);
  assert.match(sample, /caption 3[5-9]/);
  assert.equal(sample.split("\n").length, 8);
});

test("scheduleCard spaces easy recalls and keeps hard cards close", () => {
  const now = new Date("2026-08-23T10:00:00.000Z");
  const first = scheduleCard(null, "easy", now);
  const second = scheduleCard(first, "easy", now);
  const hard = scheduleCard(second, "hard", now);
  assert.equal(first.intervalDays, 1);
  assert.equal(second.intervalDays, 3);
  assert.equal(hard.intervalDays, 2);
});

test("touchStudyDay increments only for consecutive local dates", () => {
  const first = touchStudyDay({}, new Date(2026, 7, 22, 12));
  const same = touchStudyDay(first, new Date(2026, 7, 22, 18));
  const next = touchStudyDay(same, new Date(2026, 7, 23, 9));
  assert.equal(first.streak, 1);
  assert.equal(same.streak, 1);
  assert.equal(next.streak, 2);
});

test("splitSource respects boundaries and a maximum chunk count", () => {
  const source = Array.from({ length: 40 }, (_, index) => `Sentence ${index}.`).join("\n");
  const chunks = splitSource(source, 80, 3);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.length > 0));
});

test("createCheatSheetPdf produces a complete one-page PDF document", async () => {
  const pdf = createCheatSheetPdf({
    title: "Active recall",
    sourceLabel: "Pasted transcript",
    createdAt: "2026-08-23T00:00:00.000Z",
    summary: "Retrieve an idea before looking at the source.",
    cheatSheet: {
      headline: "Retrieve, check, correct, repeat.",
      essentials: ["Recognition is not recall"],
      workflow: ["Close the source", "Explain the idea", "Correct gaps"],
      traps: ["Mistaking familiarity for mastery"],
    },
  });
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const content = new TextDecoder().decode(bytes);
  assert.equal(pdf.type, "application/pdf");
  assert.ok(bytes.length > 800);
  assert.ok(content.startsWith("%PDF-1.4"));
  assert.ok(content.endsWith("%%EOF"));
  assert.match(content, /\/Count 1/);
});

test("transcriptToolErrorMessage hides deployment internals and gives a recovery path", () => {
  const message = transcriptToolErrorMessage(
    new Error("executa 'tool-secret-id' is not deployed on the selected agent"),
  );
  assert.doesNotMatch(message, /tool-secret-id/);
  assert.match(message, /Update or reinstall LearnTube AI/);
  assert.match(message, /Paste transcript/);
});

test("transcriptToolErrorMessage explains stable caption failure codes", () => {
  assert.match(transcriptToolErrorMessage({ code: "CAPTIONS_DISABLED" }), /Captions are disabled/);
  assert.match(transcriptToolErrorMessage({ code: "NO_TRANSCRIPT" }), /No usable captions/);
  assert.match(transcriptToolErrorMessage({ code: "VIDEO_UNAVAILABLE" }), /private, unavailable, or region restricted/);
  assert.match(transcriptToolErrorMessage({ code: "YOUTUBE_BLOCKED" }), /current Agent/);
  assert.match(transcriptToolErrorMessage({ code: "TRANSCRIPT_TIMEOUT" }), /timed out/);
});
