---
name: anna-app-builder
description: Build, test, package, publish, and maintain production Anna Apps with schema-2 UI bundles, Host APIs, bundled Executas, storage, LLM features, and marketplace release checks.
---

# Anna App Builder

Use this skill when an agent must create or change an Anna App end to end. It is a practical companion to the official documentation, not a replacement for checking the current schema and CLI. Anna is evolving quickly; begin every project by checking the linked sources and the installed CLI version.

## 1. Start with current sources

1. Open [Anna](https://anna.partners/) and [Build on Anna 101](https://forum.anna.partners/t/build-on-anna-101/228/1) in a browser.
2. Read [Anna's LLM-readable documentation index](https://anna.partners/llms.txt). Use it to find the newest page for each feature.
3. Check the current CLI and environment:

   ```bash
   anna-app --version
   anna-app doctor
   anna-app whoami
   ```

4. Read the project's requirements file and inspect the entire template before changing code.
5. Run `anna-app validate --strict` before trusting an old example. The current schema, not a copied snippet, is authoritative.

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
      "tools": ["required:*"],
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
- The slug is globally unique and immutable after app creation.

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

An Executa is a line-oriented JSON stdio process. Keep stdout protocol-only and send diagnostics to stderr. It must support the current describe/health/invoke contract and return stable error envelopes rather than crashing.

Each Executa needs an `executa.json` describing identity, version, type, and distribution. Keep local and binary profiles separate:

```json
{
  "slug": "data-helper",
  "name": "Data Helper",
  "version": "1.0.0",
  "executa_type": "tool",
  "tool_id": "tool-dev-data-helper",
  "type": "python",
  "distribution": {
    "active": "local",
    "profiles": {
      "local": { "type": "local", "supports_protocol": true },
      "binary": {
        "type": "binary",
        "executable_name": "data-helper",
        "supports_protocol": true,
        "binary_artifacts": {
          "darwin-arm64": { "path": "dist/data-helper-1.0.0-darwin-arm64.tar.gz", "entrypoint": "data-helper", "format": "tar.gz" },
          "darwin-x86_64": { "path": "dist/data-helper-1.0.0-darwin-x86_64.tar.gz", "entrypoint": "data-helper", "format": "tar.gz" },
          "linux-x86_64": { "path": "dist/data-helper-1.0.0-linux-x86_64.tar.gz", "entrypoint": "data-helper", "format": "tar.gz" },
          "windows-x86_64": { "path": "dist/data-helper-1.0.0-windows-x86_64.zip", "entrypoint": "data-helper.exe", "format": "zip" }
        }
      }
    }
  }
}
```

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

Mock caveat observed with CLI `0.1.49`: `llm.complete` matching may stringify a message array as `[object Object]`, causing `contentIncludes` rules to fall through to the first matching namespace/method fixture. Put the primary generation response first or run distinct fixtures for distinct scenarios. Re-check this behavior after CLI upgrades.

For real account-backed development, first understand quota and data impact, then use the documented account flag. Do not use real billing merely to avoid writing fixtures.

## 8. Browser QA checklist

Test inside the Anna harness, not only as a standalone page.

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

## 10. Preflight and publish

The current recommended lifecycle separates a mutable working draft from an immutable version:

```bash
anna-app validate --strict
anna-app apps push --dry-run --profile binary --account https://anna.partners
anna-app apps push --profile binary --account https://anna.partners
anna-app apps cut 1.0.0 --changelog "Initial production release" --account https://anna.partners
```

`apps publish` remains available as a combined compatibility flow. Prefer `push` plus `cut` when the installed CLI and current docs support it. Use `--profile local` only for local developer shims; use `--profile binary` for a distributable app.

Before push/cut:

- all local tests pass;
- strict validation passes;
- every referenced binary archive exists;
- generated tool-handle mapping is correct;
- version strings agree across `app.json`, the app manifest/version, Executa metadata, packages, and artifact names;
- no secrets or development URLs are present;
- listing copy accurately describes observed behavior.

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

Then install the developer version and use it end to end in Anna. Confirm both local-agent and cloud/Linux behavior for bundled binaries. The review preflight requires a valid version, a finalized `bundle_ready` schema-2 UI, truthful listing assets, and self-testing.

Submit only when ready:

```bash
anna-app apps submit-review <slug> --account https://anna.partners
```

Admin review is server-side and has no guaranteed SLA. Status moves through `DRAFT`, `PENDING_REVIEW`, `APPROVED`, and `PUBLISHED` (or `REJECTED`); `ARCHIVED` hides the listing while existing installations keep working. After approval, publish the version through the Console or:

```bash
anna-app apps release 1.0.0 --slug <slug> --account https://anna.partners
```

Never claim the marketplace release is live while it is awaiting admin approval. Report the exact remote status and version.

Read [Listing Fields](https://anna.partners/developers/apps/app-listing) and [Publishing an App](https://anna.partners/developers/apps/app-publish) immediately before submission because this lifecycle can change.

## 12. Release verification and maintenance

After release:

1. Install the published version from Anna.
2. Verify the resolved Executa ID, UI bundle, model calls, storage, and every critical user journey.
3. Test a tool failure and confirm it becomes a helpful UI message.
4. Confirm old saved data migrates or still loads.
5. Check the App Store listing, screenshots, privacy/support links, and exact version.
6. Record the changelog and Git tag.
7. For updates, bump semver, rebuild all affected artifacts, push the working draft, cut a new immutable version, retest, and release after required review.

## Troubleshooting

- `validate` rejects an unknown field: remove it and use the exact current schema; do not guess.
- Bundled handle is unresolved: ensure `app.json` contains the handle and the manifest uses `bundled:<same-handle>`.
- UI invokes a dev tool in production: use the generated `window.__ANNA_TOOL_IDS__` map.
- Runtime call is denied: align top-level `permissions`, `host_capabilities`, and `ui.host_api`, then let the user grant it.
- App works standalone but not in Anna: inspect the harness RPC log, iframe console, CSP, and SDK handshake.
- Storage disappears: ensure keys are namespaced, writes are awaited, and the harness storage mode is understood.
- Model returns malformed JSON: validate, make one JSON-only repair request, then fail visibly.
- Executa corrupts protocol: keep stdout JSON-only and move logs to stderr.
- Executa works locally but not in cloud: build the correct native Linux artifact and test archive entrypoint/permissions.
- YouTube or another public service blocks cloud IPs: present an alternate user-provided input path; do not hide the service limitation.
- `dev.key` permission warning: restrict the file to the current user with OS-native ACLs; never print or commit the key.
- App cannot publish: inspect status, version uniqueness, listing preflight, bundle readiness, Executa catalogue resolution, and account selection.

## Primary sources

- [Anna](https://anna.partners/)
- [Build on Anna 101](https://forum.anna.partners/t/build-on-anna-101/228/1)
- [Documentation index](https://anna.partners/llms.txt)
- [App Manifest](https://anna.partners/developers/apps/app-manifest)
- [Bundling Executas](https://anna.partners/developers/apps/app-bundling)
- [UI Manifest](https://anna.partners/developers/apps/app-ui-manifest)
- [UI SDK](https://anna.partners/developers/apps/app-ui-sdk)
- [UI Host API](https://anna.partners/developers/apps/app-ui-host-api)
- [Host API vs Executa](https://anna.partners/developers/apps/host-api-vs-executa)
- [Local Development](https://anna.partners/developers/apps/local-dev)
- [Local LLM Development](https://anna.partners/developers/apps/local-dev-llm)
- [Testing the Bundle](https://anna.partners/developers/apps/testing-bundle)
- [Listing Fields](https://anna.partners/developers/apps/app-listing)
- [Publishing an App](https://anna.partners/developers/apps/app-publish)
- [Official Anna Executa examples](https://github.com/whtcjdtc2007/anna-executa-examples)

Last verified against Anna CLI `0.1.49` and official docs available on 2026-08-23. Re-run discovery and strict validation on every future build.
