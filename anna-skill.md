---
name: anna-app-builder
description: Build, test, package, publish, and maintain production Anna Apps with schema-2 UI bundles, Host APIs, bundled Executas, storage, LLM features, and marketplace release checks.
---

# Anna App Builder

Use this skill when an agent must create or change an Anna App end to end. The controlling workflow for this skill is the current [Build on Anna 101](https://forum.anna.partners/t/build-on-anna-101/228) guide. Anna is evolving quickly; reread that post before every build and prefer its Chapters 6–8 when another source describes an older publishing lifecycle. Treat the display name as presentation only: the app slug and server `app_id` determine which Anna app is changed.

This revision includes the complete LearnTube AI `1.0.0`–`1.0.8` production and Marketplace-review experience through 2026-08-24, Gaming Arena `1.0.0`, and Decision Room AI `1.0.0` local/live verification from 2026-08-24: duplicate app names, new Executa identity creation, four-platform binary delivery, production Agent handshake and Cloud-IP caption failures, explicit Agent permission declarations, Marketplace metadata and screenshots, UI-only app architecture, live Host LLM edge cases, deterministic model fallbacks, app/tool version freezing, install-versus-load diagnostics, exact-input testing, chat UX, mobile harness testing, review-candidate pinning, and the difference between installed, under review, approved, and Marketplace-public.

## 1. Start with current sources

1. Open and completely read [Build on Anna 101](https://forum.anna.partners/t/build-on-anna-101/228) in a browser.
2. Follow its sequence: Local Agent → environment → login → scaffold → implementation → bundled-handle audit → native binaries → `anna-app apps publish` → install/test → Developer page review → Developer page release.
3. Check the current CLI and environment:

   ```bash
   anna-app --version
   anna-app doctor
   anna-app whoami
   ```

4. Read the project's requirements file and inspect the entire template before changing code.
5. Run `anna-app validate --strict` before trusting an old example. The current schema, not a copied snippet, is authoritative.

### Identity gate — do this before the first remote write

Never assume that a familiar display name identifies the intended app. Two Anna apps can have the same name, while a slug can already belong to an unrelated legacy app.

1. Read `app.json` and write down the intended `slug`, display `name`, and version.
2. Check the remote slug before publishing:

   ```bash
   anna-app apps status <intended-slug> --account https://anna.partners --json
   ```

3. If the slug exists, compare its `app_id`, version history, listing, and purpose with the current project. Do not upload merely because the name looks right.
4. If it is a different app, choose a new globally unique slug and start the new app at `1.0.0`. Never repurpose the old record.
5. After the first successful remote creation, preserve `.anna/app.json`. It binds the local checkout to the server `app_id` and slug. Inspect it before later releases.
6. After every upload and review submission, run `apps status --json` again and verify the expected `app_id`, slug, version, and review candidate.

If an agent accidentally uploads to a legacy app, stop all release actions on that record. Do not delete, archive, cancel its review, or overwrite more versions without explicit user authorization. Correct the local slug, create the intended separate app, and report the legacy record separately.

Treat bundled Executa identity with the same care. Reusing an ignored `.anna/executa.json` or root `.anna/executas.lock.json` from a legacy app can make the new UI resolve to the legacy app's bundled tool. The UI may install while `apps grants <new-slug> --json` shows an empty `executa_grants` array, and invocation then fails with “Executa is not deployed on the selected agent.” For a genuinely separate app-bundled backend:

1. Give the Executa a new intentional slug.
2. Preserve the app's `.anna/app.json`, because it identifies the correct app.
3. Clear only the Executa identity cache with `anna-app executa cache-clear --cwd executas/<name>` and preserve/remove the stale root Executa lock before reminting.
4. Push or publish once and verify that `bundle/anna-tool-ids.js` contains a newly minted tool ID.
5. Verify the new tool with `anna-app executa status <tool-id> --json` and verify the app with `anna-app apps grants <app-slug> --json` after installation.

Do not copy credentials, PATs, signed dev URLs, storage tokens, or user data into logs, source control, fixtures, or screenshots.

## 2. Choose the correct architecture

Default to Anna's Host API. It preserves user identity, unified quota, permissions, cross-device storage, auditability, and platform compatibility.

Use the UI Host API directly for:

- model calls through `anna.llm.complete`;
- app data through `anna.storage` / APS;
- platform web, image, upload, chat, window, and preference features when the manifest permits them.

Add an Executa only when code truly needs a separate process, such as:

- a local filesystem, GPU, native library, or OS integration;
- an SDK or network protocol unavailable in the Host API;
- long-lived process state;
- a narrow third-party integration that cannot run in the static UI.

Do not put ordinary LLM or user storage work in an Executa. If an Executa needs user-scoped Anna services, use reverse RPC to the Host API instead of private API keys. See [Host API vs Executa](https://anna.partners/developers/apps/host-api-vs-executa).

## 3. Create the project contract

A typical schema-2 project contains:

```text
app.json
manifest.json
bundle/
  index.html
  app.js
  styles.css
  anna-tool-ids.js
executas/
  <executa-name>/
    executa.json
    <plugin source>
fixtures/
tests/
```

`app.json` is the CLI's project and bundled-Executa map. Use stable handles:

```json
{
  "slug": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "bundled_executas": {
    "data-helper": { "path": "./executas/data-helper" }
  }
}
```

In `manifest.json`, refer to a bundled dependency as `bundled:<handle>`. The UI authorizes the resolved required tool set rather than a development ID:

```json
{
  "schema": 2,
  "permissions": ["tools.invoke", "llm.complete", "storage.read", "storage.write"],
  "host_capabilities": ["llm.complete", "aps.kv"],
  "required_executas": [
    { "tool_id": "bundled:data-helper", "version": "latest" }
  ],
  "optional_executas": [],
  "ui": {
    "bundle": {
      "format": "static-spa",
      "entry": "index.html",
      "external_origins": []
    },
    "views": [
      {
        "name": "main",
        "title": "My App",
        "default": true,
        "entry": "index.html",
        "default_size": { "w": 1120, "h": 760 },
        "min_size": { "w": 320, "h": 480 },
        "max_size": { "w": 1600, "h": 1200 },
        "resizable": true,
        "movable": true,
        "single_instance": true
      }
    ],
    "host_api": {
      "tools": ["required:bundled:data-helper"],
      "llm": ["complete"],
      "storage": ["get", "set", "delete", "list"],
      "window": ["set_title", "ready"]
    }
  }
}
```

Important rules:

- `schema: 1` is for apps without a UI; `schema: 2` requires `ui`.
- Manifest parsing forbids unknown fields.
- Declare the least permission and Host API surface the app needs.
- A capability can require both a top-level permission and a matching `ui.host_api` ACL entry.
- Keep external origins empty unless the static bundle must contact that origin directly. Prefer Host APIs to direct remote calls.
- Treat a `dev` block as local-only. Publishing strips it.
- Store tags and assistant mention instructions in the manifest. Store listing metadata at the app level.
- The slug is globally unique and immutable after app creation. A display name may be duplicated, so always verify slug plus `app_id`.

During local development Anna maps each handle to a development tool. During push/publish it generates `bundle/anna-tool-ids.js` with `window.__ANNA_TOOL_IDS__`. Resolve it in the UI and keep a development fallback only for the local harness:

```js
const toolId = window.__ANNA_TOOL_IDS__?.["data-helper"] || "tool-dev-data-helper";
```

Never ship a production catalogue tool ID as a substitute for the generated mapping.

## 4. Build the UI as an Anna-hosted static app

1. Use semantic HTML, labelled controls, one `h1` per route, a skip link, visible focus styles, and keyboard-operable interactions.
2. Support the manifest's complete size range. Test the minimum width, default desktop size, and a tall/narrow mobile viewport.
3. Add `prefers-reduced-motion`; animate only composited properties where possible.
4. Avoid remote fonts and hidden CDN dependencies unless their origins and CSP are intentionally declared.
5. Keep application state separate from rendering. Put parse, normalize, schedule, search, and validation logic in pure modules that can be unit-tested.
6. Escape model- or user-produced strings before inserting HTML. Prefer `textContent` when practical.
7. Show clear empty, loading, success, cancellation, retry, offline, and permission-denied states.
8. Do not hardcode generated user content. Test fixture data belongs under `fixtures/`, never in production state.
9. Provide a bounded standalone fallback where useful, but clearly state when model, tool, or sync capabilities require Anna.

### Chat and mentor UI contract

A source-grounded chat is a workflow, not just a textarea followed by model text. Use this baseline:

1. The empty state explains what the mentor can answer, which evidence it uses, and what happens when the lesson does not cover the question.
2. Show the current source beside the conversation on wide screens and below it on narrow screens. Include the lesson title, source type, a short summary, and small counts such as key ideas, recall cards, or quiz prompts.
3. Render each message with an explicit role, compact avatar/marker, timestamp when available, and a clear visual difference between learner and mentor.
4. Render all user/model text as escaped text. Preserve useful line breaks and add `overflow-wrap: anywhere` so a long URL, JSON fragment, or unbroken token cannot create horizontal overflow.
5. Suggested questions must come from the generated lesson data. Limit them, keep them keyboard-operable, and hide the onboarding prompt block after the conversation starts so it does not interrupt long chat history.
6. Keep one pending request per conversation. Immediately append the learner's question, show a visible “reading the source” state, disable the composer and send button, and prevent double submission.
7. Use an auto-growing textarea with a bounded height, a visible character limit, a useful placeholder, a normal submit button, and `Ctrl+Enter`/`Cmd+Enter` as an optional shortcut. Do not make the shortcut the only way to send.
8. On failure, clear pending state, keep or restore the learner's question, re-enable the composer, and show an actionable retry message. Never leave a permanently disabled empty input.
9. After adding a question or answer, scroll only enough to reveal the latest message. Respect reduced-motion preferences.
10. Keep the evidence boundary visible: source-only answer, no invented citations, and an explicit “not covered” response when the evidence is absent.

Useful interaction state:

```js
const state = {
  mentorPendingLessonId: null,
};

function resizeMentorInput(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
}

page.addEventListener("keydown", (event) => {
  if (event.target.id !== "mentor-question") return;
  if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
  event.preventDefault();
  if (!state.mentorPendingLessonId) event.target.form?.requestSubmit();
});
```

### Shared navigation and responsive behavior

- Group navigation by user intent, for example `Workspace` for capture/library and `Study` for notes/cards/quiz/roadmap/mentor. Keep every destination on a separate route when the tasks are genuinely distinct.
- Use an open layout with typography, whitespace, and dividers before adding panels. Avoid turning every section into a rounded card.
- On narrow windows, change the fixed side rail into a reachable bottom navigation. Test every item at the manifest minimum width; seven compressed labels can become unreadable even when the layout technically fits.
- Add bottom body padding equal to the mobile navigation height. Move fixed toasts above the navigation so success/error messages do not cover route controls.
- Reset scroll position on route changes. Without this, opening Mentor from the bottom of a long Notes page can land halfway down the new page:

  ```js
  window.addEventListener("hashchange", () => {
    render();
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.getElementById("workspace").focus({ preventScroll: true });
  });
  ```

- Do not confuse the browser window width with the Anna app iframe width. The harness sizes the app from `ui.views[].default_size`; the responsive test procedure is in Section 8.

Read [UI Manifest](https://anna.partners/developers/apps/app-ui-manifest), [UI SDK](https://anna.partners/developers/apps/app-ui-sdk), and [UI Host API](https://anna.partners/developers/apps/app-ui-host-api) before wiring runtime calls.

## 5. Connect to the runtime safely

Load the SDK from Anna's same-origin path and fail gracefully outside the host:

```js
const { AnnaAppRuntime } = await import("/static/anna-apps/_sdk/latest/index.js");
const anna = await AnnaAppRuntime.connect();
await anna.window.ready({});
```

For model work:

- send the smallest sufficient source evidence;
- write a strict system prompt;
- request a documented JSON shape when the UI needs structured output;
- parse fenced or plain JSON defensively;
- validate and normalize every collection and scalar before rendering or storage;
- treat a structurally valid response that omits a promised collection as incomplete; after the repair attempt, derive a small deterministic fallback only from the returned notes/objectives/source evidence so cards and quizzes do not become empty screens;
- allow one repair retry for malformed JSON, then show a useful error;
- cap source chunks, response tokens, and persisted source size;
- never silently add facts to a source-grounded workflow.

For storage:

- namespace every key, for example `my-app/profile` and `my-app/items/<id>`;
- store a small index separately from larger records;
- version stored objects so migrations are possible;
- handle missing keys, stale IDs, partial writes, and quota errors;
- persist after every meaningful progress action;
- never store tokens or secrets in APS.

Read [LLM and Agent](https://anna.partners/developers/apps/llm-and-agent), [LLM Host API reference](https://anna.partners/developers/apps/reference/host-api-llm), and [Storage Host API reference](https://anna.partners/developers/apps/reference/host-api-storage).

## 6. Implement an Executa only when needed

An Executa is a line-oriented JSON stdio process. Keep stdout protocol-only and send diagnostics to stderr. A production Agent negotiates the protocol before discovery, so a helper that only supports `describe`, `health`, and `invoke` can pass simple local checks yet fail after installation. Support this complete baseline:

1. `initialize` — return the offered `1.1` or `2.0` protocol (fall back to `2.0`), `serverInfo`, and capability objects.
2. `describe` — return the stable tool manifest. Use the Agent-compatible parameter-list shape (`[{"name":"value","type":"string","required":true}]`), not an unverified JSON-Schema object.
3. `health` — return a ready/healthy state and the running version.
4. `invoke` — return a stable `{success,data}` or `{success:false,error}` envelope.
5. `shutdown` — acknowledge cleanly.
6. Notifications such as `notifications/initialized` have no request ID and must not produce a response.

A minimal initialization result is:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2.0",
    "serverInfo": { "name": "Data Helper", "version": "1.0.0" },
    "client_capabilities": {},
    "capabilities": {}
  }
}
```

Test the ordered production handshake (`initialize` → notification → `describe` → `health` → `shutdown`) against the source process and every released Windows/Linux executable. A successful one-shot `describe` by itself is not sufficient.

Each Executa needs an `executa.json` describing identity, version, type, and distribution. Keep local and binary profiles separate:

```json
{
  "slug": "data-helper",
  "name": "Data Helper",
  "version": "1.0.0",
  "executa_type": "tool",
  "tool_id": "tool-<developer>-data-helper-<suffix>",
  "type": "python",
  "distribution": {
    "active": "binary",
    "profiles": {
      "local": {
        "type": "local",
        "package_name": "tool-<developer>-data-helper-<suffix>",
        "executable_name": "tool-<developer>-data-helper-<suffix>",
        "supports_protocol": true
      },
      "binary": {
        "type": "binary",
        "package_name": "tool-<developer>-data-helper-<suffix>",
        "executable_name": "tool-<developer>-data-helper-<suffix>",
        "supports_protocol": true,
        "binary_artifacts": {
          "darwin-arm64": { "path": "dist/tool-<developer>-data-helper-<suffix>-1.0.0-darwin-arm64.tar.gz", "entrypoint": "bin/tool-<developer>-data-helper-<suffix>", "format": "tar.gz" },
          "darwin-x86_64": { "path": "dist/tool-<developer>-data-helper-<suffix>-1.0.0-darwin-x86_64.tar.gz", "entrypoint": "bin/tool-<developer>-data-helper-<suffix>", "format": "tar.gz" },
          "linux-x86_64": { "path": "dist/tool-<developer>-data-helper-<suffix>-1.0.0-linux-x86_64.tar.gz", "entrypoint": "bin/tool-<developer>-data-helper-<suffix>", "format": "tar.gz" },
          "windows-x86_64": { "path": "dist/tool-<developer>-data-helper-<suffix>-1.0.0-windows-x86_64.zip", "entrypoint": "bin/tool-<developer>-data-helper-<suffix>.exe", "format": "zip" }
        }
      }
    }
  }
}
```

After Anna mints the immutable production tool ID, use that exact ID consistently in `executa.json`, the local and binary `package_name` and `executable_name` fields, the protocol `describe.name`, the Python/package script name, and each packaged binary entrypoint. Keep `bundled:<handle>` in the app manifest; the production ID belongs in the Executa package identity and generated sidecar, not as a replacement for the bundled handle.

Do not omit `package_name`. A binary row can register and upload successfully while the Agent refuses to install it because `package_name` is null. The symptoms can be misleading: the app UI installs, `apps grants` reports the app-level permissions as satisfied but returns an empty `executa_grants` array, and runtime invocation says the tool is not deployed. Correct the package identity, bump the immutable Executa version, rebuild every native artifact with the matching entrypoint, raise the app dependency's `min_version`, cut a new app version, then reinstall and verify the exact Agent tool row.

Agent installation and Agent loading are separate states. `is_installed: true` plus `install_status: success` is still broken when `agent_loaded` or `agent_running` is false. If Agent Details reports “Package installed but failed to load as Executa plugin” or starting the helper fails, compare the released binary with the full handshake above. After publishing the fixed immutable helper version, use the exact helper's Upgrade action in each Agent's details; do not run a broad “install all” action. Verify all of these on every selectable Agent:

```text
agent_loaded: true
agent_running: true
agent_version: <fixed-version>
agent_tools_count: > 0
install_error: null
```

Cloud and Local Agents have independent process state. A tool can be running on Cloud while still unloaded locally, so repair and test both rows separately.

App versions freeze the Executa state that exists when the version is cut. If a helper must be independently deployable during pre-approval testing, run `anna-app executa publish --publish` only after validating its release/security scope and before cutting the app version. Flipping the Executa to public after an app version was already cut does not repair that frozen app dependency; bump and cut a new app patch version, pin it for review, reinstall it, and re-check `apps grants` plus a real invocation. Keep a helper `app_bundled` when independent public invocation is not appropriate and let the normal approved-app release anchor it instead.

Test the plugin by itself before running the app:

```bash
anna-app executa dev --dir executas/data-helper --describe --json
anna-app executa dev --dir executas/data-helper --health --json
anna-app executa dev --dir executas/data-helper --invoke data.method --args '{"value":"test"}' --json
```

For Python, pin supported dependency ranges and commit the lockfile. Normalize third-party exceptions into user-actionable codes such as `invalid_input`, `not_found`, `captions_disabled`, `rate_limited`, or `temporarily_unavailable`.

## 7. Run deterministic local tests

Use a layered test sequence:

```bash
# Pure logic
npm test

# Plugin tests
uv run --project executas/data-helper --with pytest pytest executas/data-helper -q

# Syntax and schema
node --check bundle/app.js
anna-app validate --strict

# UI harness with canned model output
anna-app dev --mock-llm fixtures/happy-path.jsonl
```

The local harness uses the production dispatcher contract, an iframe, in-memory window state, and auto-discovered Executas. It prints an RPC log; verify the exact requested methods and storage keys.

### Mock-LLM matcher failure observed in CLI `0.1.49`

The `anna-app dev --mock-llm` dispatcher was observed to build its match text with the equivalent of:

```js
String(args.args?.content ?? args.args?.messages ?? "")
```

For `anna.llm.complete`, `messages` is an array of objects, so this becomes `[object Object]`. A fixture such as:

```json
{"ns":"llm","method":"complete","match":{"contentIncludes":"LESSON NOTES"},"result":{}}
```

cannot match the actual prompt. When several entries have the same `ns` and `method`, the dispatcher falls back to the first one. In LearnTube this made lesson generation work, but the later Mentor call received the lesson-generation JSON instead of the configured conversational answer.

Rules until a later CLI version is verified:

1. Do not claim that `contentIncludes` successfully selected between multiple `llm.complete` fixtures merely because the RPC returned `200`/success.
2. Inspect the harness RPC response and the rendered text. A raw lesson JSON object inside chat is a fixture-selection failure, not proof that the production mentor prompt is wrong.
3. Use one scenario-specific LLM fixture per harness run when calls need different response shapes. Start separate harness processes for lesson-generation QA and Mentor-answer QA, or use a seeded lesson with a Mentor-only fixture.
4. Do not reorder the two fixtures as a “fix”; that only changes which workflow receives the wrong response.
5. Use real account-backed LLM testing only when the user authorized it and the quota/data impact is understood.
6. Re-test the matcher after every CLI upgrade and remove this workaround only after the RPC log proves content-based selection works.

For real account-backed development, first understand quota and data impact, then use the documented account flag. Do not use real billing merely to avoid writing fixtures.

## 8. Browser QA checklist

Test inside the Anna harness, not only as a standalone page.

The harness uses the selected view's `default_size` as the iframe viewport. Shrinking the outer Chrome/browser viewport is not a valid mobile test when the iframe still reports `1120×760`; it can merely create a horizontally clipped desktop canvas.

For a real minimum-width check:

1. Copy `manifest.json` to a temporary QA manifest.
2. Change only the QA view's `default_size`, for example to `{ "w": 390, "h": 780 }`. Preserve the real minimum, maximum, host API, permissions, and Executa declarations.
3. Run a second harness on a free port while explicitly passing the original bundle:

   ```bash
   anna-app dev --port 5191 --manifest manifest.qa-mobile.json --bundle bundle --mock-llm fixtures/happy-path.jsonl
   ```

4. Confirm the harness title bar says `390×780`, not the desktop size.
5. Check the app document, not the outer harness, for overflow. The useful assertion is `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
6. Exercise fixed navigation, toasts, route changes, the composer, long messages, and the context rail at that size.
7. Stop the exact QA server/listener and delete the temporary manifest after testing. Do not commit a one-off viewport manifest.

When starting a harness in the background on Windows, launch it hidden and record the PID/port. Before cleanup, resolve the exact listeners for those QA ports; do not stop unrelated Node, Python, or PowerShell processes.

For every route:

- no duplicate IDs;
- all controls have accessible names or associated labels;
- heading levels do not jump;
- images have meaningful `alt` text or empty decorative `alt`;
- no horizontal overflow at minimum width;
- focus remains visible and keyboard navigation works;
- empty and populated states are useful;
- no application errors in the browser console;
- no unhandled promise rejections;
- storage writes happen after edits, reviews, answers, and progress changes.

Exercise full flows: create, persist, reload, select, search, update, delete with confirmation, failure/retry, model output repair, tool failure, offline fallback, and export/download. Validate downloads by checking their binary header and terminator in an automated test when a browser harness cannot capture Blob downloads.

Browser extensions can inject warnings and errors into otherwise clean local pages. Filter console results by URL before treating them as app failures. Messages from `chrome-extension://...` are not LearnTube/Anna bundle errors; errors from the app bundle, harness origin, or runtime SDK still require investigation.

Hot reload can preserve the harness runtime state but replace the iframe document. Re-acquire frame/element handles after reload before continuing QA. Do not assume a stale automation locator proves the app stopped working.

Use the harness recorder and fixture tools when useful. See [Local Development](https://anna.partners/developers/apps/local-dev), [Local LLM Development](https://anna.partners/developers/apps/local-dev-llm), and [Testing the Bundle](https://anna.partners/developers/apps/testing-bundle).

## 9. Build four platform artifacts

Binary Executas should cover the current Anna desktop targets:

- `darwin-arm64`;
- `darwin-x86_64`;
- `linux-x86_64`;
- `windows-x86_64`.

Build each binary on its native GitHub Actions OS. Do not cross-package a Python executable by renaming files. At the time this skill was written (2026-08-23), verify current runner labels in [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners); examples include `macos-14` for Apple Silicon and `macos-15-intel` for Intel.

For each archive:

1. Use the exact path declared in `executa.json`.
2. Put the declared entrypoint at the archive root.
3. Mark Unix entrypoints executable.
4. Run describe and health checks on the built executable where possible.
5. Inspect zip/tar contents and reject nested or missing entrypoints.
6. Do not commit build caches, virtual environments, PyInstaller work folders, secrets, or downloaded release artifacts.

For a reproducible public binary release, use a GitHub Actions matrix and a GitHub Release:

- build on native macOS ARM, macOS Intel, Linux x86_64, and Windows x86_64 runners;
- give the workflow `contents: write` only when it must create a release;
- upload the four archives and a SHA-256 file for each archive;
- keep filenames identical to `executa.json` paths;
- keep the public release tag stable for an immutable Executa version;
- confirm all eight release assets are publicly downloadable before Anna publication.

Anna hosts the static UI bundle. GitHub Release assets are for reproducible native Executa distribution; a separate website host is not required for the app UI.

Before creating the immutable Executa version, verify the platform upload plan:

```bash
anna-app executa upload-binaries --dir executas/<executa> --dry-run --account https://anna.partners --json
```

Each platform should report `exists` when the exact asset is already on Anna's CDN or `upload` when it still needs uploading. Do not infer deployment readiness merely from a GitHub Release.

## 10. Preflight and upload

The current Build on Anna 101 Chapter 7.6 lifecycle uploads the App, UI bundle, bundled Executa, four native archives, and creates an immutable version in one command:

```bash
anna-app validate --strict
anna-app apps publish --dry-run --account https://anna.partners
anna-app apps publish --account https://anna.partners
```

For a UI-only app patch after the required Executa is already published, immutable, installable, loaded, running, and unchanged, the CLI supports skipping a redundant helper publication:

```bash
anna-app apps publish \
  --skip-executa-publish \
  --account https://anna.partners \
  --json
```

Use that flag only when all of these are true:

- `executa.json`, its package metadata, binary URLs/checksums, and native archives did not change;
- the manifest's bundled handle and `min_version` did not change;
- the exact helper version is already available through Anna;
- Local and Cloud Agents already report the helper loaded/running;
- the app change is confined to the UI, listing, prompts, or app-side logic.

Do not use it to hide an unbuilt helper change. After upload, record and verify `app_id`, slug, version, `version_id`, content hash, bundle status, file count, and total size from the JSON response.

Set `distribution.active` to `binary` for the formal release. Do not manually replace the bundled handle, the production tool ID, or the generated `anna-tool-ids.js` mapping; `apps publish` performs those associations.

Observed with Anna CLI `0.1.49` on 2026-08-23: `apps publish` also prints that an Option-C working-draft flow is preferred:

```bash
anna-app apps push
anna-app apps cut <version>
```

These are two different creation paths. Do not blindly mix them:

- Follow the live forum guide's `apps publish` path when that remains Chapter 7.6's documented end-to-end release flow. It directly creates the immutable version and may leave the Developer page saying “No working draft yet”; that is expected.
- Use `apps push` followed by `apps cut <version>` only when the current guide or the user's chosen workflow explicitly adopts the mutable working-draft path. `push` alone does not create the immutable review candidate.
- Never run `apps release` just because the CLI prints it after upload. Public release happens only after the exact version passes review, using the method specified by the current guide.
- Record which path was chosen and use it consistently for that version.

Before either upload path:

- all local tests pass;
- strict validation passes;
- every referenced binary archive exists;
- generated tool-handle mapping is correct;
- version strings agree across `app.json`, the app manifest/version, Executa metadata, packages, and artifact names;
- no secrets or development URLs are present;
- listing copy accurately describes observed behavior.

After a first `apps publish`, expect output similar to:

```text
apps/<slug>: version 1.0.0 published
UI bundle: bundle_ready
status: draft
first publish — wrote .anna/app.json
```

Here “published” means the immutable version was uploaded to the Developer Console; it does not mean Marketplace-public. Confirm the remote state:

```bash
anna-app apps status <slug> --account https://anna.partners --json
```

Before review, the expected fields are `status: "draft"`, `is_published: false`, the intended version in `latest_version`, and `review_candidate_version: null`. A Developer card may show `v0.0.0` while the app is unpublished even though the Versions tab correctly contains `1.0.0 bundle_ready`; verify the Versions tab or status JSON rather than assuming the upload failed.

The same owned Executa identity can resolve to the same production `tool_id` when bundled by more than one app. A separate app slug therefore does not automatically create a separate Executa. If the backend must also be independent, give the Executa its own intentional slug and release identity.

Executa versions are immutable. If binary URLs or binary content are added after an Executa version was already created, a later cut can fail with `Version ... already published with different content (changed: binary_urls)`. Do not rename old archives or try to mutate that version. Bump the Executa version consistently in `executa.json`, the Python/package metadata, the protocol manifest, artifact filenames, and the build workflow; rebuild all four native artifacts; verify checksums; then create the corrected app version. The guide's atomic `apps publish` path is a safe recovery when it uploads the Executa binaries and immutable app version together. If the current guide uses working drafts, follow its exact binary-before-cut ordering and do not mix in manual uploads after freezing.

If an owned app is archived, inspect status first and explicitly restore it:

```bash
anna-app apps status <slug> --account https://anna.partners
anna-app apps unarchive <slug> --yes --account https://anna.partners
```

Do not unarchive, push, cut, submit, or release a user-owned app unless the task authorizes publishing.

## 11. Complete the marketplace listing and review

Listing fields are app-level and shared by all versions. The manifest does not contain them. Fill in:

- name and immutable slug;
- category;
- tagline up to 160 characters;
- long description;
- square logo (the Console accepts JPEG, PNG, WebP, or GIF up to 2 MB and produces 256×256 WebP);
- optional cover and up to six screenshots;
- homepage, support, and privacy URLs when applicable.

Then open the Anna Developer page, install the uploaded version, and use it end to end in Anna. Confirm both the Local Agent and Anna Cloud Agent/Linux workflow before review.

When duplicate display names exist, confirm the installed record from its Permissions dialog: it must show the intended slug and version. Also confirm that every declared permission is granted. An installation toast such as `Installed "My App" (v1.0.0)` plus an Installed Apps entry for `<intended-slug> · v1.0.0` verifies the selected package, not just the display name.

Also run:

```bash
anna-app apps grants <slug> --account https://anna.partners --json
```

For an app with required bundled tools, inspect `executa_grants`, but do not use it as the only deployment signal. Owner/developer self-installs were observed on 2026-08-23 to return an empty `executa_grants` list even while the signed app-window token contained `tools.required:<production-tool-id>` and the selected Agent reported the helper loaded/running. The authoritative test is the combination of: correct installed app version, correct required-tool scope, exact Agent tool row loaded/running at the required version, and a successful real `tools.invoke`. Conversely, `satisfied: true` with no running Agent process does not prove the helper works.

Submit the tested version from its Anna Developer page or, when the authenticated CLI supports it, with the exact slug:

```bash
anna-app apps submit-review <slug> --account https://anna.partners
anna-app apps status <slug> --account https://anna.partners --json
```

Do not stop at the success message. The status verification must show:

```json
{
  "status": "pending_review",
  "review_candidate_version": "<exact-version>"
}
```

Versions created after submission are not automatically part of that review round. Re-run `apps submit-review` to pin the newest intended version, then verify `review_candidate_version` again.

### Update installation can stay on the previous review candidate

This is especially important when an app is already `pending_review` and a newer immutable version is uploaded.

Observed LearnTube sequence:

```text
before upload:
  latest_version = 1.0.6
  review_candidate_version = 1.0.6

after apps publish 1.0.7:
  latest_version = 1.0.7
  review_candidate_version = 1.0.6
  status = pending_review

generic developer install at this point:
  installed_version = 1.0.6
```

The upload did not fail. The generic developer install followed the pinned candidate. Supplying `1.0.7` in an undocumented install request body was also observed to leave the installation on `1.0.6`; do not rely on private endpoint parameters to select a version.

For an already-under-review app update:

1. Upload the new immutable version.
2. Run `apps status` and compare `latest_version.version` with `review_candidate_version`.
3. Prefer a version-specific **Install & test** action in the current Developer UI if it is available.
4. If the generic install can only install the pinned candidate, re-run `apps submit-review <slug>` with authorization to pin the new version.
5. Verify `review_candidate_version` now equals the intended version.
6. Install again and verify the installation response or Installed Apps Permissions page reports the exact version.
7. Run `apps grants` and the real critical workflow before treating the version as tested.

CLI `0.1.49` has no public `apps install` subcommand. Use the current Developer UI for installation rather than scripting undocumented endpoints in a reusable workflow. An automated/private install used during debugging must never print the stored PAT and must still be verified with the exact installed version.

An install response can contain `installed_executas: []` while an unchanged helper remains installed and running from an earlier app version. Combine that response with the exact Agent tool row and a real invocation; do not infer success or failure from that array alone.

After Anna approves that exact version, return to the Developer page and release it using the current guide's approved-version action. Every new public version repeats install, testing, review, approval, and release.

Never claim the marketplace release is live while it is awaiting admin approval. Report the exact remote status and version.

Re-read Chapters 7.6–8.3 of [Build on Anna 101](https://forum.anna.partners/t/build-on-anna-101/228) immediately before submission because this lifecycle can change.

## 12. Release verification and maintenance

After release:

1. Install the published version from Anna.
2. Verify the resolved Executa ID, UI bundle, model calls, storage, and every critical user journey.
3. Test a tool failure and confirm it becomes a helpful UI message.
4. Confirm old saved data migrates or still loads.
5. Check the App Store listing, screenshots, privacy/support links, and exact version.
6. Record the changelog and Git tag.
7. For updates, bump semver, rebuild all affected artifacts, use the same upload lifecycle selected from the current guide, retest, and release after required review.

For updates, either publish the new immutable version directly or push a working draft and cut it, according to the current guide and selected lifecycle. Never reuse an immutable version number, and never release a version that differs from `review_candidate_version`.

## 13. Copy-paste operator checklist

Replace angle-bracket placeholders before running commands. Stop whenever a slug, `app_id`, or version differs from the intended values.

```bash
# 1. Environment and identity
anna-app --version
anna-app doctor
anna-app whoami
anna-app apps status <slug> --account https://anna.partners --json

# 2. Deterministic verification
npm test
uv run --project executas/<executa> --with pytest pytest executas/<executa> -q
anna-app validate --strict

# 3. Guide-controlled direct upload path
anna-app apps publish --dry-run --account https://anna.partners
anna-app apps publish --account https://anna.partners

# For a verified UI-only patch with an unchanged published helper:
# anna-app apps publish --skip-executa-publish --account https://anna.partners --json

# 4. Confirm the remote version before installing anything
anna-app apps status <slug> --account https://anna.partners --json
```

If the current guide explicitly selects working drafts, replace step 3 with:

```bash
anna-app apps push --dry-run --account https://anna.partners
anna-app apps push --account https://anna.partners
anna-app apps cut <version> --dry-run --account https://anna.partners
anna-app apps cut <version> --account https://anna.partners
anna-app apps status <slug> --account https://anna.partners --json
```

Before either remote upload path, confirm that the user authorized creating or updating that exact slug. Installation, review submission, and approved-version release also require clear authorization at the time of the action.

Then complete these manual/platform checks in order:

1. Open [Anna Developer Console](https://anna.partners/developer) and select the app by slug, not display name.
2. Verify listing text, unique logo, homepage, support, privacy URL, and optional screenshots.
3. Open Versions and verify `<version>`, `bundle_ready`, the resolved required Executa, and the resolved `ui.host_api.tools` ACL.
4. With user authorization, install that version. If the app is already under review, first compare latest and candidate; a generic install may select the previous candidate.
5. In Installed Apps → Permissions, verify `<slug> · <version>` and all declared grants.
6. Run the critical workflow on a Local Agent and on Anna Cloud Agent/Linux when supported.
7. With user authorization, submit and verify the pinned candidate:

   ```bash
   anna-app apps submit-review <slug> --account https://anna.partners
   anna-app apps status <slug> --account https://anna.partners --json
   anna-app apps grants <slug> --account https://anna.partners --json
   ```

8. Stop while status is `pending_review`; this is uploaded and under review, not public.
9. After admin approval and with user authorization, release the approved version through the current guide's Developer Console action.
10. Reinstall from the public Marketplace and repeat the critical workflow before declaring completion.

Definition of done:

- local tests and strict validation pass;
- all required native artifacts and checksums exist;
- remote slug and `app_id` match the intended app;
- the uploaded version is `bundle_ready`;
- the installed record shows the exact slug and version;
- the full workflow works locally and in supported cloud/Linux execution;
- `review_candidate_version` is exact;
- after approval, the Marketplace lists the exact released version and a clean-account install succeeds.

## 14. LearnTube AI worked example and failure ledger

This case study is evidence, not a template identity. Never copy its production IDs into another app.

### Final verified identities on 2026-08-23

```text
Intended app name:            LearnTube AI
Intended app slug:            learntube-study
Anna app_id:                  208
Latest uploaded app version:  1.0.7
Latest version_id:            566
Installed version:            1.0.7
Review candidate:             1.0.7
Remote status:                pending_review
Marketplace public:           no

Bundled handle:               bundled:youtube-transcript
Generated handle key:         youtube-transcript
Production Executa ID:        tool-nikku696969-learntube-study-transcript-ujzngt7x
Required/helper version:      1.0.3
Local Agent state:            loaded and running
Cloud Agent state:            loaded and running
```

Source and binary build repository:

- https://github.com/imthegoodboy/learntube-ai-anna-app
- release branch: `learntube-release-1.0.0`
- four-platform successful build: https://github.com/imthegoodboy/learntube-ai-anna-app/actions/runs/32643109893

The user also owned an older, unrelated LearnTube app with the same display name but slug `learntube-ai`. Its similar name was never authority to overwrite it. The new project was kept on `learntube-study` / `app_id 208`.

### Failure 1 — duplicate display name pointed at the wrong app

**Symptom:** Developer/Installed Apps showed more than one “LearnTube AI”, including an older application with different metadata and version history.

**Cause:** Anna allows duplicate display names. The old app and new project were separate records.

**Fix:** Use `learntube-study` and `app_id 208` as the identity gate. Keep `.anna/app.json`; verify status before every upload. Do not edit/delete the old `learntube-ai` record.

**Proof:** Every later `apps status`, publish response, version row, install, and grants response reported slug `learntube-study` and `app_id 208`.

### Failure 2 — app resolved a helper that was not deployed

**Symptom:** Runtime error similar to:

```text
executa 'tool-nikku696969-learntube-transcript-mybqe3kq' is not deployed on the selected agent
```

**Cause:** The app/helper identity came from a legacy or stale Executa mapping. The selected Agent did not have that exact production tool.

**Fix:** Give the new helper an intentional new identity, clear only its stale Executa cache/lock, keep `bundled:youtube-transcript` in the manifest, publish once, and verify `bundle/anna-tool-ids.js` resolves to the newly minted LearnTube Study helper.

**Proof:** The final mapping and Agent row used `tool-nikku696969-learntube-study-transcript-ujzngt7x`.

### Failure 3 — UI exposed a raw deployment/tool ID error

**Symptom:** Learners saw infrastructure wording and a production tool ID instead of a recovery path.

**Cause:** `anna.tools.invoke` rejection was displayed directly.

**Fix:** Normalize known deployment errors into a user message that says the transcript helper is not ready for the selected Agent, suggests update/reinstall, and offers **Paste transcript** as a working fallback. Keep the technical error in diagnostics, not user copy.

**Proof:** Unit tests cover the redaction/recovery message, and the manual-input path remains usable without the helper.

### Failure 4 — binary metadata could install incorrectly when `package_name` was absent

**Symptom:** Tool metadata existed, but Agent install/upgrade paths could fail or report an invalid `package_name` type.

**Cause:** A binary distribution declared an executable/binary URL without a stable string `package_name`.

**Fix:** Set both `package_name` and `executable_name` to the immutable production tool ID in the active local/binary profiles. Keep entrypoint names consistent in every archive.

**Proof:** The final helper installed as version `1.0.3` on both Agents with no install error.

### Failure 5 — a source helper was not sufficient for real users

**Symptom:** Local Python execution could work, but users on other Agent platforms would need source dependencies or have no executable.

**Cause:** Local/source distribution is not a cross-platform release.

**Fix:** Build native artifacts on macOS ARM, macOS Intel, Linux x86_64, and Windows x86_64. Verify archive entrypoints and SHA-256 values, create a public immutable GitHub Release, then publish/upload them through Anna.

**Proof:** The four-platform CI run completed successfully and the Agent installed the native helper.

### Failure 6 — helper installed but production Agent could not load it

**Symptom:** The app installed; Agent details could show package installation success, but the helper was unloaded/not running and the UI still said it was unavailable.

**Cause:** The process supported simple local `describe`/`health`/`invoke`, but production Agent first sent `initialize`, followed by `notifications/initialized`, and later `shutdown`. The old helper rejected or mishandled that handshake. Its `describe` parameter shape also had to match Agent expectations.

**Fix:** Implement the complete handshake, return no response to no-ID notifications, use a parameter-list tool manifest, bump the immutable helper to `1.0.3`, rebuild all four native artifacts, publish, and upgrade that exact helper on each Agent.

**Proof:** Both Local and Cloud rows reported:

```text
agent_loaded: true
agent_running: true
agent_version: 1.0.3
agent_tools_count: 1
install_error: null
```

Six Python tests include the ordered production handshake and tool behavior.

### Failure 7 — changing a published helper without a new version was impossible

**Symptom:** Corrected binary URLs/content could not replace an already-created immutable helper version; app cuts could freeze the old snapshot.

**Cause:** Executa and app versions are immutable. Later visibility/binary changes do not retroactively repair an earlier frozen dependency.

**Fix:** Bump the helper, package metadata, protocol version, archive names, checksums, and app `min_version` together. Publish the corrected helper before the new app version, then reinstall/upgrade.

**Proof:** App versions from `1.0.6` onward require helper `1.0.3`, the first version with the verified production handshake.

### Failure 8 — metadata looked healthy but only a real invocation proved captions worked

**Symptom:** Catalogue, install, and Agent rows could all look correct while the original user workflow remained untested.

**Fix:** Run the exact requested video through the installed production app:

```text
https://youtu.be/vf-cxgUXcMk?si=inAYZAmIUL4eNYEb
```

**Proof:** The helper returned `403` caption segments and LearnTube generated a saved source-grounded lesson. Keep **Paste transcript** because caption availability and cloud-IP behavior remain external constraints.

### Failure 9 — valid model JSON could still leave Cards or Quiz empty

**Symptom:** The model returned a parseable lesson object but omitted flashcards or quiz questions, producing empty feature pages.

**Cause:** JSON validity is not product completeness.

**Fix:** Normalize every collection. After one repair attempt, derive a small deterministic set of flashcards and quiz questions only from returned key ideas/objectives/summary. Never add outside facts.

**Proof:** A unit test passes a lesson with missing practice collections and verifies populated, source-grounded fallbacks.

### Failure 10 — mock Mentor returned the lesson-generation JSON

**Symptom:** Clicking a suggested Mentor question submitted correctly, but chat rendered the full lesson JSON.

**Cause:** CLI `0.1.49` mock matching stringified the messages array as `[object Object]`; `contentIncludes: "LESSON NOTES"` never matched, so the first `llm.complete` fixture won.

**Fix:** Use scenario-specific fixtures/separate harness runs and inspect RPC responses. Do not rewrite production chat logic merely to compensate for the local dispatcher bug.

**Proof:** The keyboard/send/persistence UI path worked; the RPC log showed the wrong canned fixture was selected before the response reached app code.

### Failure 11 — desktop-only browser resizing did not test the mobile app

**Symptom:** A narrow Chrome screenshot showed a clipped `1120×760` desktop app rather than the mobile breakpoint.

**Cause:** The Anna harness iframe width came from the manifest's desktop `default_size`, independent of the outer browser viewport.

**Fix:** Run a temporary second manifest at `390×780`. Verify the harness-reported size and compare the app document's `scrollWidth` and `clientWidth`.

**Proof:** At a measured `375 px` app content width, LearnTube had `scrollWidth === clientWidth`, all seven navigation destinations remained present, and the Mentor composer was visible.

### Failure 12 — route changes preserved the previous page's scroll position

**Symptom:** Opening Mentor from low on the Notes page landed in the middle of Mentor, hiding its introduction and context.

**Cause:** Hash navigation rerendered content but intentionally focused the workspace with `preventScroll`, leaving the old document scroll offset untouched.

**Fix:** Reset window scroll to the top after render, then focus the workspace. Also move fixed mobile toasts above the bottom navigation and add bottom body padding.

**Proof:** Repeated narrow-window route changes start at the route heading, with no horizontal overflow or toast-covered navigation.

### Failure 13 — the old Mentor UI had no useful pending/error state

**Symptom:** After submission the input became disabled with no clear progress, messages had weak hierarchy, and a failed request could lose the typed question.

**Fix:** LearnTube `1.0.7` added message roles/avatars/times, generated starter questions, source context, a visible reading state, duplicate-submit protection, an auto-growing `1200`-character composer, character count, keyboard shortcut, latest-message reveal, and input restoration on error. Starter prompts disappear after conversation begins.

**Proof:** Desktop and `390×780` harness QA exercised prompt selection, character-count update, keyboard submission, route navigation, and responsive composition.

### Failure 14 — publishing `1.0.7` did not update the installed version

**Symptom:** `apps publish` created version `1.0.7`, but generic install returned `installed_version: "1.0.6"`.

**Cause:** The app was already `pending_review`; the review candidate remained pinned to `1.0.6`. Latest uploaded and review candidate are independent fields.

**Fix:** Run `apps submit-review learntube-study`, verify candidate `1.0.7`, install again, then verify grants.

**Proof:** Final status/grants reported:

```text
latest_version.version:     1.0.7
review_candidate_version:   1.0.7
installed_version:          1.0.7
update_available:           false
bundle_status:              bundle_ready
```

### Failure 15 — uploaded and installed did not mean App Store public

**Symptom:** The app was absent from the Marketplace even though versions, installation, grants, and review submission existed.

**Cause:** Final state was `pending_review`, `is_published: false`, with no approved public version. “Publish” in the CLI upload command meant creating the immutable developer version, not Marketplace release.

**Fix:** Stop and report the true state. Wait for Anna administrator approval of exact candidate `1.0.7`; only then use the current approved-version release action with authorization. Reinstall from the public Marketplace afterward.

### LearnTube `1.0.7` final verification gate

```bash
npm test
# 9 JavaScript tests passed

uv run --project executas/my-first-anna-app --with pytest pytest executas/my-first-anna-app -q
# 6 Python tests passed

anna-app validate --strict
# passed with CLI 0.1.49 / dispatcher schema 0.19.0

anna-app apps status learntube-study --account https://anna.partners --json
anna-app apps grants learntube-study --account https://anna.partners --json
anna-app apps versions learntube-study --account https://anna.partners --json
```

The source commit for the Mentor/navigation release was `8ddfd6f` (`Improve Mentor chat and workspace navigation`). The exact repository state was clean before handoff.

## Gaming Arena 1.0.0: UI-only app, realtime rooms, and listing assets

Gaming Arena was built as a completely separate app at
`C:\Users\parth\Desktop\anna-gaming-arena`. Its source repository is
https://github.com/imthegoodboy/anna-gaming-arena.

Final identities and state on 2026-08-23:

```text
App slug:                   anna-gaming-arena
Anna app id:                213
Uploaded version:           1.0.0
Anna version id:            567
Uploaded content hash:      b86797ca965438ac75e09c94b16d02a8461636610ccf18dd33e6d5cea2776e21
Realtime Worker:            anna-gaming-arena-live
Realtime origin:            https://anna-gaming-arena-live.anna-gaming-arena.workers.dev
Git commit after metadata:  8a59598
Anna status:                pending_review
Review candidate:           1.0.0
Installed Apps version:     1.0.0
Public App Store status:    not public until Anna approval and release
```

### Lesson 1 — an Anna UI app can intentionally have no Executa

Gaming Arena uses deterministic browser game engines, Anna Storage, and an
HTTPS/WebSocket room service. Its production manifest has:

```json
{
  "required_executas": [],
  "optional_executas": []
}
```

This is valid and passed strict validation. It avoids the selected-Agent,
native-binary, and tool-install failure class entirely. Do not add a dummy
Executa merely because the scaffold generated one. Remove the generated
Executa directory when the app does not need machine-local work.

### Lesson 2 — Anna Storage is not a cross-user room database

Anna Storage is namespaced to the current user/app. It is appropriate for
profile settings, personal scores, and recent history, but two Anna users
cannot use it as shared match state.

Gaming Arena uses Cloudflare Durable Objects for:

- one strongly ordered object per room
- a global per-game matchmaking queue
- a server-verified public leaderboard
- WebSocket hibernation and reconnect-safe seats
- a two-hour inactivity alarm

The server imports the same game engines as the UI and rejects out-of-turn,
stale, oversized, or illegal actions. Opponent-facing views remove unrevealed
Battleship ships, Memory symbols, and Quiz answers.

References:

- https://developers.cloudflare.com/durable-objects/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/workers/wrangler/

### Lesson 3 — production external origins must be HTTPS

`anna-app validate --strict` rejected this local development value:

```text
ui.bundle.external_origins must use an https:// prefix and contain no '*':
http://127.0.0.1:8787
```

Keep local preview selection in `runtime-config.js`, but declare only the final
production HTTPS origin in `manifest.json`. Before Anna publish, test the
deployed origin directly:

```powershell
$env:ARENA_TEST_ORIGIN = "https://anna-gaming-arena-live.anna-gaming-arena.workers.dev"
npm run test:server
Remove-Item Env:ARENA_TEST_ORIGIN

$env:ARENA_E2E_ORIGIN = "https://anna-gaming-arena-live.anna-gaming-arena.workers.dev"
npx playwright test --grep "invite room"
Remove-Item Env:ARENA_E2E_ORIGIN
```

The production test must cover both HTTPS and WSS; a successful Worker upload
alone is insufficient.

### Lesson 4 — the store category is a fixed enum

`games` looked natural but Anna rejected the first upload:

```text
category must be one of the supported categories:
productivity, developer-tools, creative, data, lifestyle, education,
communication, entertainment, utilities
```

Gaming Arena uses `entertainment` and keeps `games`, `multiplayer`, `chess`,
`puzzles`, and `quiz` as tags. Never guess a listing category; use the current
enum returned by the CLI or Developer Console.

### Lesson 5 — bundle visual assets locally and store attribution

Gaming Arena vendors one SVG for each of sixteen games plus its controller
logo. The source is https://game-icons.net/ and
https://github.com/game-icons/icons. Imported artwork was recolored, square
backgrounds were removed, and creator-by-creator attribution plus the upstream
license ship in `ATTRIBUTION.md` and `src/assets/GAME-ICONS-LICENSE.txt`.

Local assets avoid broken hotlinks, third-party request leakage, and new image
CSP origins. The build script recursively copies `src/assets/` into `bundle/`.
The app favicon, desktop/mobile brand, featured strip, catalog, rankings, and
game-mode dialogs all use those files.

### Lesson 6 — use `apps sync-meta` for logos and listing links

The current CLI reads these optional `app.json` fields:

```json
{
  "logo_file": "listing-assets/gaming-arena-logo.png",
  "screenshots": ["listing-assets/desktop.png", "listing-assets/mobile.png"],
  "cover_url": "https://...",
  "homepage_url": "https://...",
  "support_url": "https://...",
  "privacy_url": "https://..."
}
```

Preview and then upload without manually editing the Developer page:

```powershell
anna-app apps sync-meta --account https://anna.partners --dry-run --json
anna-app apps sync-meta --account https://anna.partners --json
```

The CLI uploads local logo/screenshots to the Anna CDN and patches listing
metadata. This also works when Chrome file upload is blocked because the ChatGPT
browser extension lacks “Allow access to file URLs.” Gaming Arena's final logo
URL was an Anna CDN `webp`, and the Developer card changed from a generic grid
icon to the controller mark.

### Lesson 7 — `apps publish` creates the immutable version, not a public release

Current direct flow:

```powershell
anna-app validate --strict
anna-app apps publish --account https://anna.partners --json
anna-app apps status anna-gaming-arena --account https://anna.partners --json
anna-app apps versions anna-gaming-arena --account https://anna.partners --json
```

Gaming Arena's first successful publish returned `first_publish: true`, version
`1.0.0`, version id `567`, and `bundle_ready` with 22 files. Developer Console
showed “No working draft yet” because the direct publish path created the
immutable version without leaving an `apps push` draft. That is expected.

The top-level Developer card displayed `v0.0.0` even while Version history and
Installed Apps authoritatively showed `1.0.0`. Use `apps versions`, the Version
details modal, and Installed Apps to verify the exact version; do not diagnose
from the stale card label alone.

### Lesson 8 — install, pin the candidate, and report public state truthfully

The Developer **Install** action successfully installed draft version `1.0.0`.
Installed Apps showed the exact version, logo, and tagline. Submission then used:

```powershell
anna-app apps submit-review anna-gaming-arena --account https://anna.partners --json
```

Final response:

```text
status: pending_review
review_candidate_version: 1.0.0
is_published: false
```

This means installed and under review, not visible in the public App Store.
Only release after Anna approves this exact version.

### Gaming Arena verification gate

```text
17 game-engine tests passed
3 Durable Object integration tests passed
5 Playwright workflows passed
strict Anna validation passed
production HTTPS/WSS room workflow passed
GitHub source pushed
Cloudflare Durable Object Worker deployed
Anna version 1.0.0 uploaded and installed
Anna review candidate 1.0.0 submitted
```

## Decision Room AI 1.0.0: live LLM budgets and deterministic continuity

Decision Room AI was built as a separate UI-only app at
`C:\Users\parth\Desktop\anna-decision-room-ai`. It uses `anna.llm.complete`,
Anna Storage, deterministic scoring/sensitivity logic, and no Executa.

### Lesson 1 — a successful LLM RPC can still contain no visible answer

The live Qwen provider completed an `llm.complete` call successfully, consumed
the entire `2200`-token output budget, and returned:

```json
{
  "content": { "type": "text", "text": "" },
  "stopReason": "endTurn",
  "usage": { "outputTokens": 2202 }
}
```

This was not a Host API transport failure. The reasoning model exhausted the
budget before emitting visible content. The same structured request succeeded
after the primary analysis budget was raised to `4200` tokens; Coach uses
`2600`, and JSON repair uses `3200`.

Production rules:

1. Treat empty `content.text` as failure even when RPC status is success.
2. For reasoning-capable hosted models, leave enough budget for hidden reasoning
   plus the visible structured result.
3. Do not retry indefinitely. One bounded repair request is enough.
4. Add a deterministic fallback derived only from saved user inputs.
5. Label fallback output as `Local fallback`; never present it as Anna output.
6. Keep a separate live-provider Playwright gate in addition to fixtures.

Decision Room's live gate starts the current harness with:

```powershell
anna-app dev --port 5197 --llm-account https://anna.partners
```

It creates a real room, runs structured Challenger analysis, verifies the result
is labeled `Anna`, asks the Coach, rejects raw JSON/local-fallback output, and
fails on page/console errors.

### Lesson 2 — deterministic fallbacks should preserve the workflow

When the hosted model is unavailable or empty, do not leave the user on a dead
loading/error screen. Decision Room derives a bounded fallback from the current
scores, evidence coverage, sensitivity, assumptions, and risks. It saves the
fallback in history with `source: "local"` and clearly identifies it in the UI.

Coach fallback responses use the current question to choose an assumption,
reversibility, bias, missing-option, or evidence-coverage lens. They retain the
user's message and append a transparent local response. They never invent
research, collaborators, or external facts.

### Lesson 3 — modal event boundaries must include portal roots

The action sheet was rendered in `#modal-root`, a sibling of `#app`, while the
delegated click listener was attached only to `#app`. The sheet looked correct,
but Duplicate, Export, and Delete never executed. Attach delegated actions at
`document` level or give every portal root its own handler. Test the actual
postcondition—new stored room, downloaded artifact, or deletion—not only that a
button is visible.

### Lesson 4 — Windows `doctor` can misreport POSIX mode after ACL repair

On Windows, `anna-app doctor` can keep reporting `dev.key mode 666 (expected
0600)` because Node exposes POSIX-like mode bits even after the file is correctly
restricted with NTFS ACLs. Verify the real ACL and the harness handshake:

```powershell
whoami
icacls C:\Users\parth\.anna-app\dev.key
```

The final ACL should name only the actual user with `(R,W)`. Remove accidental
machine/principal entries explicitly, then prove `anna-app dev` can create a
session. Do not weaken the ACL merely to make the POSIX-style doctor line green.

### Decision Room verification gate

```text
11 deterministic unit tests passed
5 Anna-harness Playwright workflows passed
1 real Anna LLM analysis + Coach workflow passed
axe accessibility scans passed
desktop and 390px visual captures reviewed
strict Anna validation passed with CLI 0.1.49 / schema 0.19.0
no Executa, external origin, provider key, or hardcoded generated content
```

## SkillQuest AI 1.0.0: split model creativity from deterministic contracts

SkillQuest AI was built as a separate UI-only app at
`C:\Users\parth\Desktop\anna-skillquest-ai`. It uses Anna LLM, Anna Storage,
no Executa, and no external API key.

### Large structured generation can fail in two different ways

The live `qwen3.7-plus` provider exposed both failure shapes:

1. A full 12-quest JSON request returned visible JSON truncated at the provider's
   observed `4098`-token cap. A repair request was truncated too.
2. Compact 12-quest requests with `2400` and `4098` effective output budgets
   consumed the entire budget but returned empty `content.text`.

Do not handle only JSON parse errors. The initial `llm.complete` call itself can
throw after an empty-content check, so the bounded retry must wrap request,
response extraction, parsing, shape validation, and normalization together.

### Reliable responsibility split

The production contract asks Anna only for a compact world outline:

```json
{
  "title": "...",
  "summary": "...",
  "world": {"name": "...", "tagline": "..."},
  "skills": [["ability", "description"]],
  "stages": [["stage name", "theme", "observable focus"]]
}
```

The deterministic engine expands the validated outline into exactly four stages
and twelve quests. It owns quest types, the two boss positions, durations, XP,
field-guide explanations, action steps, success criteria, reflections, and
sequential unlocking. Anna still provides meaningful creative/pedagogical
personalization; the model is no longer responsible for a combinatorial schema
that can exceed the hosted provider's output budget.

Production rules:

1. Validate exact stage and skill counts before materialization.
2. Let deterministic code enforce product invariants after model creativity.
3. Treat empty and truncated text as ordinary recoverable failures.
4. Retry once, then use a labelled local map derived only from learner inputs.
5. Keep evaluation and Mentor fallbacks separately labelled as `Local fallback`.
6. Reject valid-but-wrong structured output in chat; never show raw plan JSON to
   the learner.

### Exact-frame visual QA lessons

- The harness iframe can move outside the outer page viewport after nested
  interactions. A `page.screenshot({clip: boundingBox})` can silently produce a
  cropped listing asset even when the reported iframe width is correct.
- Use `locator("iframe#app").screenshot(...)`, reset both outer and iframe scroll,
  assert native dimensions, and inspect the resulting PNG.
- For a scrolled listing view, wait for or explicitly settle reveal classes in
  the asset-only test before capture.
- A fixed modal or detached navigation item can be visible inside the app but be
  reported outside the outer harness viewport by Playwright. For that known
  nested-harness limitation, dispatch the element's DOM click in the test after
  first asserting that the control exists and the dialog is visible.
- Mobile QA still requires a temporary manifest whose real Anna
  `default_size` is `390x780`; widening the outer test page only gives the
  harness enough room to capture the complete narrow iframe.

### SkillQuest verification gate

```text
13 deterministic logic/platform tests passed
5 Anna-harness desktop workflows passed
axe accessibility scans passed
1 real 390x780 Anna-manifest workflow passed without horizontal overflow
1 live Anna outline + mission evaluation + Mentor workflow passed in 1.9 minutes
listing PNGs reviewed at 1200x809, 1200x809, and 390x755
512x512 listing logo reviewed
strict validation passed with CLI 0.1.49 / schema 0.19.0
0 npm vulnerabilities
GitHub source: https://github.com/imthegoodboy/skillquest-ai
Anna app id 220; immutable version 1.0.0 (#569); bundle_ready
owner install confirmed at v1.0.0; review candidate submitted
remote lifecycle at handoff: pending_review, is_published=false
```

## LearnTube AI 1.0.8 Marketplace review recovery

Anna Marketplace tested LearnTube AI `1.0.7` on 2026-08-24. Five of six
scenarios passed, including source-grounded Mentor answers, but review was
blocked by permission saving, the bundled-tool listing, missing screenshots,
the direct YouTube path on a Cloud Agent, and inconsistent version surfaces.
Treat each as a separate release gate; a working UI does not prove the listing,
grant, frozen dependency, or selected Agent is correct.

### Blocker 1 — `Save failed: manifest does not declare agent.session.auto`

The installed grant had `llm_grant.agent.auto=true`, while immutable version
`1.0.7` normalized the manifest to:

```json
"agent": {
  "session": { "auto": false, "fixed": null },
  "tools": []
}
```

Top-level `permissions[]` is display/audit metadata and does not open the Agent
Host API. Explicitly declare the submode under `ui.host_api`:

```json
{
  "host_capabilities": ["llm.complete", "aps.kv"],
  "ui": {
    "host_api": {
      "agent": {
        "session": { "auto": true },
        "tools": []
      }
    }
  }
}
```

The production API rejected `agent-sessions` as an unknown top-level
`host_capabilities` value even though CLI `0.1.49` strict validation accepted
arbitrary strings there. Do not add that value. The Agent permission is
declared by the nested `ui.host_api.agent` block itself. An empty `agent.tools`
list keeps the unused Agent tool surface closed. Run
strict validation, publish a new immutable version, install that exact version,
then reopen Permissions and prove `Save all permissions` succeeds. Editing only
the saved grant cannot fix a manifest/grant mismatch.

### Blocker 2 — listing says `No bundled Executa` although the helper is learned

There are four links in the declaration chain, and all four must resolve:

```text
app.json bundled_executas.youtube-transcript.path
  -> manifest.required_executas bundled:youtube-transcript
  -> manifest.ui.host_api.tools required:bundled:youtube-transcript
  -> bundle/anna-tool-ids.js youtube-transcript -> minted production tool id
```

The source for `1.0.7` contained the chain, but Executa status still reported
`latest_version.in_published_app=false`; the store therefore had no frozen
bundled-tool association to show. The current guide's supported fix is to run
the full orchestration command from the App root:

```powershell
anna-app apps publish --account https://anna.partners --json
```

Do not use `--skip-executa-publish` or `--no-bundled-executas` for the review
candidate. After publishing, check all of these instead of trusting one screen:

- immutable manifest contains the real production Tool ID as required;
- app version has a frozen Executa snapshot;
- `executa status <tool-id>` reports the new helper version and
  `in_published_app=true`;
- Developer Console → Executas lists it under Required;
- the installed selected Agent shows the exact helper loaded and running;
- a real `youtube.transcript` invocation succeeds.

For this repair, App `1.0.8` raises `min_version` to helper `1.0.4`. The helper
must be rebuilt for Windows x86-64, Linux x86-64, Darwin arm64, and Darwin
x86-64 and published before the App is frozen.

### Blocker 3 — Marketplace screenshots are empty

Use real product states, not composed marketing mockups. Keep project-relative
PNG files in `app.json`:

```json
"screenshots": [
  "assets/screenshots/learntube-capture.png",
  "assets/screenshots/learntube-notes.png",
  "assets/screenshots/learntube-quiz.png"
]
```

Then run:

```powershell
anna-app apps sync-meta --account https://anna.partners --json
```

The CLI uploads local screenshots to Anna's CDN and patches the ordered listing
URLs. Reopen Listing and confirm all three URLs render. For harness screenshots,
capture only `iframe#app`; account for browser zoom/device-pixel ratio and
inspect every saved PNG before upload so RPC logs or clipped navigation never
enter the listing asset.

### Blocker 4 — direct YouTube URL fails on Anna Cloud Agent IPs

This is not fixed by a normal YouTube API key. Google's official
`captions.download` endpoint requires OAuth and permission to edit the video,
so it cannot download captions for an arbitrary public lesson. The original
helper used `youtube-transcript-api`, which talks to a public caption interface
without credentials; YouTube can block that interface from datacenter IPs.

The production recovery chain is:

```text
public YouTube URL
  -> bundled helper validates the 11-character video id
  -> try YouTube public captions directly
  -> on a non-terminal block/network failure, fetch the public transcript from
     https://youtube-transcript.ai/transcript/<VIDEO_ID>.txt
  -> validate the transcript marker, length, language, title, duration, and cap
     the response before returning source evidence
```

Do not fall through to the secondary route for a known `CAPTIONS_DISABLED`,
`NO_TRANSCRIPT`, or `VIDEO_UNAVAILABLE` result. Do not hardcode an API key. Keep
the caption-edge origin fixed in code, bound response bytes and timeouts, never
send lesson notes or account data, and disclose the video-ID request in the
privacy policy. Retain Paste transcript for genuinely unavailable/private
videos, but do not use it to mask a broken direct-link path during review.

Required tests:

- parser test for the edge Markdown envelope;
- forced `IpBlocked` test proving the secondary route returns `ok:true`;
- exact review URL smoke test:
  `https://youtu.be/vf-cxgUXcMk?si=inAYZAmIUL4eNYEb`;
- installed Local Agent invocation;
- installed Anna Cloud Linux Agent invocation;
- full UI generation from the retrieved transcript.

Useful primary/source references:

- [Google captions.download](https://developers.google.com/youtube/v3/docs/captions/download)
- [Google caption implementation guide](https://developers.google.com/youtube/v3/guides/implementation/captions)
- [Keyless caption edge documentation](https://youtube-transcript.ai/youtube-transcript-api)

### Blocker 5 — listing shows no version while Permissions shows `1.0.7`

Keep `app.json` and `package.json` on the same new SemVer (`1.0.8`) and add a
real changelog. The helper can have its own SemVer (`1.0.4`), but every helper
surface—`executa.json`, `pyproject.toml`, runtime `describe`, archive names,
release title, and binary URLs—must agree.

Do not use the Developer app-card label alone as the version oracle; the card
has been observed showing `v0.0.0` while immutable and installed versions were
correct. Verify Version history, CLI `apps versions`, candidate version,
Permissions, and Installed Apps together. Before resubmission, pin/install the
new candidate and confirm all user-facing surfaces show the intended version.

### LearnTube review-candidate gate

```text
app source version == package version == 1.0.8
helper source/describe/archive/catalogue version == 1.0.4
strict schema validation passes
UI/core and Python Executa tests pass
four native binary archives and SHA-256 files exist
full `apps publish` resolves and freezes the bundled helper
permission dialog saves without agent.session.auto error
three real Marketplace screenshots render
exact review YouTube URL works on Local and Cloud Linux Agents
notes, cards, quiz, roadmap, Mentor, storage, and PDF paths pass
selected Agent shows helper loaded/running
review candidate points at 1.0.8 before resubmission
```

## Troubleshooting

- `validate` rejects an unknown field: remove it and use the exact current schema; do not guess.
- `apps publish` rejects `unknown host_capabilities: ['agent-sessions']` after strict validation passed: remove that top-level string. Declare Agent access under `ui.host_api.agent.session` and treat the production server as authoritative; CLI `0.1.49` validates `host_capabilities` as arbitrary strings.
- `apps publish` rejects category `games`: use the current fixed taxonomy; for a game collection use `entertainment` and keep game concepts in tags.
- Strict validation rejects a local realtime origin: `ui.bundle.external_origins` accepts HTTPS production origins, not `http://127.0.0.1`; keep local preview routing out of the production allowlist.
- Cloudflare deploy warns that a workers.dev subdomain must be registered: inspect the account subdomain page, wait for DNS/TLS, and require a real `200` from the final HTTPS URL before wiring it into Anna. Do not assume upload output means the route is reachable.
- The Developer app card says `v0.0.0` after publishing `1.0.0`: verify Version history, `apps versions`, and Installed Apps. The card label can be stale while the immutable and installed versions are correct.
- Chrome cannot upload the listing logo (`fileChooser.setFiles` returns Not allowed): enable “Allow access to file URLs” for the ChatGPT browser extension, or preferably set `logo_file` and run `anna-app apps sync-meta` so the CLI uploads it to Anna CDN.
- Online multiplayer was implemented with Anna Storage: redesign it. Anna Storage is per user/app; cross-user room state needs an authorized shared backend with server-side move validation.
- Bundled handle is unresolved: ensure `app.json` contains the handle and the manifest uses `bundled:<same-handle>`.
- UI invokes a dev tool in production: use the generated `window.__ANNA_TOOL_IDS__` map.
- Runtime call is denied: align top-level `permissions`, `host_capabilities`, and `ui.host_api`, then let the user grant it.
- App works standalone but not in Anna: inspect the harness RPC log, iframe console, CSP, and SDK handshake.
- Storage disappears: ensure keys are namespaced, writes are awaited, and the harness storage mode is understood.
- Model returns malformed JSON: validate, make one JSON-only repair request, then fail visibly.
- LLM RPC succeeds but `content.text` is empty while output usage equals the token budget: the reasoning model likely exhausted the budget before visible output. Raise the bounded budget, keep one repair attempt, and use a clearly labeled deterministic fallback if visible content is still empty.
- Mock LLM returns the generation JSON in chat: inspect the RPC log. In CLI `0.1.49`, `contentIncludes` cannot reliably distinguish object-array `messages`; use scenario-specific fixtures rather than changing production prompts to fit the mock bug.
- Narrow-browser screenshot still shows desktop layout: read the harness-reported iframe size. Test with a temporary manifest whose view `default_size` is actually narrow; shrinking only the outer browser is insufficient.
- New route opens halfway down the page: reset `window.scrollTo({top: 0})` after route render, then move focus without scrolling.
- Mobile toast covers bottom navigation: offset the toast above the nav and reserve bottom body padding.
- Executa corrupts protocol: keep stdout JSON-only and move logs to stderr.
- Executa installs successfully but remains unloaded: run the released binary through `initialize` before `describe`. Implement `initialize`/`shutdown`, ignore no-ID notifications, return an Agent-compatible describe manifest, bump the immutable helper version, rebuild all platforms, publish it, then use the helper-specific Upgrade action on every Agent. Do not accept `is_installed: true` as success until `agent_loaded`, `agent_running`, `agent_version`, and `agent_tools_count` are correct.
- Executa works locally but not in cloud: build the correct native Linux artifact and test archive entrypoint/permissions.
- YouTube or another public service blocks cloud IPs: first determine whether the official API can legally/technically serve the use case. For arbitrary public YouTube captions, OAuth/API keys do not bypass the video-owner restriction. Use a bounded, disclosed server-side fallback, test it on Anna Cloud Linux, and retain manual input only for genuinely unavailable sources; do not present manual paste as the fix for a required direct-link workflow.
- `dev.key` permission warning: restrict the file to the current user with OS-native ACLs; never print or commit the key. On Windows, `doctor` may still print mode `666`; trust the explicit `icacls` principal list plus a successful harness session, not the emulated POSIX bit alone.
- App cannot publish: inspect status, version uniqueness, listing preflight, bundle readiness, Executa catalogue resolution, and account selection.
- `anna-app whoami --account ...` says unknown option: CLI `0.1.49` uses `anna-app whoami` or `anna-app whoami --json`; use `--account` on app/executa lifecycle commands that document it.
- Windows `Start-Process` says `%1 is not a valid Win32 application` for `anna-app`: `Get-Command anna-app` may resolve to `anna-app.ps1`. Launch `pwsh.exe -NoProfile -File <anna-app.ps1> ...` with `-WindowStyle Hidden`, or run it normally in a terminal. Track the listener PID separately from the wrapper PID.
- `apps status` says no app, then Windows prints a libuv `UV_HANDLE_CLOSING` assertion: treat the explicit “no app with slug” result as the availability signal, then confirm with the Developer Console before publishing. The trailing assertion is a CLI shutdown bug, not proof that the slug exists.
- `apps publish --dry-run` describes the correct new slug/version but exits nonzero with the same Windows assertion: inspect the meaningful dry-run output, re-run strict validation, and do not perform the real upload until the identity gate is complete.
- Developer listing fields appear blank immediately after first publish: wait for the record to load or use Refresh before editing; confirm the slug field before saving.
- Developer page says “No working draft yet” after `apps publish`: verify the immutable version under Version history. This is expected for the guide's direct publish path.
- Installed Apps contains two apps with the same name: open Permissions and verify the slug and version before testing, updating, or removing anything.
- Review submission succeeded but the wrong version is pinned: run `apps submit-review <slug>` again only with user authorization, then verify `review_candidate_version` using status JSON.
- New version uploaded but install still reports the prior version: compare `latest_version.version` and `review_candidate_version`. A pending-review app's generic install can follow the old candidate; pin the intended version, verify status, reinstall, and verify `installed_version`.
- `apps grants` reports `installed_executas: []` or an empty `executa_grants`: do not diagnose from that field alone for an unchanged developer-installed helper. Verify the exact Agent row, required-tool token scope, helper version, loaded/running state, and a real invocation.
- App is installed but absent from the App Store: inspect `status`, `is_published`, and the candidate. `pending_review` with `is_published: false` is not public; wait for approval and release the approved exact version.
- `executa '<tool-id>' is not deployed on the selected agent`: confirm the selected/default Agent is online, open Agent Details and locate the exact tool ID, verify the required native platform asset exists, verify `package_name` and `executable_name` both match the minted production tool ID, verify the installed app version, and inspect `apps grants`. Then distinguish installation from loading: a successful install with `agent_loaded: false` usually means the production handshake or describe manifest was rejected. If the app resolves a legacy bundled tool, correct or mint the app-specific Executa identity; if the Agent rejects the process, add the complete initialization contract. In either case, bump the immutable helper version, rebuild/upload every native artifact, raise `min_version` past broken intermediate versions, install the corrected app version, upgrade the exact helper on each Agent, and confirm a real invocation.
- A raw deployment error exposes a production tool ID to users: catch tool-invocation rejection and present a recovery message that suggests updating/reinstalling for the selected Agent or using the app's manual-input fallback.

## Controlling source

- [Build on Anna 101](https://forum.anna.partners/t/build-on-anna-101/228)
- [Chapter 7.6 — Upload App and Create Version](https://forum.anna.partners/t/build-on-anna-101/228#p-370-h-76-upload-app-and-create-version-37)
- [Chapter 7.7 — Install and Test the Uploaded Version](https://forum.anna.partners/t/build-on-anna-101/228#p-370-h-77-install-and-test-the-uploaded-version-38)
- [Chapter 8.1 — Submit for Review](https://forum.anna.partners/t/build-on-anna-101/228#p-370-h-81-submit-for-review-40)
- [Chapter 8.2 — Release After Review](https://forum.anna.partners/t/build-on-anna-101/228#p-370-h-82-release-version-after-passing-review-41)
- [Anna platform](https://anna.partners/)
- [Anna Developer Console](https://anna.partners/developer)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Workers Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- [Game-Icons project](https://game-icons.net/)
- [Game-Icons source and license](https://github.com/game-icons/icons)

Last verified against the 14-edit forum guide and Anna CLI `0.1.49` behavior observed through 2026-08-24. Reread the guide, check `anna-app --version`, and re-run strict validation on every future build.
