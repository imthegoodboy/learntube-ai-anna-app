# LearnTube AI for Anna

LearnTube AI turns a captioned YouTube video or pasted transcript into a saved study workspace: source-grounded notes, spaced-repetition flashcards, a weak-concept quiz, action items, a topic roadmap, mentor Q&A, progress tracking, and a one-page PDF cheat sheet.

## Architecture

- `bundle/` — dependency-free static SPA using the Anna App Runtime SDK.
- Anna Host API — model generation and per-user APS storage; no model API key is placed in the app.
- `executas/my-first-anna-app/` — narrow Python Executa for public YouTube caption retrieval, with a keyless caption-edge fallback when YouTube blocks an Anna Cloud Agent IP.
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

Build the four native artifacts with `.github/workflows/build-executa.yml`. The checked-in Executa distribution uses the resulting public GitHub Release, so publish the complete app with the current Anna 101 command:

```powershell
anna-app apps publish --account https://anna.partners
```

The next local candidate is App `1.0.13` with bundled transcript helper `1.0.5`. Build the four native helper artifacts with the workflow before pushing this candidate. Install it in Anna, verify both a Local Agent and Anna Cloud Agent, confirm the permission dialog saves successfully, then submit `learntube-study` for review from the Developer Console.
