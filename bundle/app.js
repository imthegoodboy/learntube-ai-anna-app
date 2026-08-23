import {
  APP_INDEX_KEY,
  APP_PROFILE_KEY,
  LESSON_KEY_PREFIX,
  clampText,
  defaultProfile,
  dueCardCount,
  escapeHtml,
  extractYouTubeId,
  isDue,
  lessonMatches,
  normalizeLesson,
  parseStructuredJson,
  scheduleCard,
  splitSource,
  transcriptToolErrorMessage,
  touchStudyDay,
  weakConceptList,
} from "./core.js";
import { downloadCheatSheet } from "./pdf.js";

const EXECUTA_HANDLE = "youtube-transcript";
const DEV_FALLBACK_TOOL_ID = "tool-dev-learntube-transcript";
const TRANSCRIPT_TOOL_ID = window.__ANNA_TOOL_IDS__?.[EXECUTA_HANDLE] || DEV_FALLBACK_TOOL_ID;
const MAX_MENTOR_EVIDENCE = 34000;
const MAX_PERSISTED_SOURCE = 170000;

const page = document.getElementById("page");
const pageTitle = document.getElementById("page-title");
const pageEyebrow = document.getElementById("page-eyebrow");
const lessonSwitcher = document.getElementById("lesson-switcher");
const lessonSelect = document.getElementById("active-lesson-select");
const syncStrip = document.getElementById("sync-strip");
const syncCopy = document.getElementById("sync-copy");
const toast = document.getElementById("toast");
const busyLayer = document.getElementById("busy-layer");
const busyTitle = document.getElementById("busy-title");
const busyDetail = document.getElementById("busy-detail");
const busyProgress = document.getElementById("busy-progress");

const state = {
  anna: null,
  connected: false,
  lessons: [],
  activeLessonId: null,
  profile: defaultProfile(),
  captureMode: "youtube",
  cardFlipped: false,
  quiz: null,
  mentorPendingLessonId: null,
  generating: false,
  cancelRequested: false,
  toastTimer: null,
};

const routeMeta = {
  capture: { eyebrow: "NEW LESSON", title: "Turn watch time into recall." },
  notes: { eyebrow: "SMART NOTES", title: "The lesson, made memorable." },
  cards: { eyebrow: "ACTIVE RECALL", title: "Make your memory do the work." },
  quiz: { eyebrow: "CHECK UNDERSTANDING", title: "Find the gaps worth fixing." },
  roadmap: { eyebrow: "NEXT STEPS", title: "Move from knowing to doing." },
  mentor: { eyebrow: "GROUNDED MENTOR", title: "Ask the lesson, not the internet." },
  library: { eyebrow: "YOUR LIBRARY", title: "Everything you chose to learn." },
};

function route() {
  const value = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return routeMeta[value] ? value : "capture";
}

function activeLesson() {
  return state.lessons.find((lesson) => lesson.id === state.activeLessonId) || null;
}

function setSync(status, copy) {
  syncStrip.dataset.state = status;
  syncCopy.textContent = copy;
}

