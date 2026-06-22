import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const EXECUTA_HANDLE = "learntube-processor";
const DEV_FALLBACK_TOOL_ID = "tool-test-learntube-processor-12345678";
const APP_VERSION = "0.1.3";
const MIN_LOCAL_TRANSCRIPT_CHARS = 80;
const TOOL_ID =
  (typeof window !== "undefined" &&
    window.__ANNA_TOOL_IDS__ &&
    window.__ANNA_TOOL_IDS__[EXECUTA_HANDLE]) ||
  DEV_FALLBACK_TOOL_ID;

const STORAGE = {
  profile: "learntube-ai:profile",
  historyIndex: "learntube-ai:history:index",
  workspacePrefix: "learntube-ai:workspace:",
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const ROUTES = [
  { id: "home", title: "Home", kicker: "LearnTube AI" },
  { id: "dashboard", title: "Dashboard", kicker: "Study workspace" },
  { id: "notes", title: "Notes", kicker: "Written memory" },
  { id: "flashcards", title: "Cards", kicker: "Recall practice" },
  { id: "quiz", title: "Quiz", kicker: "Check understanding" },
  { id: "actions", title: "Tasks", kicker: "Next actions" },
  { id: "roadmap", title: "Roadmap", kicker: "Learning path" },
  { id: "mentor", title: "Mentor", kicker: "Grounded questions" },
  { id: "history", title: "History", kicker: "Saved workspaces" },
];
const ROUTE_IDS = new Set(ROUTES.map((route) => route.id));

const SOURCE_MODE_LABELS = {
  executa: "Executa analysis",
  "local-transcript": "Local transcript draft",
  demo: "Demo workspace",
  imported: "Saved workspace",
};

const els = {
  body: document.body,
  runtime: $("#runtime-pill"),
  pageTitle: $("#page-title"),
  pageKicker: $("#page-kicker"),
  form: $("#learn-form"),
  urls: $("#video-urls"),
  goal: $("#study-goal"),
  days: $("#study-days"),
  transcript: $("#manual-transcript"),
  learnBtn: $("#learn-btn"),
  sampleBtn: $("#sample-btn"),
  resetBtn: $("#reset-btn"),
  exportBtn: $("#export-btn"),
  helper: $("#form-helper"),
  panel: $("#tab-panel"),
  graph: $("#knowledge-graph"),
  weakList: $("#weak-list"),
  nextList: $("#next-list"),
  xp: $("#xp-value"),
  streak: $("#streak-value"),
  progress: $("#progress-value"),
  revision: $("#revision-value"),
  mentorForm: $("#mentor-form"),
  mentorQuestion: $("#mentor-question"),
  saveState: $("#save-state"),
  appVersion: $("[data-app-version]"),
  toastRegion: $("#toast-region"),
};

const state = {
  anna: null,
  connected: false,
  route: "home",
  current: null,
  history: [],
  profile: {
    xp: 0,
    streak: 0,
    completedTopics: [],
    hardCards: [],
    lastStudyDate: null,
  },
  cardProgress: {},
  quizAnswers: {},
  mentorAnswer: "",
  exportUrl: "",
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUi();
  renderAll();

  try {
    state.anna = await AnnaAppRuntime.connect();
    state.connected = true;
    setRuntime("Connected", "ok");
    await state.anna.window?.set_title?.({ title: "LearnTube AI" });
  } catch (error) {
    state.connected = false;
    setRuntime("Preview", "warn");
    setHelper("Preview mode. Paste transcript text to build locally, or use Load demo.", "warn");
    console.warn("[learntube-ai] Anna runtime unavailable:", error?.message || error);
  }

  await restoreState();
  renderAll();
}

function bindUi() {
  if (els.appVersion) els.appVersion.textContent = `LearnTube AI - Anna App - v${APP_VERSION}`;
  els.form.addEventListener("submit", onLearn);
  els.sampleBtn.addEventListener("click", loadDemo);
  els.resetBtn.addEventListener("click", resetWorkspace);
  els.exportBtn.addEventListener("click", exportCheatSheet);
  document.addEventListener("click", onRouteClick);
  els.panel.addEventListener("click", onPanelClick);
  els.mentorForm.addEventListener("submit", onMentorAsk);
}

async function restoreState() {
  const profile = await storageGet(STORAGE.profile);
  if (profile && typeof profile === "object") {
    state.profile = { ...state.profile, ...profile };
  }

  const history = await storageGet(STORAGE.historyIndex);
  if (Array.isArray(history)) {
    state.history = history.slice(0, 12);
  }

  if (state.history[0]?.id) {
    const workspace = await storageGet(`${STORAGE.workspacePrefix}${state.history[0].id}`);
    if (workspace) {
      state.current = normalizeWorkspace(workspace);
      state.cardProgress = state.current.progress?.cards || {};
      state.quizAnswers = state.current.progress?.quiz || {};
    }
  }
}

async function onLearn(event) {
  event.preventDefault();
  const urls = splitLines(els.urls.value);
  const manualTranscript = els.transcript.value.trim();
  if (!urls.length && !manualTranscript) {
    setHelper("Add at least one YouTube link or transcript.", "error");
    return;
  }

  setBusy(true);
  setHelper("Building workspace...");
  try {
    const base = await processVideos({
      urls,
      manualTranscript,
      goal: els.goal.value.trim(),
      days: clampNumber(els.days.value, 1, 365, 30),
    });
    const enhanced = await enhanceWorkspace(base);
    applyWorkspace(enhanced, { save: true, toast: "Workspace ready." });
    const mode = state.current?.sourceMode === "local-transcript" ? "Local transcript draft ready." : "Workspace ready.";
    setHelper(`${mode} Dashboard updated.`, "ok");
    try {
      await state.anna?.chat?.write_message?.({
        role: "user",
        content: `Created a LearnTube workspace for ${state.current.title}.`,
      });
    } catch {
      /* chat access is best-effort */
    }
  } catch (error) {
    console.error(error);
    setHelper(formatError(error), "error");
    showToast(formatError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function processVideos(input) {
  const hasTranscript = hasUsableTranscript(input.manualTranscript);
  if (!state.connected || !state.anna?.tools?.invoke) {
    if (hasTranscript) {
      return buildTranscriptWorkspace(input, {
        warning: "Built locally from pasted transcript because Anna runtime is not connected.",
      });
    }
    throw new Error("Anna runtime is not connected. Paste transcript text to build locally, or use Load demo for a sample workspace.");
  }
  try {
    const reply = await invokeProcessor("process_videos", {
      urls: input.urls,
      manual_transcript: input.manualTranscript,
      goal: input.goal,
      days: input.days,
    });
    const data = toolData(reply);
    const workspace = data.workspace || data;
    if (!workspace || typeof workspace !== "object") {
      throw new Error("The processor returned an empty workspace.");
    }
    return {
      ...workspace,
      sourceMode: workspace.sourceMode || "executa",
      warnings: arrayOfStrings(workspace.warnings, []),
    };
  } catch (error) {
    console.warn("[learntube-ai] Executa processor unavailable:", error?.message || error);
    if (hasTranscript) {
      return buildTranscriptWorkspace(input, {
        warning: `Built locally from pasted transcript because the Executa processor was unavailable: ${formatError(error)}`,
      });
    }
    throw new Error(`Could not reach the LearnTube processor: ${formatError(error)}. Start your Anna Agent for URL extraction, or paste transcript text and retry.`);
  }
}

async function enhanceWorkspace(baseWorkspace) {
  const workspace = normalizeWorkspace(baseWorkspace);
  if (!state.connected || !state.anna?.llm?.complete) return workspace;

  const context = {
    title: workspace.title,
    topic: workspace.topic,
    subtopic: workspace.subtopic,
    difficulty: workspace.difficulty,
    transcript_snippets: workspace.transcriptSnippets?.slice(0, 8),
    summary: workspace.summary,
    detailed_notes: workspace.detailedNotes?.slice(0, 8),
    flashcards: workspace.flashcards?.slice(0, 8),
    quiz: workspace.quiz?.slice(0, 8),
    roadmap: workspace.roadmap?.slice(0, 10),
  };

  const prompt = [
    "You are improving a YouTube learning workspace.",
    "Return strict JSON only. Do not invent facts outside the provided snippets.",
    "Keep the same schema keys: summary, detailedNotes, flashcards, quiz, actionItems, roadmap, weakConcepts.",
    "Make notes more precise, quiz choices clear, and action items practical.",
    JSON.stringify(context),
  ].join("\n\n");

  try {
    const result = await state.anna.llm.complete({
      systemPrompt: "Return valid compact JSON only. No markdown.",
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens: 1800,
      temperature: 0.2,
    });
    const text = extractLlmText(result);
    const parsed = parseJsonObject(text);
    if (!parsed) return workspace;
    return normalizeWorkspace({ ...workspace, ...parsed, llmEnhanced: true });
  } catch (error) {
    console.warn("[learntube-ai] LLM enhancement skipped:", error?.message || error);
    return workspace;
  }
}

function applyWorkspace(workspace, opts = {}) {
  state.current = normalizeWorkspace(workspace);
  state.route = "dashboard";
  state.cardProgress = state.current.progress?.cards || {};
  state.quizAnswers = state.current.progress?.quiz || {};
  state.mentorAnswer = "";
  updateStudyProfile();
  renderAll();
  scrollToRouteStart();
  if (opts.save) void saveWorkspace();
  if (opts.toast) showToast(opts.toast);
}

function updateStudyProfile() {
  const today = todayKey();
  if (state.profile.lastStudyDate !== today) {
    state.profile.streak = nextStreak(state.profile.lastStudyDate, today, state.profile.streak);
    state.profile.lastStudyDate = today;
  }
  state.profile.xp = Math.max(0, Number(state.profile.xp || 0) + 20);
}

async function saveWorkspace() {
  if (!state.current) return;
  state.current.progress = {
    cards: state.cardProgress,
    quiz: state.quizAnswers,
    actionItems: state.current.actionItems?.map((item) => ({ id: item.id, done: !!item.done })),
  };
  const compact = compactHistoryRecord(state.current);
  state.history = [compact, ...state.history.filter((item) => item.id !== compact.id)].slice(0, 12);
  await storageSet(`${STORAGE.workspacePrefix}${state.current.id}`, state.current);
  await storageSet(STORAGE.historyIndex, state.history);
  await storageSet(STORAGE.profile, state.profile);
  els.saveState.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function renderAll() {
  renderRoute();
  renderMetrics();
  renderNav();
  renderPanel();
  renderSideRail();
}

function renderRoute() {
  if (!ROUTE_IDS.has(state.route)) state.route = "home";
  els.body.dataset.route = state.route;
  const route = ROUTES.find((item) => item.id === state.route) || ROUTES[0];
  if (els.pageTitle) els.pageTitle.textContent = route.title;
  if (els.pageKicker) els.pageKicker.textContent = state.current?.title || route.kicker;
}

function renderEmpty() {
  els.panel.innerHTML = `
    <section class="empty-state">
      <h2>No workspace yet.</h2>
      <p>Start from the homepage, paste a video or transcript, and LearnTube AI will build the pages here.</p>
      <button class="btn btn--primary" data-route="home" type="button">Create workspace</button>
    </section>
  `;
  els.graph.innerHTML = "";
  els.weakList.innerHTML = `<span class="tag">No quiz yet</span>`;
  els.nextList.innerHTML = `<li>Roadmap appears after analysis.</li>`;
}

function renderMetrics() {
  els.xp.textContent = String(state.profile.xp || 0);
  els.streak.textContent = String(state.profile.streak || 0);
  if (!state.current) {
    els.progress.textContent = "0%";
    els.revision.textContent = "-";
    return;
  }
  const done = state.current.roadmap.filter((node) => node.status === "done").length;
  const pct = Math.round((done / Math.max(1, state.current.roadmap.length)) * 100);
  els.progress.textContent = `${pct}%`;
  els.revision.textContent = state.current.nextRevisionLabel || "1 day";
}

function renderNav() {
  let activeLink = null;
  for (const link of $$(".route-link")) {
    const isActive = link.dataset.route === state.route;
    link.classList.toggle("is-active", isActive);
    link.setAttribute("aria-current", isActive ? "page" : "false");
    if (isActive) activeLink = link;
  }

  const nav = $("#route-nav");
  if (nav && activeLink && nav.scrollWidth > nav.clientWidth) {
    const left = activeLink.offsetLeft - (nav.clientWidth - activeLink.clientWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }
}

function renderPanel() {
  if (state.route === "home") return;
  if (!state.current && state.route !== "history") {
    renderEmpty();
    return;
  }
  const renderers = {
    dashboard: renderDashboard,
    notes: renderNotes,
    flashcards: renderFlashcards,
    quiz: renderQuiz,
    actions: renderActions,
    roadmap: renderRoadmap,
    history: renderHistory,
    mentor: renderAsk,
  };
  const html = (renderers[state.route] || renderDashboard)();
  els.panel.innerHTML = html;
  els.panel.classList.remove("reveal");
  void els.panel.offsetWidth;
  els.panel.classList.add("reveal");
}

function renderDashboard() {
  const w = state.current;
  const warnings = arrayOfStrings(w.warnings, []);
  const featureLinks = [
    { route: "notes", label: "Notes", meta: `${w.detailedNotes.length} sections`, text: "Read the distilled explanation and lesson-specific details." },
    { route: "flashcards", label: "Cards", meta: `${w.flashcards.length} cards`, text: "Flip through recall prompts and mark what needs review." },
    { route: "quiz", label: "Quiz", meta: `${w.quiz.length} questions`, text: "Answer checks that update weak concepts automatically." },
    { route: "actions", label: "Tasks", meta: `${w.actionItems.length} actions`, text: "Turn the lesson into practice steps you can finish today." },
    { route: "roadmap", label: "Roadmap", meta: `${w.roadmap.length} steps`, text: "See what is done, current, next, and locked." },
    { route: "mentor", label: "Mentor", meta: "Grounded ask", text: "Ask questions using only the current workspace evidence." },
  ];
  return `
    <div class="panel-head">
      <div>
        <span class="study-title">${escapeHtml(w.sourceLabel)}</span>
        <h2>${escapeHtml(w.title)}</h2>
      </div>
      <div class="panel-actions">
        <span class="difficulty">${escapeHtml(w.difficulty)}</span>
        <span class="tag" data-tone="${w.sourceMode === "local-transcript" ? "warn" : "neutral"}">${escapeHtml(sourceModeLabel(w.sourceMode))}</span>
        ${warnings.length ? `<span class="tag" data-tone="warn">Review evidence</span>` : ""}
        ${w.llmEnhanced ? `<span class="tag">Anna LLM refined</span>` : `<span class="tag">Deterministic draft</span>`}
      </div>
    </div>
    <div class="dashboard-shell">
      <section class="dashboard-lead">
        <div>
          <h3>${escapeHtml(w.topic)} / ${escapeHtml(w.subtopic)}</h3>
          <p>${escapeHtml(w.summary)}</p>
        </div>
        <div class="tag-row">
          ${w.prerequisites.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
        </div>
        ${warnings.length ? `<p class="evidence-warning">${escapeHtml(warnings[0])}</p>` : ""}
      </section>
      <section class="feature-index" aria-label="Workspace pages">
        ${featureLinks.map((item) => `
          <button class="feature-link" data-route="${escapeAttr(item.route)}" type="button">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.meta)}</strong>
            <em>${escapeHtml(item.text)}</em>
          </button>
        `).join("")}
      </section>
      <section class="open-band">
        <h3>Timeline</h3>
        <ol class="chapter-list">
          ${w.chapters.map((chapter) => `
            <li>
              <span class="chapter-time">${escapeHtml(chapter.time)}</span>
              <strong>${escapeHtml(chapter.title)}</strong>
              <span>${escapeHtml(chapter.note)}</span>
            </li>
          `).join("")}
        </ol>
      </section>
      <section class="open-band open-band--code">
        <h3>Code pattern</h3>
        <pre class="code-card">${escapeHtml(w.codeExample)}</pre>
      </section>
    </div>
  `;
}

function renderNotes() {
  const w = state.current;
  return `
    <div class="panel-head">
      <div>
        <span class="study-title">${escapeHtml(w.title)}</span>
        <h2>Smart notes</h2>
      </div>
    </div>
    <div class="note-layout">
      <section class="note-block">
        <h3>Summary</h3>
        <p>${escapeHtml(w.summary)}</p>
      </section>
      ${w.detailedNotes.map((note) => `
        <section class="note-block">
          <h3>${escapeHtml(note.heading)}</h3>
          <ul class="notes-list">
            ${note.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
          </ul>
        </section>
      `).join("")}
    </div>
  `;
}

function renderFlashcards() {
  const cards = state.current.flashcards;
  return `
    <div class="panel-head">
      <div>
        <span class="study-title">${cards.length} cards</span>
        <h2>Flashcards</h2>
      </div>
      <div class="panel-actions">
        <button class="btn btn--quiet" type="button" data-action="reset-cards">Reset marks</button>
      </div>
    </div>
    <div class="flashcard-grid">
      ${cards.map((card) => {
        const mark = state.cardProgress[card.id]?.mark || "";
        return `
          <article class="flashcard" data-card-id="${escapeAttr(card.id)}" data-state="${escapeAttr(state.cardProgress[card.id]?.flipped ? "flipped" : "front")}">
            <div class="flashcard__front">
              <h3>Front</h3>
              <p class="flashcard__body">${escapeHtml(card.front)}</p>
            </div>
            <div class="flashcard__back">
              <h3>Back</h3>
              <p class="flashcard__body">${escapeHtml(card.back)}</p>
            </div>
            <div class="card-actions">
              <button class="btn btn--quiet" type="button" data-action="flip-card" data-card-id="${escapeAttr(card.id)}">Flip</button>
              <button class="btn btn--quiet" type="button" data-action="mark-card" data-mark="easy" data-card-id="${escapeAttr(card.id)}">Easy</button>
              <button class="btn btn--quiet" type="button" data-action="mark-card" data-mark="hard" data-card-id="${escapeAttr(card.id)}">Hard</button>
              ${mark ? `<span class="tag">${escapeHtml(mark)}</span>` : ""}
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderQuiz() {
  const quiz = state.current.quiz;
  const answered = Object.keys(state.quizAnswers).length;
  const correct = quiz.filter((q, index) => state.quizAnswers[index] === q.answerIndex).length;
  return `
    <div class="panel-head">
      <div>
        <span class="study-title">${answered}/${quiz.length} answered</span>
        <h2>Quiz mode</h2>
      </div>
      <div class="panel-actions">
        <button class="btn btn--quiet" type="button" data-action="reset-quiz">Retake</button>
      </div>
    </div>
    <div class="score-box">
      <strong>Score: ${correct}/${quiz.length}</strong>
      <span class="tag">${escapeHtml(scoreLabel(correct, quiz.length))}</span>
    </div>
    <div class="quiz-stack">
      ${quiz.map((q, index) => `
        <section class="quiz-question">
          <h3>${escapeHtml(q.question)}</h3>
          <div class="choices">
            ${q.choices.map((choice, choiceIndex) => {
              const selected = state.quizAnswers[index];
              const result =
                selected == null ? "" :
                choiceIndex === q.answerIndex ? "correct" :
                choiceIndex === selected ? "wrong" : "";
              return `
                <button class="choice" type="button" data-action="answer-quiz" data-question="${index}" data-choice="${choiceIndex}" data-result="${result}">
                  <span class="choice__key">${String.fromCharCode(65 + choiceIndex)}</span>
                  <span>${escapeHtml(choice)}</span>
                </button>
              `;
            }).join("")}
          </div>
          ${state.quizAnswers[index] == null ? "" : `<p>${escapeHtml(q.explanation)}</p>`}
        </section>
      `).join("")}
    </div>
  `;
}

function renderActions() {
  return `
    <div class="panel-head">
      <div>
        <span class="study-title">After this lesson</span>
        <h2>Action items</h2>
      </div>
    </div>
    <div class="action-list">
      ${state.current.actionItems.map((item) => `
        <label class="action-row" data-done="${item.done ? "true" : "false"}">
          <input type="checkbox" data-action="toggle-action" data-item-id="${escapeAttr(item.id)}" ${item.done ? "checked" : ""} />
          <span>
            <strong>${escapeHtml(item.title)}</strong>
            <span class="action-meta">${escapeHtml(item.reason)}</span>
          </span>
          <span class="tag">${escapeHtml(item.effort)}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function renderRoadmap() {
  return `
    <div class="panel-head">
      <div>
        <span class="study-title">${escapeHtml(state.current.goal)}</span>
        <h2>Learning roadmap</h2>
      </div>
    </div>
    <div class="roadmap">
      ${state.current.roadmap.map((node) => `
        <section class="roadmap-node" data-status="${escapeAttr(node.status)}">
          <h3>${escapeHtml(node.title)}</h3>
          <p>${escapeHtml(node.note)}</p>
          <div class="card-actions">
            <span class="tag">${escapeHtml(node.status)}</span>
            ${renderRoadmapAction(node)}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

function renderHistory() {
  return `
    <div class="panel-head">
      <div>
        <span class="study-title">${state.history.length} saved workspaces</span>
        <h2>Saved workspaces</h2>
      </div>
      <div class="panel-actions">
        <button class="btn btn--quiet" type="button" data-action="clear-history">Clear</button>
      </div>
    </div>
    <div class="history-list">
      ${state.history.length ? state.history.map((item) => `
        <article class="history-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.topic)} / ${escapeHtml(item.savedAtLabel)}</span>
          </div>
          <button class="btn btn--quiet" type="button" data-action="load-history" data-workspace-id="${escapeAttr(item.id)}">Open</button>
        </article>
      `).join("") : `
        <section class="empty-state">
          <h2>No saved videos yet.</h2>
          <p>Analyze a lesson and it will be saved here.</p>
        </section>
      `}
    </div>
  `;
}

function renderAsk() {
  return `
    <div class="panel-head">
      <div>
        <span class="study-title">${escapeHtml(state.current.title)}</span>
        <h2>Ask from this video</h2>
      </div>
    </div>
    <div class="ask-layout">
      <section class="mentor-answer">
        <h3>Latest answer</h3>
        <p>${state.mentorAnswer ? escapeHtml(state.mentorAnswer) : "Ask a grounded question from the mentor dock below."}</p>
      </section>
      <section class="note-block">
        <h3>Evidence available</h3>
        <ul class="notes-list">
          ${state.current.transcriptSnippets.slice(0, 5).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    </div>
  `;
}

function renderSideRail() {
  if (!state.current) {
    els.graph.innerHTML = "";
    els.weakList.innerHTML = `<span class="tag">No quiz yet</span>`;
    els.nextList.innerHTML = `<li>Roadmap appears after analysis.</li>`;
    return;
  }
  const weak = computeWeakConcepts();
  els.weakList.innerHTML = weak.length
    ? weak.map((item) => `<span class="tag" data-tone="danger">${escapeHtml(item)}</span>`).join("")
    : `<span class="tag">No weak concept detected</span>`;
  els.nextList.innerHTML = state.current.roadmap
    .filter((node) => node.status !== "done")
    .slice(0, 5)
    .map((node) => `<li>${escapeHtml(node.title)}</li>`)
    .join("");
  els.graph.innerHTML = renderGraphSvg(state.current.roadmap);
}

function onRouteClick(event) {
  const trigger = event.target.closest("a[data-route], button[data-route]");
  if (!trigger || !ROUTE_IDS.has(trigger.dataset.route)) return;
  event.preventDefault();
  state.route = trigger.dataset.route;
  renderAll();
  scrollToRouteStart();
  if (state.route !== "home") els.panel.focus({ preventScroll: true });
}

function scrollToRouteStart() {
  const target = state.route === "home" ? $("#home-page") : $("#workspace-page");
  if (!target) return;
  const navHeight = els.body.clientWidth < 960 ? $(".side-nav")?.getBoundingClientRect().height || 0 : 0;
  const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 12;
  window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
}

async function onPanelClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const historyOnly = action === "load-history" || action === "clear-history";
  if (!state.current && !historyOnly) return;

  if (action === "flip-card") {
    const id = target.dataset.cardId;
    state.cardProgress[id] = {
      ...(state.cardProgress[id] || {}),
      flipped: !state.cardProgress[id]?.flipped,
    };
  }

  if (action === "mark-card") {
    const id = target.dataset.cardId;
    const mark = target.dataset.mark;
    state.cardProgress[id] = { ...(state.cardProgress[id] || {}), mark };
    if (mark === "hard" && !state.profile.hardCards.includes(id)) {
      state.profile.hardCards.push(id);
    }
    if (mark === "easy") {
      state.profile.hardCards = state.profile.hardCards.filter((item) => item !== id);
    }
  }

  if (action === "reset-cards") {
    state.cardProgress = {};
    state.profile.hardCards = [];
  }

  if (action === "answer-quiz") {
    const question = Number(target.dataset.question);
    const choice = Number(target.dataset.choice);
    state.quizAnswers[question] = choice;
    if (Object.keys(state.quizAnswers).length === state.current.quiz.length && !state.current.quizCompleted) {
      state.current.quizCompleted = true;
      state.profile.xp += 20;
      showToast("Quiz scored. Weak concepts updated.");
    }
  }

  if (action === "reset-quiz") {
    state.quizAnswers = {};
    state.current.quizCompleted = false;
  }

  if (action === "toggle-action") {
    const item = state.current.actionItems.find((entry) => entry.id === target.dataset.itemId);
    if (item) {
      const wasDone = item.done;
      item.done = target.checked;
      if (!wasDone && item.done) state.profile.xp += 10;
    }
  }

  if (action === "mark-roadmap") {
    const node = state.current.roadmap.find((entry) => entry.id === target.dataset.nodeId);
    if (node && completeRoadmapNode(node)) {
      if (!state.profile.completedTopics.includes(node.title)) {
        state.profile.completedTopics.push(node.title);
      }
      state.profile.xp += 15;
    }
  }

  if (action === "load-history") {
    const workspace = await storageGet(`${STORAGE.workspacePrefix}${target.dataset.workspaceId}`);
    if (workspace) applyWorkspace(workspace, { save: false, toast: "Workspace loaded." });
    return;
  }

  if (action === "clear-history") {
    state.history = [];
    await storageSet(STORAGE.historyIndex, []);
    showToast("History cleared.");
    renderAll();
    return;
  }

  renderAll();
  if (state.current) await saveWorkspace();
}

async function onMentorAsk(event) {
  event.preventDefault();
  if (!state.current) {
    showToast("Create a workspace first.", "error");
    return;
  }
  const question = els.mentorQuestion.value.trim();
  if (!question) return;

  setBusy(true);
  state.route = "mentor";
  state.mentorAnswer = "Checking the lesson evidence...";
  renderAll();
  try {
    state.mentorAnswer = await askGroundedQuestion(question);
    renderPanel();
    try {
      await state.anna?.chat?.write_message?.({
        role: "user",
        content: `Asked LearnTube mentor: ${question}`,
      });
    } catch {
      /* best-effort */
    }
  } catch (error) {
    state.mentorAnswer = "I could not answer from the available lesson evidence. Try adding a clearer transcript excerpt.";
    renderPanel();
    showToast(formatError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function askGroundedQuestion(question) {
  const compact = compactWorkspaceForPrompt(state.current);
  if (state.connected && state.anna?.llm?.complete) {
    try {
      const result = await state.anna.llm.complete({
        systemPrompt: "Answer only from the provided lesson evidence. If evidence is missing, say what is missing.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Question: ${question}\n\nLesson evidence:\n${JSON.stringify(compact)}`,
            },
          },
        ],
        maxTokens: 700,
        temperature: 0.2,
      });
      const text = extractLlmText(result);
      if (text) return text.trim();
    } catch (error) {
      console.warn("[learntube-ai] mentor LLM failed:", error?.message || error);
    }
  }

  if (state.connected && state.anna?.tools?.invoke) {
    try {
      const reply = await invokeProcessor("answer_question", { workspace: compact, question });
      return toolData(reply).answer || "I could not answer from the available lesson evidence.";
    } catch (error) {
      console.warn("[learntube-ai] mentor Executa unavailable, using local answer:", error?.message || error);
    }
  }

  return localGroundedAnswer(state.current, question);
}

async function invokeProcessor(method, args) {
  let lastError = null;
  for (const toolId of candidateToolIds()) {
    try {
      return await state.anna.tools.invoke({ tool_id: toolId, method, args });
    } catch (error) {
      lastError = error;
      if (!isToolIdRecoverable(error)) break;
    }
  }
  throw lastError || new Error("The LearnTube processor did not respond.");
}

function candidateToolIds() {
  return unique([TOOL_ID, DEV_FALLBACK_TOOL_ID]);
}

function isToolIdRecoverable(error) {
  return /not whitelisted|host_api\.tools|unknown_tool|permission denied/i.test(formatError(error));
}

function loadDemo() {
  const workspace = buildDemoWorkspace({
    urls: ["https://www.youtube.com/watch?v=binary-search-demo"],
    manualTranscript: els.transcript.value,
    goal: "DSA interview readiness",
    days: 30,
  });
  applyWorkspace(workspace, { save: true });
  setHelper("Demo workspace loaded.", "ok");
}

function resetWorkspace() {
  state.current = null;
  state.cardProgress = {};
  state.quizAnswers = {};
  state.mentorAnswer = "";
  state.route = "home";
  renderAll();
  scrollToRouteStart();
  showToast("Current workspace reset.");
}

function exportCheatSheet() {
  if (!state.current) {
    showToast("Create a workspace before exporting.", "error");
    return;
  }
  if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
  const pdf = buildPdf([
    `LearnTube AI - ${state.current.title}`,
    `Topic: ${state.current.topic} / ${state.current.subtopic}`,
    `Difficulty: ${state.current.difficulty}`,
    "",
    "Summary",
    state.current.summary,
    "",
    "Key Notes",
    ...state.current.detailedNotes.flatMap((note) => [note.heading, ...note.points.map((point) => `- ${point}`), ""]),
    "Flashcards",
    ...state.current.flashcards.map((card) => `Q: ${card.front}  A: ${card.back}`),
    "",
    "Action Items",
    ...state.current.actionItems.map((item) => `- ${item.title}`),
  ]);
  const blob = new Blob([pdf], { type: "application/pdf" });
  state.exportUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = state.exportUrl;
  anchor.download = `learntube-${slugify(state.current.title)}.pdf`;
  anchor.click();
  showToast("Cheat sheet exported.");
}

function setBusy(on) {
  els.body.classList.toggle("is-busy", !!on);
  els.learnBtn.disabled = !!on;
  els.mentorForm.querySelector("button").disabled = !!on;
}

function setRuntime(text, tone) {
  els.runtime.textContent = text;
  if (tone) els.runtime.dataset.tone = tone;
}

function setHelper(text, tone) {
  els.helper.textContent = text;
  if (tone) els.helper.dataset.tone = tone;
  else delete els.helper.dataset.tone;
}

function showToast(message, tone = "ok") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.tone = tone;
  toast.textContent = message;
  els.toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

async function storageGet(key) {
  if (state.connected && state.anna?.storage?.get) {
    try {
      const result = await state.anna.storage.get({ key });
      if (Object.prototype.hasOwnProperty.call(result || {}, "value")) return result.value;
      return result;
    } catch (error) {
      console.warn("[learntube-ai] storage.get failed:", key, error?.message || error);
    }
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function storageSet(key, value) {
  if (state.connected && state.anna?.storage?.set) {
    try {
      await state.anna.storage.set({ key, value });
      return;
    } catch (error) {
      console.warn("[learntube-ai] storage.set failed:", key, error?.message || error);
    }
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* local storage can be denied */
  }
}

function normalizeWorkspace(input) {
  const fallback = buildWorkspaceDefaults(input || {});
  const w = { ...fallback, ...(input || {}) };
  const title = stringOr(w.title, fallback.title);
  const id = stringOr(w.id, stableId(title + JSON.stringify(w.videoIds || [])));
  const quiz = arrayOfObjects(w.quiz, fallback.quiz).map((q, index) => {
    const choices = arrayOfStrings(q.choices, fallback.quiz[index]?.choices || ["Review the notes", "Skip the topic"]).slice(0, 4);
    return {
      id: stringOr(q.id, `quiz-${index + 1}`),
      question: stringOr(q.question, "What did the lesson explain?"),
      choices,
      answerIndex: clampNumber(q.answerIndex, 0, Math.max(0, choices.length - 1), 0),
      concept: stringOr(q.concept, w.subtopic || "Concept"),
      explanation: stringOr(q.explanation, "Use the notes to review this point."),
    };
  });
  return {
    ...w,
    id,
    title,
    sourceLabel: stringOr(w.sourceLabel, "YouTube lesson"),
    topic: stringOr(w.topic, "Learning"),
    subtopic: stringOr(w.subtopic, title),
    difficulty: stringOr(w.difficulty, "Beginner"),
    goal: stringOr(w.goal, els.goal?.value || "Study plan"),
    sourceMode: stringOr(w.sourceMode, fallback.sourceMode),
    warnings: arrayOfStrings(w.warnings, fallback.warnings),
    summary: stringOr(w.summary, fallback.summary),
    prerequisites: arrayOfStrings(w.prerequisites, fallback.prerequisites),
    transcriptSnippets: arrayOfStrings(w.transcriptSnippets, fallback.transcriptSnippets).slice(0, 12),
    chapters: arrayOfObjects(w.chapters, fallback.chapters).map((chapter, index) => ({
      time: stringOr(chapter.time, index === 0 ? "00:00" : `${String(index * 2).padStart(2, "0")}:00`),
      title: stringOr(chapter.title, `Moment ${index + 1}`),
      note: stringOr(chapter.note, "Review this part of the source material."),
    })),
    detailedNotes: arrayOfObjects(w.detailedNotes, fallback.detailedNotes).map((note, index) => ({
      heading: stringOr(note.heading, index === 0 ? "Core idea" : `Note ${index + 1}`),
      points: arrayOfStrings(note.points, fallback.detailedNotes[index]?.points || ["Review the source evidence."]),
    })),
    flashcards: arrayOfObjects(w.flashcards, fallback.flashcards).map((card, index) => ({
      id: stringOr(card.id, `card-${index + 1}`),
      front: stringOr(card.front, "What is the main idea?"),
      back: stringOr(card.back, "Review the lesson summary."),
    })),
    quiz,
    actionItems: arrayOfObjects(w.actionItems, fallback.actionItems).map((item, index) => ({
      id: stringOr(item.id, `action-${index + 1}`),
      title: stringOr(item.title, "Review the lesson"),
      reason: stringOr(item.reason, "Keeps the concept active."),
      effort: stringOr(item.effort, "15 min"),
      done: !!item.done,
    })),
    roadmap: arrayOfObjects(w.roadmap, fallback.roadmap).map((node, index) => ({
      id: stringOr(node.id, `node-${index + 1}`),
      title: stringOr(node.title, `Step ${index + 1}`),
      note: stringOr(node.note, "Continue from the current lesson."),
      status: ["done", "current", "next", "locked"].includes(node.status) ? node.status : index === 0 ? "done" : "next",
    })),
    weakConcepts: arrayOfStrings(w.weakConcepts, fallback.weakConcepts),
    codeExample: stringOr(w.codeExample, fallback.codeExample),
    nextRevisionLabel: stringOr(w.nextRevisionLabel, "1 day"),
    createdAt: w.createdAt || new Date().toISOString(),
  };
}

function buildWorkspaceDefaults(input = {}) {
  const transcript = stringOr(input.manualTranscript || input.transcript || "", "");
  const snippets = extractTranscriptSnippets(transcript);
  const title = stringOr(input.title, deriveWorkspaceTitle(input, snippets));
  const concepts = deriveConcepts(`${title} ${transcript}`).slice(0, 5);
  const primary = concepts[0] || title;
  const sourceLabel = stringOr(input.sourceLabel, (input.urls || [])[0] || "Manual transcript");
  const summary = stringOr(
    input.summary,
    snippets[0]
      ? `${title} focuses on ${concepts.slice(0, 3).join(", ") || "the core lesson ideas"}. Review the notes and evidence before applying it.`
      : "Add transcript evidence or run the Executa processor to build a more specific study workspace.",
  );
  const notePoints = snippets.length
    ? snippets.slice(0, 4)
    : ["Capture the main claim from the source.", "Add examples or transcript snippets for stronger recall.", "Review the topic again before using it elsewhere."];
  const roadmapConcepts = unique(["Foundations", primary, "Practice", "Revision", concepts[1] || "Next topic"]);
  return {
    id: stableId(`${title}:${sourceLabel}:${transcript.slice(0, 80)}`),
    title,
    sourceLabel,
    topic: concepts[1] || "Learning",
    subtopic: primary,
    difficulty: "Beginner",
    goal: input.goal || "Study plan",
    sourceMode: "imported",
    warnings: [],
    summary,
    prerequisites: concepts.length ? concepts.slice(0, 3) : ["Source evidence", "Core idea", "Practice"],
    transcriptSnippets: snippets.length ? snippets : ["No transcript snippets were available."],
    chapters: (snippets.length ? snippets.slice(0, 4) : notePoints.slice(0, 3)).map((snippet, index) => ({
      time: index === 0 ? "00:00" : `${String(index * 2).padStart(2, "0")}:00`,
      title: index === 0 ? "Opening idea" : `Evidence ${index + 1}`,
      note: snippet,
    })),
    detailedNotes: [
      { heading: "Core idea", points: notePoints },
      {
        heading: "Review focus",
        points: [
          `Explain ${primary} in your own words.`,
          "Turn the source into one example and one counterexample.",
          "Revisit weak points during the next revision session.",
        ],
      },
    ],
    flashcards: (concepts.length ? concepts.slice(0, 4) : ["Main idea", "Evidence", "Practice"]).map((concept, index) => ({
      id: `card-${slugify(concept)}-${index + 1}`,
      front: `What should you remember about ${concept}?`,
      back: snippets[index] || summary,
    })),
    quiz: [
      {
        id: "quiz-main-idea",
        question: `Which idea best matches ${title}?`,
        choices: [primary, "An unrelated detail", "A formatting choice", "A skipped section"],
        answerIndex: 0,
        concept: primary,
        explanation: "The answer is grounded in the available transcript and notes.",
      },
      {
        id: "quiz-review",
        question: "What should you do after reviewing this lesson?",
        choices: ["Practice recall", "Ignore weak concepts", "Delete the notes", "Skip revision"],
        answerIndex: 0,
        concept: "Revision",
        explanation: "Recall and spaced revision keep the lesson active.",
      },
    ],
    actionItems: [
      { id: "action-explain", title: `Explain ${primary}`, reason: "Shows whether the concept is understood.", effort: "10 min" },
      { id: "action-practice", title: "Create one practice example", reason: "Turns passive watching into active use.", effort: "20 min" },
      { id: "action-revise", title: "Schedule the next review", reason: "Spaced repetition reduces forgetting.", effort: "5 min" },
    ],
    roadmap: roadmapConcepts.slice(0, 5).map((concept, index) => ({
      id: `node-${slugify(concept)}-${index + 1}`,
      title: concept,
      note: index === 0 ? "Confirm the prerequisite idea." : `Review ${concept} with examples.`,
      status: index === 0 ? "done" : index === 1 ? "current" : index < 4 ? "next" : "locked",
    })),
    weakConcepts: concepts.slice(1, 3).length ? concepts.slice(1, 3) : ["Evidence review"],
    codeExample: input.codeExample || "Add lesson code or transcript excerpts to capture code patterns.",
    nextRevisionLabel: "1 day",
    createdAt: new Date().toISOString(),
  };
}

function buildTranscriptWorkspace(input = {}, opts = {}) {
  return {
    ...buildWorkspaceDefaults(input),
    sourceMode: "local-transcript",
    warnings: [opts.warning || "Built locally from pasted transcript. Connect the Executa processor for video metadata and captions."],
  };
}

function buildDemoWorkspace(input = {}) {
  const transcript = input.manualTranscript || "";
  const title = transcript.toLowerCase().includes("sorting") ? "Sorting Patterns" : "Binary Search Explained";
  return {
    id: stableId(`${title}:${(input.urls || []).join(",")}:${transcript.slice(0, 80)}`),
    title,
    sourceLabel: (input.urls || [])[0] || "Manual transcript",
    topic: "DSA",
    subtopic: title.includes("Sorting") ? "Sorting" : "Binary Search",
    difficulty: "Beginner",
    goal: input.goal || "DSA interview readiness",
    sourceMode: "demo",
    warnings: [],
    summary:
      "Binary search cuts a sorted search space in half after each comparison. It is fast because every step removes the half that cannot contain the target.",
    prerequisites: ["Sorted arrays", "Loops", "Indexes"],
    transcriptSnippets: [
      "Binary search works on sorted arrays.",
      "Compare the target with the middle value.",
      "Discard the half that cannot contain the answer.",
      "Watch for off-by-one loop boundaries.",
      "Lower-bound and upper-bound are common variants.",
    ],
    chapters: [
      { time: "00:00", title: "Search space", note: "Start with the full sorted array." },
      { time: "02:10", title: "Middle check", note: "Compare the middle value with the target." },
      { time: "04:30", title: "Move bounds", note: "Shift left or right based on the comparison." },
      { time: "07:20", title: "Failure case", note: "Stop when the search space is empty." },
    ],
    detailedNotes: [
      {
        heading: "Core idea",
        points: [
          "The input must be sorted before binary search can make valid decisions.",
          "Each comparison removes roughly half of the remaining candidates.",
          "The loop maintains two boundaries that describe the current search space.",
        ],
      },
      {
        heading: "Common mistakes",
        points: [
          "Using binary search on unsorted input gives unreliable answers.",
          "Updating the wrong boundary can create an infinite loop.",
          "Lower-bound and exact-match versions use different stop conditions.",
        ],
      },
    ],
    flashcards: [
      { id: "card-binary-search", front: "What is binary search?", back: "A search algorithm for sorted arrays that halves the search space each step." },
      { id: "card-sorted", front: "When does binary search fail?", back: "When the data is not sorted or the boundary update is wrong." },
      { id: "card-complexity", front: "Why is the time complexity O(log n)?", back: "Because each comparison cuts the remaining candidates by about half." },
      { id: "card-bound", front: "What is lower bound?", back: "The first position where a value could be inserted without breaking sorted order." },
    ],
    quiz: [
      {
        id: "quiz-complexity",
        question: "What is the usual time complexity of binary search?",
        choices: ["O(n)", "O(log n)", "O(n^2)", "O(1)"],
        answerIndex: 1,
        concept: "Complexity",
        explanation: "Each step halves the search space, so the number of steps grows logarithmically.",
      },
      {
        id: "quiz-input",
        question: "Which input condition is required?",
        choices: ["Random order", "Sorted order", "Unique values only", "Negative numbers only"],
        answerIndex: 1,
        concept: "Prerequisites",
        explanation: "The comparison only works if the array is sorted.",
      },
      {
        id: "quiz-move",
        question: "If the middle value is smaller than the target, what should move?",
        choices: ["Right boundary left", "Left boundary right", "Both boundaries reset", "The array is sorted again"],
        answerIndex: 1,
        concept: "Boundary updates",
        explanation: "Values up to the middle are too small, so the left boundary moves right.",
      },
    ],
    actionItems: [
      { id: "action-5-problems", title: "Solve five binary-search problems", reason: "Transfers the idea into code.", effort: "35 min" },
      { id: "action-lower-bound", title: "Implement lower bound", reason: "Covers the most common variant.", effort: "20 min" },
      { id: "action-revise-arrays", title: "Revise array indexing", reason: "Most mistakes happen at boundaries.", effort: "15 min" },
    ],
    roadmap: [
      { id: "node-arrays", title: "Arrays", note: "Indexing and contiguous storage.", status: "done" },
      { id: "node-binary-search", title: "Binary Search", note: "Halve a sorted search space.", status: "current" },
      { id: "node-sorting", title: "Sorting", note: "Prepare data for ordered search.", status: "next" },
      { id: "node-recursion", title: "Recursion", note: "Build divide-and-conquer intuition.", status: "next" },
      { id: "node-trees", title: "Trees", note: "Search in hierarchical structures.", status: "locked" },
    ],
    weakConcepts: ["Boundary updates", "Lower bound"],
    codeExample: "while (left <= right) {\n  const mid = Math.floor((left + right) / 2);\n  if (nums[mid] === target) return mid;\n  if (nums[mid] < target) left = mid + 1;\n  else right = mid - 1;\n}",
    nextRevisionLabel: "1 day",
    createdAt: new Date().toISOString(),
  };
}

function renderRoadmapAction(node) {
  if (node.status === "done") {
    return `<span class="tag" data-tone="success">Complete</span>`;
  }
  if (node.status === "locked") {
    return `<button class="btn btn--quiet" type="button" disabled title="Complete earlier topics first">Locked</button>`;
  }
  return `<button class="btn btn--quiet" type="button" data-action="mark-roadmap" data-node-id="${escapeAttr(node.id)}">Mark done</button>`;
}

function completeRoadmapNode(node) {
  if (!node || !["current", "next"].includes(node.status)) return false;
  node.status = "done";
  const hasCurrent = state.current.roadmap.some((entry) => entry.status === "current");
  if (!hasCurrent) {
    const next = state.current.roadmap.find((entry) => entry.status === "next");
    if (next) next.status = "current";
  }
  const nextCount = state.current.roadmap.filter((entry) => entry.status === "next").length;
  if (nextCount < 2) {
    const locked = state.current.roadmap.find((entry) => entry.status === "locked");
    if (locked) locked.status = "next";
  }
  return true;
}

function computeWeakConcepts() {
  if (!state.current) return [];
  const wrong = state.current.quiz
    .filter((q, index) => state.quizAnswers[index] != null && state.quizAnswers[index] !== q.answerIndex)
    .map((q) => q.concept);
  const hard = state.current.flashcards
    .filter((card) => state.cardProgress[card.id]?.mark === "hard")
    .map((card) => card.front.replace(/\?$/, ""));
  return unique([...wrong, ...hard, ...state.current.weakConcepts]).slice(0, 6);
}

function renderGraphSvg(nodes) {
  const safe = nodes.slice(0, 6);
  const coords = safe.map((_, index) => {
    const x = 18 + (index % 2) * 38 + Math.floor(index / 2) * 4;
    const y = 18 + index * 14;
    return { x, y };
  });
  const lines = coords.slice(1).map((point, index) => {
    const prev = coords[index];
    return `<line x1="${prev.x}" y1="${prev.y}" x2="${point.x}" y2="${point.y}" />`;
  }).join("");
  const circles = safe.map((node, index) => {
    const point = coords[index];
    const label = truncate(node.title, 13);
    return `
      <g>
        <circle cx="${point.x}" cy="${point.y}" r="6"></circle>
        <text x="${point.x + 9}" y="${point.y + 3}">${escapeHtml(label)}</text>
      </g>
    `;
  }).join("");
  return `<svg viewBox="0 0 150 110" role="img" aria-label="Knowledge graph">${lines}${circles}</svg>`;
}

function compactWorkspaceForPrompt(workspace) {
  return {
    title: workspace.title,
    topic: workspace.topic,
    summary: workspace.summary,
    notes: workspace.detailedNotes,
    transcriptSnippets: workspace.transcriptSnippets,
    flashcards: workspace.flashcards,
    quizWeakConcepts: computeWeakConcepts(),
  };
}

function sourceModeLabel(mode) {
  return SOURCE_MODE_LABELS[mode] || SOURCE_MODE_LABELS.imported;
}

function hasUsableTranscript(value) {
  return String(value || "").trim().length >= MIN_LOCAL_TRANSCRIPT_CHARS;
}

function deriveWorkspaceTitle(input, snippets) {
  const url = (input.urls || [])[0] || "";
  const transcript = String(input.manualTranscript || "");
  const lower = transcript.toLowerCase();
  if (lower.includes("binary search")) return "Binary Search Explained";
  if (lower.includes("sorting")) return "Sorting Patterns";
  if (lower.includes("system design")) return "System Design Lesson";
  if (lower.includes("javascript")) return "JavaScript Lesson";
  const videoId = parseYouTubeId(url);
  if (videoId) return `YouTube Lesson ${videoId}`;
  const first = snippets?.[0] || "";
  return first ? titleFromSentence(first) : "Transcript Study Workspace";
}

function parseYouTubeId(url) {
  const text = String(url || "");
  const match = text.match(/[?&]v=([^&]+)/) || text.match(/youtu\.be\/([^?&]+)/);
  return match ? match[1].slice(0, 11) : "";
}

function titleFromSentence(sentence) {
  const words = String(sentence || "")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return words.length ? words.map(toTitleCase).join(" ") : "Transcript Study Workspace";
}

function extractTranscriptSnippets(transcript) {
  return String(transcript || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 24)
    .slice(0, 8);
}

function deriveConcepts(text) {
  const stop = new Set([
    "about", "after", "again", "array", "because", "before", "being", "could", "every", "lesson",
    "their", "there", "these", "thing", "those", "through", "using", "video", "watch", "where", "which",
    "while", "works", "would", "search", "sorted",
  ]);
  const counts = new Map();
  for (const raw of String(text || "").toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) || []) {
    const word = raw.replace(/-+/g, " ");
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => toTitleCase(word))
    .slice(0, 8);
}

function toTitleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : "")
    .join(" ");
}

function compactHistoryRecord(workspace) {
  return {
    id: workspace.id,
    title: workspace.title,
    topic: workspace.topic,
    savedAt: new Date().toISOString(),
    savedAtLabel: new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  };
}

function localGroundedAnswer(workspace, question) {
  const q = question.toLowerCase();
  if (q.includes("10") || q.includes("simple")) {
    return `${workspace.subtopic} is like guessing a number in a sorted list. You check the middle, then ignore the half that cannot contain the answer.`;
  }
  if (q.includes("fail") || q.includes("wrong")) {
    return `${workspace.subtopic} can fail when the input is not sorted or when boundaries move incorrectly. The lesson evidence emphasizes sorted input and off-by-one loops.`;
  }
  return `${workspace.summary} Evidence is limited to the current workspace, so review the notes and transcript snippets before applying it elsewhere.`;
}

function toolData(reply) {
  if (reply && reply.success === true && reply.data) return reply.data;
  if (reply && reply.data) return reply.data;
  return reply || {};
}

function extractLlmText(result) {
  const content = result?.content;
  if (typeof content === "string") return content;
  if (content?.type === "text") return content.text || "";
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  if (typeof result?.text === "string") return result.text;
  return "";
}

function parseJsonObject(text) {
  if (!text) return null;
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildPdf(lines) {
  const pageLines = [];
  for (let i = 0; i < lines.length; i += 38) pageLines.push(lines.slice(i, i + 38));
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const pagesRef = 2;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES_PLACEHOLDER");
  const fontRef = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageRefs = [];
  for (const chunk of pageLines) {
    const stream = [
      "BT",
      "/F1 11 Tf",
      "50 790 Td",
      "14 TL",
      ...chunk.flatMap((line) => [`(${pdfEscape(line).slice(0, 120)}) Tj`, "T*"]),
      "ET",
    ].join("\n");
    const streamRef = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageRef = add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${streamRef} 0 R >>`);
    pageRefs.push(pageRef);
  }
  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function splitLines(value) {
  return (value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function arrayOfStrings(value, fallback) {
  if (!Array.isArray(value)) return fallback || [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function arrayOfObjects(value, fallback) {
  if (!Array.isArray(value)) return fallback || [];
  return value.filter((item) => item && typeof item === "object");
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function stableId(value) {
  let hash = 0;
  const input = String(value || "learntube");
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return `lt-${hash.toString(16)}`;
}

function slugify(value) {
  return String(value || "workspace").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "workspace";
}

function scoreLabel(correct, total) {
  if (!total) return "No score";
  const pct = correct / total;
  if (pct >= 0.85) return "Strong";
  if (pct >= 0.6) return "Review soon";
  return "Needs revision";
}

function truncate(value, len) {
  const text = String(value || "");
  return text.length > len ? `${text.slice(0, Math.max(0, len - 1))}.` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function pdfEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatError(error) {
  return error?.message || error?.error?.message || String(error);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function nextStreak(lastDate, today, current) {
  if (!lastDate) return Math.max(1, current || 0);
  if (lastDate === today) return Math.max(1, current || 0);
  const prev = new Date(`${lastDate}T00:00:00Z`);
  const now = new Date(`${today}T00:00:00Z`);
  const delta = Math.round((now - prev) / 86_400_000);
  return delta === 1 ? Math.max(1, current || 0) + 1 : 1;
}
