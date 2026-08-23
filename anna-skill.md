---
name: anna-app-builder
description: Build, test, package, publish, and maintain production Anna Apps with schema-2 UI bundles, Host APIs, bundled Executas, storage, LLM features, and marketplace release checks.
---

# Anna App Builder

Use this skill when an agent must create or change an Anna App end to end. The controlling workflow for this skill is the current [Build on Anna 101](https://forum.anna.partners/t/build-on-anna-101/228) guide. Anna is evolving quickly; reread that post before every build and prefer its Chapters 6–8 when another source describes an older publishing lifecycle. Treat the display name as presentation only: the app slug and server `app_id` determine which Anna app is changed.

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

For an app with required bundled tools, `executa_grants` must contain the expected Executa and the overall grant should be satisfied. An empty `executa_grants` list is not healthy just because the app-level permissions are satisfied.

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
4. With user authorization, install that version.
5. In Installed Apps → Permissions, verify `<slug> · <version>` and all declared grants.
6. Run the critical workflow on a Local Agent and on Anna Cloud Agent/Linux when supported.
7. With user authorization, submit and verify the pinned candidate:

   ```bash
   anna-app apps submit-review <slug> --account https://anna.partners
   anna-app apps status <slug> --account https://anna.partners --json
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
- `apps status` says no app, then Windows prints a libuv `UV_HANDLE_CLOSING` assertion: treat the explicit “no app with slug” result as the availability signal, then confirm with the Developer Console before publishing. The trailing assertion is a CLI shutdown bug, not proof that the slug exists.
- `apps publish --dry-run` describes the correct new slug/version but exits nonzero with the same Windows assertion: inspect the meaningful dry-run output, re-run strict validation, and do not perform the real upload until the identity gate is complete.
- Developer listing fields appear blank immediately after first publish: wait for the record to load or use Refresh before editing; confirm the slug field before saving.
- Developer page says “No working draft yet” after `apps publish`: verify the immutable version under Version history. This is expected for the guide's direct publish path.
- Installed Apps contains two apps with the same name: open Permissions and verify the slug and version before testing, updating, or removing anything.
- Review submission succeeded but the wrong version is pinned: run `apps submit-review <slug>` again only with user authorization, then verify `review_candidate_version` using status JSON.
- `executa '<tool-id>' is not deployed on the selected agent`: confirm the selected/default Agent is online, open Agent Details and locate the exact tool ID, verify the required native platform asset exists, verify `package_name` and `executable_name` both match the minted production tool ID, verify the installed app version, and inspect `apps grants`. If the new app has no Executa grant or resolves a legacy bundled tool, correct or mint the app-specific Executa identity, bump its immutable version, rebuild/upload every native artifact, raise `min_version` past broken intermediate versions, install the corrected app version, and re-check the Agent deployment.
- A raw deployment error exposes a production tool ID to users: catch tool-invocation rejection and present a recovery message that suggests updating/reinstalling for the selected Agent or using the app's manual-input fallback.

## Controlling source

- [Build on Anna 101](https://forum.anna.partners/t/build-on-anna-101/228)
- [Chapter 7.6 — Upload App and Create Version](https://forum.anna.partners/t/build-on-anna-101/228#p-370-h-76-upload-app-and-create-version-37)
- [Chapter 7.7 — Install and Test the Uploaded Version](https://forum.anna.partners/t/build-on-anna-101/228#p-370-h-77-install-and-test-the-uploaded-version-38)
- [Chapter 8.1 — Submit for Review](https://forum.anna.partners/t/build-on-anna-101/228#p-370-h-81-submit-for-review-40)
- [Chapter 8.2 — Release After Review](https://forum.anna.partners/t/build-on-anna-101/228#p-370-h-82-release-version-after-passing-review-41)
- [Anna platform](https://anna.partners/)
- [Anna Developer Console](https://anna.partners/developer)

Last verified against the 14-edit forum guide and Anna CLI `0.1.49` behavior observed on 2026-08-23. Reread the guide, check `anna-app --version`, and re-run strict validation on every future build.