function showToast(message, duration = 3200) {
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

function setBusy(title, detail, progress = 10) {
  state.generating = true;
  busyLayer.hidden = false;
  busyTitle.textContent = title;
  busyDetail.textContent = detail;
  busyProgress.style.width = `${Math.max(5, Math.min(100, progress))}%`;
}

function updateBusy(detail, progress) {
  busyDetail.textContent = detail;
  busyProgress.style.width = `${Math.max(5, Math.min(100, progress))}%`;
}

function clearBusy() {
  state.generating = false;
  state.cancelRequested = false;
  busyLayer.hidden = true;
  busyProgress.style.width = "10%";
}

function assertNotCancelled() {
  if (state.cancelRequested) throw new Error("Generation cancelled.");
}

function readLocalState() {
  try {
    const raw = localStorage.getItem("learntube/standalone");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalState() {
  localStorage.setItem("learntube/standalone", JSON.stringify({
    lessons: state.lessons,
    activeLessonId: state.activeLessonId,
    profile: state.profile,
  }));
}

async function storageGet(key) {
  if (!state.anna) return undefined;
  const response = await state.anna.storage.get({ key });
  const result = response?.result ?? response;
  return result?.exists === false ? undefined : result?.value;
}

async function storageSet(key, value) {
  if (!state.anna) {
    writeLocalState();
    return;
  }
  await state.anna.storage.set({ key, value });
}

async function storageDelete(key) {
  if (!state.anna) {
    writeLocalState();
    return;
  }
  try {
    await state.anna.storage.delete({ key });
  } catch (error) {
    if (!String(error?.code || error?.message || error).includes("not_found")) throw error;
  }
}

function lessonIndex() {
  return {
    version: 1,
    activeLessonId: state.activeLessonId,
    lessonIds: state.lessons.map((lesson) => lesson.id),
  };
}

async function saveIndex() {
  await storageSet(APP_INDEX_KEY, lessonIndex());
}

async function saveProfile() {
  setSync("saving", "Saving study progress…");
  await storageSet(APP_PROFILE_KEY, state.profile);
  setSync(state.connected ? "ready" : "offline", state.connected ? "Synced with Anna Storage" : "Saved on this device");
  renderRailStats();
}

async function saveLesson(lesson) {
  lesson.updatedAt = new Date().toISOString();
  setSync("saving", "Saving lesson…");
  await storageSet(`${LESSON_KEY_PREFIX}${lesson.id}`, lesson);
  await saveIndex();
  setSync(state.connected ? "ready" : "offline", state.connected ? "Synced with Anna Storage" : "Saved on this device");
}

async function hydrate() {
  if (!state.anna) {
    const local = readLocalState();
    state.lessons = Array.isArray(local?.lessons) ? local.lessons : [];
    state.activeLessonId = local?.activeLessonId || state.lessons[0]?.id || null;
    state.profile = { ...defaultProfile(), ...(local?.profile || {}) };
    return;
  }

  const [index, profile] = await Promise.all([
    storageGet(APP_INDEX_KEY),
    storageGet(APP_PROFILE_KEY),
  ]);
  const ids = Array.isArray(index?.lessonIds) ? index.lessonIds : [];
  const lessons = await Promise.all(ids.map((id) => storageGet(`${LESSON_KEY_PREFIX}${id}`)));
  state.lessons = lessons.filter((lesson) => lesson && typeof lesson === "object");
  state.activeLessonId = state.lessons.some((lesson) => lesson.id === index?.activeLessonId)
    ? index.activeLessonId
    : state.lessons[0]?.id || null;
  state.profile = { ...defaultProfile(), ...(profile || {}) };
}

function renderRailStats() {
  document.getElementById("rail-xp").textContent = `${state.profile.xp || 0} XP`;
  const streak = state.profile.streak || 0;
  document.getElementById("rail-streak").textContent = `${streak} day${streak === 1 ? "" : "s"} streak`;
}

function renderLessonSwitcher() {
  lessonSwitcher.hidden = state.lessons.length === 0;
  lessonSelect.innerHTML = state.lessons
    .map((lesson) => `<option value="${escapeHtml(lesson.id)}"${lesson.id === state.activeLessonId ? " selected" : ""}>${escapeHtml(clampText(lesson.title, 55))}</option>`)
    .join("");
}

function renderNav(current) {
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    if (link.dataset.routeLink === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function emptyLessonPage(current) {
  const messages = {
    notes: ["No notes yet.", "Capture a YouTube lesson or paste a transcript. LearnTube will build the notes from that source."],
    cards: ["Nothing to recall—yet.", "Create a lesson first, then return here to train the ideas that matter."],
    quiz: ["Your first question needs a source.", "Build a lesson and the quiz will target its actual concepts."],
    roadmap: ["Start with a lesson.", "Your action list and next-topic roadmap will be generated from what the source actually teaches."],
    mentor: ["The mentor needs evidence.", "Create or choose a lesson so every answer can stay grounded in its source."],
  };
  const [heading, copy] = messages[current] || messages.notes;
  return `<div class="empty-page">
    <div class="empty-mark" aria-hidden="true">↳</div>
    <h2>${escapeHtml(heading)}</h2>
    <p>${escapeHtml(copy)}</p>
    <div class="button-row"><a class="primary-button" href="#/capture">Capture a lesson</a></div>
  </div>`;
}

function render() {
  const current = route();
  const meta = routeMeta[current];
  pageEyebrow.textContent = meta.eyebrow;
  pageTitle.textContent = meta.title;
  renderNav(current);
  renderRailStats();
  renderLessonSwitcher();
  state.cardFlipped = current === "cards" ? state.cardFlipped : false;

  const lesson = activeLesson();
  if (!lesson && !["capture", "library"].includes(current)) {
    page.innerHTML = emptyLessonPage(current);
    return;
  }

  const renderer = {
    capture: renderCapture,
    notes: renderNotes,
    cards: renderCards,
    quiz: renderQuiz,
    roadmap: renderRoadmap,
    mentor: renderMentor,
    library: renderLibrary,
  }[current];
  page.innerHTML = renderer(lesson);
}

function renderCapture() {
  const totalDue = state.lessons.reduce((count, lesson) => count + dueCardCount(lesson), 0);
  const transcriptSelected = state.captureMode === "transcript";
  return `<div class="capture-grid">
    <div>
      <p class="lede">Paste a captioned YouTube link or the transcript itself. Your Anna model turns only that evidence into notes, practice, and a plan.</p>
      <div class="source-tabs" role="tablist" aria-label="Lesson source">
        <button type="button" role="tab" data-action="source-tab" data-mode="youtube" aria-selected="${!transcriptSelected}">YouTube link</button>
        <button type="button" role="tab" data-action="source-tab" data-mode="transcript" aria-selected="${transcriptSelected}">Paste transcript</button>
      </div>
      <form id="capture-form">
        <div class="source-panel" role="tabpanel" ${transcriptSelected ? "hidden" : ""}>
          <label class="field-label" for="youtube-url">YouTube URL</label>
          <input class="line-input" id="youtube-url" name="youtubeUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://youtube.com/watch?v=…" />
          <p class="field-help"><span>Public video with captions</span><span>No YouTube API key required</span></p>
        </div>
        <div class="source-panel" role="tabpanel" ${transcriptSelected ? "" : "hidden"}>
          <label class="field-label" for="transcript-text">Transcript</label>
          <textarea class="source-textarea" id="transcript-text" name="transcript" placeholder="Paste the spoken lesson here…"></textarea>
          <p class="field-help"><span>At least 120 characters</span><span id="transcript-count">0 characters</span></p>
        </div>
        <div class="button-row">
          <button class="primary-button" type="submit">Build my study workspace</button>
          ${state.lessons.length ? '<a class="text-button" href="#/library">Open library</a>' : ""}
        </div>
      </form>

      <div class="micro-stats" aria-label="Learning progress">
        <div class="micro-stat"><strong>${state.lessons.length}</strong><span>saved lessons</span></div>
        <div class="micro-stat"><strong>${totalDue}</strong><span>cards due</span></div>
        <div class="micro-stat"><strong>${state.profile.xp || 0}</strong><span>earned XP</span></div>
      </div>
    </div>
    <aside class="proof-note" aria-label="What LearnTube creates">
      <strong>One source.<br />Six ways to learn.</strong>
      <ol>
        <li>Explainable smart notes</li>
        <li>Spaced-repetition cards</li>
        <li>Weak-concept quiz</li>
        <li>Practical action list</li>
        <li>Grounded mentor chat</li>
        <li>One-page PDF recap</li>
      </ol>
    </aside>
  </div>`;
}

function renderNotes(lesson) {
  const ideas = lesson.keyIdeas.map((idea) => `<article class="idea">
    <div>
      <h3>${escapeHtml(idea.heading)}</h3>
      <p>${escapeHtml(idea.explanation)}</p>
      ${(idea.example || idea.watchOut) ? `<div class="idea-detail">
        ${idea.example ? `<div><strong>Example</strong>${escapeHtml(idea.example)}</div>` : ""}
        ${idea.watchOut ? `<div><strong>Watch out</strong>${escapeHtml(idea.watchOut)}</div>` : ""}
      </div>` : ""}
      ${idea.evidenceQuote ? `<p class="source-citation">Source cue: “${escapeHtml(idea.evidenceQuote)}”</p>` : ""}
    </div>
  </article>`).join("");

  return `<div class="notes-grid">
    <div>
      <section class="summary-block">
        <p class="section-label">THE SHORT VERSION</p>
        <h2>${escapeHtml(lesson.title)}</h2>
        <p>${escapeHtml(lesson.summary)}</p>
      </section>
      <section class="idea-list" aria-label="Key ideas">${ideas || '<p class="muted">No key ideas were returned for this source.</p>'}</section>
    </div>
    <aside>
      <div class="sticker-note">
        <strong>By the end, you should be able to…</strong>
        <ul>${lesson.objectives.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Explain the lesson in your own words.</li>"}</ul>
      </div>
      <div class="button-row no-print">
        <button class="secondary-button" type="button" data-action="download-pdf">Download cheat-sheet PDF</button>
        <a class="text-button" href="#/cards">Review ${lesson.flashcards.length} cards</a>
      </div>
      <p class="source-citation">Built from ${escapeHtml(lesson.sourceLabel)}${lesson.sourceLanguage ? ` · ${escapeHtml(lesson.sourceLanguage)}` : ""}${lesson.sourceTruncated ? " · source shortened for safe storage" : ""}.</p>
    </aside>
  </div>`;
}

function dueDeck(lesson) {
  const due = lesson.flashcards.filter((card) => isDue(lesson.progress?.cards?.[card.id]));
  return due.length ? due : [];
}

function renderCards(lesson) {
  if (!lesson.flashcards.length) {
    return `<div class="empty-page"><div class="empty-mark">◇</div><h2>This lesson returned no flashcards.</h2><p>Regenerate from a fuller transcript so the model has enough concepts to test.</p><div class="button-row"><a class="primary-button" href="#/capture">Create another lesson</a></div></div>`;
  }
  const due = dueDeck(lesson);
  if (!due.length) {
    return `<div class="empty-page"><div class="empty-mark">✓</div><h2>Deck cleared for today.</h2><p>You reviewed every due card. The next review dates are saved with this lesson.</p><div class="button-row"><a class="primary-button" href="#/quiz">Take the quiz</a><button class="text-button" type="button" data-action="review-all">Review all anyway</button></div></div>`;
  }
  const card = due[0];
  const review = lesson.progress.cards[card.id];
  const completed = lesson.flashcards.length - due.length;
  return `<div class="flashcard-stage">
    <div style="width:min(650px,100%)">
      <div class="card-meta"><span>${due.length} due now</span><span>${completed} scheduled</span></div>
      <button class="flashcard" type="button" data-action="flip-card" aria-label="${state.cardFlipped ? "Show question" : "Reveal answer"}">
        <span class="card-side">${state.cardFlipped ? "ANSWER" : "PROMPT"}</span>
        <span class="card-face">${escapeHtml(state.cardFlipped ? card.back : card.front)}</span>
      </button>
      <div class="review-controls" ${state.cardFlipped ? "" : "hidden"}>
        <button class="choice-button" type="button" data-action="rate-card" data-rating="hard">Hard · revisit tomorrow</button>
        <button class="primary-button" type="button" data-action="rate-card" data-rating="easy">Easy · space it out</button>
      </div>
      ${review ? `<p class="source-citation">Last rating: ${escapeHtml(review.rating)} · next interval ${review.intervalDays} day${review.intervalDays === 1 ? "" : "s"}</p>` : ""}
      <div class="progress-rule" aria-label="Flashcard progress"><span style="width:${Math.round((completed / lesson.flashcards.length) * 100)}%"></span></div>
    </div>
  </div>`;
}

function ensureQuiz(lesson) {
  if (!state.quiz || state.quiz.lessonId !== lesson.id) {
    state.quiz = { lessonId: lesson.id, index: 0, score: 0, answered: null, finished: false };
  }
  return state.quiz;
}

function renderQuiz(lesson) {
  if (!lesson.quiz.length) {
    return `<div class="empty-page"><div class="empty-mark">?</div><h2>No quiz was generated.</h2><p>A longer source usually gives the model enough evidence to write strong questions.</p><div class="button-row"><a class="primary-button" href="#/capture">Try another source</a></div></div>`;
  }
  const quiz = ensureQuiz(lesson);
  if (quiz.finished) {
    const percent = Math.round((quiz.score / lesson.quiz.length) * 100);
    const weak = weakConceptList(lesson);
    return `<div class="empty-page">
      <div class="empty-mark">${percent}</div>
      <h2>${percent >= 80 ? "Strong pass." : "You found the useful gaps."}</h2>
      <p>${quiz.score} of ${lesson.quiz.length} correct. ${weak.length ? `Revisit ${escapeHtml(weak.slice(0, 2).map((item) => item.concept).join(" and "))}.` : "No weak concept was recorded in this run."}</p>
      <div class="button-row"><button class="primary-button" type="button" data-action="restart-quiz">Try again</button><a class="text-button" href="#/notes">Review notes</a></div>
    </div>`;
  }

  const question = lesson.quiz[quiz.index];
  const letters = ["A", "B", "C", "D"];
  const options = question.options.map((option, index) => {
    let optionState = "";
    if (quiz.answered !== null) {
      if (index === question.answerIndex) optionState = "correct";
      else if (index === quiz.answered) optionState = "wrong";
    }
    return `<button class="quiz-option" type="button" data-action="answer-quiz" data-index="${index}" ${quiz.answered !== null ? "disabled" : ""} ${optionState ? `data-state="${optionState}"` : ""}>
      <span class="option-letter">${letters[index]}</span><span>${escapeHtml(option)}</span>
    </button>`;
  }).join("");

  const wasCorrect = quiz.answered === question.answerIndex;
  return `<div class="quiz-wrap">
    <div class="quiz-meta"><span>Question ${quiz.index + 1} / ${lesson.quiz.length}</span><span>${quiz.score} correct</span></div>
    <h2 class="quiz-question">${escapeHtml(question.question)}</h2>
    <div class="quiz-options">${options}</div>
    ${quiz.answered !== null ? `<div class="quiz-feedback"><strong>${wasCorrect ? "That holds up." : "That is the gap."}</strong> ${escapeHtml(question.explanation)}</div>
      <div class="button-row"><button class="primary-button" type="button" data-action="next-question">${quiz.index === lesson.quiz.length - 1 ? "See results" : "Next question"}</button></div>` : ""}
  </div>`;
}

function renderRoadmap(lesson) {
  const steps = lesson.roadmap.map((step) => `<li class="roadmap-step">
    <div><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.why)}</p></div>
    <time>${step.minutes} min</time>
  </li>`).join("");
  const actions = lesson.actions.map((action, index) => {
    const done = Boolean(lesson.progress.actionsDone[index]);
    return `<li><label><input type="checkbox" data-action="toggle-action" data-index="${index}" ${done ? "checked" : ""} /> <span${done ? ' style="text-decoration:line-through"' : ""}>${escapeHtml(action.text)}${action.dueHint ? ` · ${escapeHtml(action.dueHint)}` : ""}</span></label></li>`;
  }).join("");
  const weak = weakConceptList(lesson);
  return `<div class="roadmap-grid">
    <div>
      <p class="section-label">TOPIC ROADMAP</p>
      <h2 class="section-heading">What to learn next</h2>
      <ol class="roadmap-list">${steps || '<li class="muted">No follow-up topics were returned.</li>'}</ol>
    </div>
    <aside>
      <p class="section-label">PUT IT TO WORK</p>
      <h2 class="section-heading">Action list</h2>
      <ul class="action-list">${actions || '<li>No actions were returned.</li>'}</ul>
      ${weak.length ? `<div class="sticker-note" style="margin-top:34px"><strong>Revisit these gaps</strong><ul>${weak.slice(0, 4).map((item) => `<li>${escapeHtml(item.concept)} · ${item.misses} miss${item.misses === 1 ? "" : "es"}</li>`).join("")}</ul></div>` : ""}
      <div class="button-row"><button class="secondary-button" type="button" data-action="download-pdf">Download cheat-sheet PDF</button></div>
    </aside>
  </div>`;
}

function renderMentor(lesson) {
  const messages = lesson.progress?.mentor || [];
  const isPending = state.mentorPendingLessonId === lesson.id;
  const chat = messages.map((message) => {
    const isUser = message.role === "user";
    const timestamp = formatChatTime(message.createdAt);
    return `<li class="chat-message" data-role="${isUser ? "user" : "assistant"}">
      <span class="chat-avatar" aria-hidden="true">${isUser ? "Y" : "LT"}</span>
      <div class="chat-body">
        <div class="chat-meta"><strong>${isUser ? "You" : "Lesson mentor"}</strong>${timestamp ? `<time datetime="${escapeHtml(message.createdAt)}">${escapeHtml(timestamp)}</time>` : ""}</div>
        <p>${escapeHtml(message.text)}</p>
      </div>
    </li>`;
  }).join("");
  const pendingMessage = isPending ? `<li class="chat-message chat-message-pending" data-role="assistant" role="status">
    <span class="chat-avatar" aria-hidden="true">LT</span>
    <div class="chat-body"><div class="chat-meta"><strong>Lesson mentor</strong><span>Reading the source</span></div><div class="thinking-dots" aria-label="Preparing an answer"><i></i><i></i><i></i></div></div>
  </li>` : "";
  const suggestions = lesson.suggestedQuestions.slice(0, 4).map((question, index) => `<button type="button" data-action="suggest-question" data-question="${escapeHtml(question)}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(question)}</strong><i aria-hidden="true">↗</i></button>`).join("");
  const sourceType = lesson.sourceType === "youtube" ? "YouTube captions" : "Pasted transcript";
  return `<div class="mentor-grid">
    <section class="mentor-conversation" aria-label="Lesson mentor conversation">
      ${messages.length ? `<ul class="chat-list" id="chat-list" role="log" aria-live="polite" aria-relevant="additions">${chat}${pendingMessage}</ul>` : `<div class="mentor-welcome">
        <span class="mentor-welcome-mark" aria-hidden="true">✦</span>
        <div><p class="section-label">READY WHEN YOU ARE</p><h2>Start with the part that still feels fuzzy.</h2><p>I’ll answer from this lesson’s transcript and notes. If the source does not cover something, I’ll tell you plainly.</p></div>
      </div>${pendingMessage ? `<ul class="chat-list" id="chat-list" role="log" aria-live="polite">${pendingMessage}</ul>` : ""}`}
      ${suggestions && !messages.length ? `<section class="mentor-prompts" aria-labelledby="prompt-heading"><div><p class="section-label">QUICK STARTS</p><h2 id="prompt-heading">Questions worth asking</h2></div><div class="suggested-questions">${suggestions}</div></section>` : ""}
      <form class="mentor-composer" id="mentor-form">
        <div class="composer-heading"><label for="mentor-question">Ask about this lesson</label><span id="mentor-count">0 / 1,200</span></div>
        <textarea class="mentor-input" id="mentor-question" name="question" rows="3" maxlength="1200" placeholder="Ask for an explanation, example, comparison, or recap…" aria-describedby="mentor-help" required ${isPending ? "disabled" : ""}></textarea>
        <div class="composer-actions"><p id="mentor-help"><span class="grounded-dot" aria-hidden="true"></span> Source-grounded answer <span aria-hidden="true">·</span> <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd></p><button class="primary-button mentor-send" type="submit" ${isPending ? "disabled" : ""}><span>${isPending ? "Thinking…" : "Ask mentor"}</span><i aria-hidden="true">→</i></button></div>
      </form>
    </section>
    <aside class="mentor-context" aria-label="Current lesson context">
      <p class="section-label">CURRENT SOURCE</p>
      <h2>${escapeHtml(lesson.title)}</h2>
      <p class="mentor-source-type">${escapeHtml(sourceType)}${lesson.sourceLanguage ? ` · ${escapeHtml(lesson.sourceLanguage)}` : ""}</p>
      <p class="mentor-summary">${escapeHtml(clampText(lesson.summary, 220))}</p>
      <dl class="mentor-stats">
        <div><dt>Key ideas</dt><dd>${lesson.keyIdeas.length}</dd></div>
        <div><dt>Recall cards</dt><dd>${lesson.flashcards.length}</dd></div>
        <div><dt>Quiz prompts</dt><dd>${lesson.quiz.length}</dd></div>
      </dl>
      <a class="text-button mentor-notes-link" href="#/notes">Review lesson notes →</a>
      <div class="grounding-note"><span aria-hidden="true">◎</span><div><strong>Evidence boundary</strong><p>Answers use only this lesson’s source and generated notes—never unrelated web knowledge.</p></div></div>
    </aside>
  </div>`;
}

function formatChatTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function resizeMentorInput(input) {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
}

function scrollMentorToEnd() {
  requestAnimationFrame(() => {
    const lastMessage = document.querySelector("#chat-list .chat-message:last-child");
    lastMessage?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function renderLibrary() {
  if (!state.lessons.length) {
    return `<div class="empty-page"><div class="empty-mark">⌂</div><h2>Your learning library starts empty.</h2><p>Capture one lesson and it will appear here with its notes, progress, review schedule, and mentor history.</p><div class="button-row"><a class="primary-button" href="#/capture">Capture the first lesson</a></div></div>`;
  }
  return `<div class="library-toolbar">
    <label class="field-label" for="library-search" style="flex:1">Search lessons<input class="search-input" id="library-search" type="search" placeholder="Title, concept, or source…" /></label>
    <a class="primary-button" href="#/capture">New lesson</a>
  </div>
  <ul class="library-list" id="library-list">${libraryRows(state.lessons)}</ul>`;
}

function libraryRows(lessons) {
  return lessons.map((lesson) => `<li class="library-item" data-library-id="${escapeHtml(lesson.id)}">
    <div><h2>${escapeHtml(lesson.title)}</h2><p>${escapeHtml(clampText(lesson.summary, 150))}</p></div>
    <div class="library-meta"><span>${dueCardCount(lesson)} due</span><span>${lesson.quiz.length} questions</span><span>${new Date(lesson.createdAt).toLocaleDateString()}</span></div>
    <div><button class="icon-button" type="button" data-action="open-lesson" data-id="${escapeHtml(lesson.id)}" aria-label="Open ${escapeHtml(lesson.title)}">→</button><button class="text-button" type="button" data-action="delete-lesson" data-id="${escapeHtml(lesson.id)}">Delete</button></div>
  </li>`).join("");
}

function llmText(response) {
  return response?.content?.text || response?.result?.content?.text || response?.text || "";
}

async function complete(request) {
  if (!state.anna?.llm?.complete) {
    throw new Error("Open LearnTube inside Anna to generate AI study material.");
  }
  const response = await state.anna.llm.complete(request, { timeoutMs: 180000 });
  const text = llmText(response);
  if (!text) throw new Error("Anna returned an empty model response. Please retry.");
  return text;
}

async function resolveYouTubeSource(url) {
  if (!extractYouTubeId(url)) throw new Error("Enter a valid YouTube watch, share, shorts, live, or embed URL.");
  if (!state.anna?.tools?.invoke) throw new Error("Open LearnTube inside Anna to retrieve YouTube captions.");
  updateBusy("Retrieving the video's captions…", 18);
  let response;
  try {
    response = await state.anna.tools.invoke({
      tool_id: TRANSCRIPT_TOOL_ID,
      method: "youtube.transcript",
      args: { url, languages: ["en", "en-US", "en-GB"] },
      timeoutMs: 90000,
    });
  } catch (error) {
    throw new Error(transcriptToolErrorMessage(error));
  }
  const payload = response?.result?.data || response?.data || response?.result || response;
  if (!payload?.ok) {
    const error = payload?.message || "Captions could not be retrieved for this video.";
    throw new Error(`${error} You can still use this lesson by pasting its transcript.`);
  }
  return {
    type: "youtube",
    url,
    title: payload.title || "YouTube lesson",
    label: payload.channel ? `${payload.title} · ${payload.channel}` : payload.title,
    text: String(payload.transcript || "").slice(0, MAX_PERSISTED_SOURCE),
    language: payload.language || payload.languageCode || "",
    durationSeconds: payload.durationSeconds || 0,
    truncated: Boolean(payload.truncated) || String(payload.transcript || "").length > MAX_PERSISTED_SOURCE,
  };
}

function lessonPrompt(evidence, source) {
  return `SOURCE METADATA\nType: ${source.type}\nTitle: ${source.title || "Unknown"}\nLanguage: ${source.language || "Unknown"}\n\nSOURCE EVIDENCE\n${evidence}\n\nCreate a complete study workspace using only the source evidence. Return exactly one valid JSON object with this shape:\n{\n  "title": "specific lesson title",\n  "sourceLabel": "short source label",\n  "summary": "clear 3-5 sentence summary",\n  "objectives": ["3-5 observable learning outcomes"],\n  "keyIdeas": [{"heading":"", "explanation":"", "example":"", "watchOut":"", "evidenceQuote":"short exact or near-exact source cue"}],\n  "flashcards": [{"front":"", "back":"", "concept":""}],\n  "quiz": [{"question":"", "options":["four plausible options"], "answerIndex":0, "explanation":"", "concept":""}],\n  "actions": [{"text":"", "dueHint":""}],\n  "roadmap": [{"title":"next topic", "why":"why it follows", "minutes":15}],\n  "cheatSheet": {"headline":"", "essentials":[""], "workflow":[""], "traps":[""]},\n  "suggestedQuestions": ["questions the learner can ask the mentor"]\n}\nAim for 4-6 key ideas, 8-12 flashcards, 5-8 quiz questions, 3-6 actions, and 3-6 roadmap steps when the source supports them. Do not add outside facts. Do not use Markdown fences. Keep the entire response valid JSON.`;
}

async function buildLesson(source) {
  const chunks = splitSource(source.text);
  if (!chunks.length) throw new Error("The source did not contain readable transcript text.");
  let evidence = source.text;

  if (chunks.length > 1) {
    const digests = [];
    for (let index = 0; index < chunks.length; index += 1) {
      assertNotCancelled();
      updateBusy(`Extracting evidence · part ${index + 1} of ${chunks.length}`, 24 + Math.round(((index + 1) / chunks.length) * 42));
      const digest = await complete({
        messages: [{ role: "user", content: { type: "text", text: `PART ${index + 1}/${chunks.length}\n${chunks[index]}` } }],
        systemPrompt: "You are compressing one part of a lesson transcript for a later source-grounded study guide. Extract the actual claims, explanations, examples, warnings, procedures, and useful source phrases. Preserve any timestamps. Do not add knowledge. Return concise plain text, not JSON.",
        maxTokens: 1300,
        temperature: 0.1,
      });
      digests.push(`PART ${index + 1}\n${digest}`);
    }
    evidence = digests.join("\n\n");
  }

  assertNotCancelled();
  updateBusy("Designing notes, cards, quiz, and roadmap…", 76);
  const raw = await complete({
    messages: [{ role: "user", content: { type: "text", text: lessonPrompt(evidence, source) } }],
    systemPrompt: "You are LearnTube's curriculum designer. Be precise, practical, and strictly source-grounded. Your entire response must be valid JSON matching the requested schema.",
    maxTokens: 4096,
    temperature: 0.2,
  });

  let parsed;
  try {
    parsed = parseStructuredJson(raw);
  } catch {
    updateBusy("Repairing the lesson format…", 88);
    const repaired = await complete({
      messages: [{ role: "user", content: { type: "text", text: `Repair this into one valid JSON object. Preserve its meaning and requested fields. Return JSON only.\n\n${raw}` } }],
      systemPrompt: "You repair malformed JSON. Output JSON only, without Markdown fences or commentary.",
      maxTokens: 4096,
      temperature: 0,
    });
    parsed = parseStructuredJson(repaired);
  }

  assertNotCancelled();
  updateBusy("Saving your workspace…", 95);
  return normalizeLesson(parsed, source);
}

async function createLesson(form) {
  if (state.generating) return;
  const youtubeUrl = String(new FormData(form).get("youtubeUrl") || "").trim();
  const transcript = String(new FormData(form).get("transcript") || "").trim();
  setBusy("Building your lesson…", state.captureMode === "youtube" ? "Checking the video" : "Reading the transcript", 8);
  try {
    let source;
    if (state.captureMode === "youtube") {
      if (!youtubeUrl) throw new Error("Paste a YouTube link first.");
      source = await resolveYouTubeSource(youtubeUrl);
    } else {
      if (transcript.length < 120) throw new Error("Paste at least 120 characters so the lesson has enough evidence.");
      source = {
        type: "transcript",
        url: "",
        title: "Pasted lesson transcript",
        label: "Pasted transcript",
        text: transcript.slice(0, MAX_PERSISTED_SOURCE),
        language: "",
        durationSeconds: 0,
        truncated: transcript.length > MAX_PERSISTED_SOURCE,
      };
    }
    assertNotCancelled();
    const lesson = await buildLesson(source);
    state.lessons.unshift(lesson);
    state.activeLessonId = lesson.id;
    state.profile = touchStudyDay({
      ...state.profile,
      xp: (state.profile.xp || 0) + 25,
      lessonsCreated: (state.profile.lessonsCreated || 0) + 1,
    });
    await Promise.all([saveLesson(lesson), saveProfile()]);
    clearBusy();
    location.hash = "#/notes";
    showToast("Lesson ready — notes, recall, and a revision plan are saved.");
  } catch (error) {
    clearBusy();
    showToast(error?.message || "The lesson could not be created.", 6500);
  }
}

async function rateCurrentCard(rating) {
  const lesson = activeLesson();
  const card = dueDeck(lesson)[0];
  if (!card) return;
  lesson.progress.cards[card.id] = scheduleCard(lesson.progress.cards[card.id], rating);
  state.profile = touchStudyDay({
    ...state.profile,
    xp: (state.profile.xp || 0) + (rating === "easy" ? 5 : 3),
    cardsReviewed: (state.profile.cardsReviewed || 0) + 1,
  });
  state.cardFlipped = false;
  await Promise.all([saveLesson(lesson), saveProfile()]);
  render();
}

async function answerQuiz(index) {
  const lesson = activeLesson();
  const quiz = ensureQuiz(lesson);
  if (quiz.answered !== null) return;
  const question = lesson.quiz[quiz.index];
  quiz.answered = index;
  const correct = index === question.answerIndex;
  if (correct) quiz.score += 1;
  else lesson.progress.weakConcepts[question.concept] = (lesson.progress.weakConcepts[question.concept] || 0) + 1;
  lesson.progress.quizAnswers[question.id] = { answerIndex: index, correct, answeredAt: new Date().toISOString() };
  state.profile = touchStudyDay({
    ...state.profile,
    xp: (state.profile.xp || 0) + (correct ? 10 : 2),
    questionsAnswered: (state.profile.questionsAnswered || 0) + 1,
  });
  await Promise.all([saveLesson(lesson), saveProfile()]);
  render();
}

async function nextQuestion() {
  const lesson = activeLesson();
  const quiz = ensureQuiz(lesson);
  if (quiz.index < lesson.quiz.length - 1) {
    quiz.index += 1;
    quiz.answered = null;
  } else {
    quiz.finished = true;
    lesson.progress.quizRuns = (lesson.progress.quizRuns || 0) + 1;
    lesson.progress.quizBest = Math.max(lesson.progress.quizBest || 0, quiz.score);
    await saveLesson(lesson);
  }
  render();
}

async function toggleAction(index, checked) {
  const lesson = activeLesson();
  lesson.progress.actionsDone[index] = checked;
  if (checked) {
    state.profile = touchStudyDay({ ...state.profile, xp: (state.profile.xp || 0) + 4 });
  }
  await Promise.all([saveLesson(lesson), checked ? saveProfile() : Promise.resolve()]);
  render();
}

async function askMentor(form) {
  const lesson = activeLesson();
  const question = String(new FormData(form).get("question") || "").trim();
  if (!question || state.mentorPendingLessonId) return;
  const messages = lesson.progress.mentor || (lesson.progress.mentor = []);
  messages.push({ role: "user", text: question, createdAt: new Date().toISOString() });
  state.mentorPendingLessonId = lesson.id;
  render();
  scrollMentorToEnd();
  try {
    const evidence = lesson.sourceText.slice(0, MAX_MENTOR_EVIDENCE);
    const answer = await complete({
      messages: [{ role: "user", content: { type: "text", text: `${question}\n\nLESSON NOTES\n${lesson.summary}\n${lesson.keyIdeas.map((idea) => `${idea.heading}: ${idea.explanation}`).join("\n")}\n\nSOURCE EVIDENCE\n${evidence}` } }],
      systemPrompt: "You are a grounded lesson mentor. Answer only from the supplied lesson notes and source evidence. Be clear and concise, connect ideas when the evidence supports it, and explicitly say 'That is not covered in this lesson' when it does not. Never invent citations or facts.",
      maxTokens: 900,
      temperature: 0.2,
    });
    messages.push({ role: "assistant", text: answer, createdAt: new Date().toISOString() });
    state.mentorPendingLessonId = null;
    state.profile = touchStudyDay({ ...state.profile, xp: (state.profile.xp || 0) + 6 });
    await Promise.all([saveLesson(lesson), saveProfile()]);
    render();
    scrollMentorToEnd();
  } catch (error) {
    messages.pop();
    state.mentorPendingLessonId = null;
    render();
    const input = document.getElementById("mentor-question");
    if (input) {
      input.value = question;
      resizeMentorInput(input);
      const count = document.getElementById("mentor-count");
      if (count) count.textContent = `${question.length.toLocaleString()} / 1,200`;
    }
    showToast(error?.message || "The mentor could not answer right now.", 6000);
  }
}

async function deleteLesson(id) {
  const lesson = state.lessons.find((item) => item.id === id);
  if (!lesson) return;
  if (!window.confirm(`Delete “${lesson.title}” and its saved progress?`)) return;
  state.lessons = state.lessons.filter((item) => item.id !== id);
  if (state.activeLessonId === id) state.activeLessonId = state.lessons[0]?.id || null;
  await storageDelete(`${LESSON_KEY_PREFIX}${id}`);
  await saveIndex();
  render();
  showToast("Lesson deleted.");
}

page.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "source-tab") {
    state.captureMode = target.dataset.mode;
    render();
  } else if (action === "flip-card") {
    state.cardFlipped = !state.cardFlipped;
    render();
  } else if (action === "rate-card") {
    await rateCurrentCard(target.dataset.rating);
  } else if (action === "review-all") {
    const lesson = activeLesson();
    Object.keys(lesson.progress.cards).forEach((key) => delete lesson.progress.cards[key].dueAt);
    await saveLesson(lesson);
    render();
  } else if (action === "answer-quiz") {
    await answerQuiz(Number(target.dataset.index));
  } else if (action === "next-question") {
    await nextQuestion();
  } else if (action === "restart-quiz") {
    state.quiz = null;
    render();
  } else if (action === "download-pdf") {
    downloadCheatSheet(activeLesson());
    showToast("One-page PDF downloaded.");
  } else if (action === "suggest-question") {
    const input = document.getElementById("mentor-question");
    if (input) {
      input.value = target.dataset.question;
      resizeMentorInput(input);
      const count = document.getElementById("mentor-count");
      if (count) count.textContent = `${input.value.length.toLocaleString()} / 1,200`;
      input.focus();
    }
  } else if (action === "open-lesson") {
    state.activeLessonId = target.dataset.id;
    await saveIndex();
    location.hash = "#/notes";
  } else if (action === "delete-lesson") {
    await deleteLesson(target.dataset.id);
  }
});

page.addEventListener("change", async (event) => {
  if (event.target.matches('[data-action="toggle-action"]')) {
    await toggleAction(Number(event.target.dataset.index), event.target.checked);
  }
});

page.addEventListener("input", (event) => {
  if (event.target.id === "transcript-text") {
    const count = document.getElementById("transcript-count");
    if (count) count.textContent = `${event.target.value.length.toLocaleString()} characters`;
  }
  if (event.target.id === "library-search") {
    const filtered = state.lessons.filter((lesson) => lessonMatches(lesson, event.target.value));
    const list = document.getElementById("library-list");
    if (list) list.innerHTML = filtered.length ? libraryRows(filtered) : '<li class="empty-page"><p>No lesson matches that search.</p></li>';
  }
  if (event.target.id === "mentor-question") {
    resizeMentorInput(event.target);
    const count = document.getElementById("mentor-count");
    if (count) count.textContent = `${event.target.value.length.toLocaleString()} / 1,200`;
  }
});

page.addEventListener("keydown", (event) => {
  if (event.target.id !== "mentor-question" || event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
  event.preventDefault();
  if (!state.mentorPendingLessonId) event.target.form?.requestSubmit();
});

page.addEventListener("submit", async (event) => {
  if (event.target.id === "capture-form") {
    event.preventDefault();
    await createLesson(event.target);
  } else if (event.target.id === "mentor-form") {
    event.preventDefault();
    await askMentor(event.target);
  }
});

lessonSelect.addEventListener("change", async () => {
  state.activeLessonId = lessonSelect.value;
  state.quiz = null;
  state.cardFlipped = false;
  await saveIndex();
  render();
});

document.getElementById("cancel-generation").addEventListener("click", () => {
  state.cancelRequested = true;
  busyDetail.textContent = "Stopping after the current Anna request…";
});

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  document.getElementById("workspace").focus({ preventScroll: true });
});

async function connectAnna() {
  try {
    const { AnnaAppRuntime } = await import("/static/anna-apps/_sdk/latest/index.js");
    state.anna = await Promise.race([
      AnnaAppRuntime.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Anna host handshake timed out")), 2200)),
    ]);
    state.connected = true;
    await state.anna.window.set_title({ title: "LearnTube AI" });
    setSync("ready", "Synced with Anna Storage");
  } catch {
    state.anna = null;
    state.connected = false;
    setSync("offline", "Standalone preview · progress stays on this device");
  }
}

async function boot() {
  await connectAnna();
  try {
    await hydrate();
  } catch (error) {
    setSync("offline", "Anna Storage is unavailable · using this device");
    state.anna = null;
    state.connected = false;
    await hydrate();
    showToast(`Storage fallback: ${error?.message || "Anna Storage could not be loaded."}`, 6000);
  }
  if (!location.hash) location.hash = "#/capture";
  render();
}

boot();
