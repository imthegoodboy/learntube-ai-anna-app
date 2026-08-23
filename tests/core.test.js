import test from "node:test";
import assert from "node:assert/strict";

import {
  extractYouTubeId,
  normalizeLesson,
  parseStructuredJson,
  scheduleCard,
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

test("parseStructuredJson tolerates a fenced model response", () => {
  assert.deepEqual(parseStructuredJson("```json\n{\"ok\":true}\n```"), { ok: true });
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
