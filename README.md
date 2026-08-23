# LearnTube AI for Anna

LearnTube AI turns a captioned YouTube video or pasted transcript into a saved study workspace: source-grounded notes, spaced-repetition flashcards, a weak-concept quiz, action items, a topic roadmap, mentor Q&A, progress tracking, and a one-page PDF cheat sheet.

## Architecture

- `bundle/` — dependency-free static SPA using the Anna App Runtime SDK.
- Anna Host API — model generation and per-user APS storage; no model API key is placed in the app.
- `executas/my-first-anna-app/` — narrow Python Executa for public YouTube caption retrieval.
- `fixtures/` and `tests/` — deterministic LLM fixture and pure-logic tests.

## Local verification

```powershell
npm test
uv run --project executas/my-first-anna-app --with pytest pytest executas/my-first-anna-app/test_plugin.py
anna-app validate --strict
anna-app dev --mock-llm fixtures/happy-path.jsonl
```

For real Anna model access, confirm `anna-app whoami` points to `https://anna.partners`, then run:

```powershell
anna-app dev --llm-account https://anna.partners
```

## Publish

The checked-in Executa profile defaults to `local` for development. Build the four artifacts with `.github/workflows/build-executa.yml`, place them under `executas/my-first-anna-app/dist/`, and publish with the binary profile:

```powershell
anna-app apps publish --profile binary
```

Install the uploaded version in Anna, verify both a Local Agent and Anna Cloud Agent, then submit the app for review from the Developer Console or with `anna-app apps submit-review learntube-ai`.
