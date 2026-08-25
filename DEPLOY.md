# LearnTube AI release gate

Official end-to-end guide: https://forum.anna.partners/t/build-on-anna-101/228

Current candidate:

- App: `learntube-study` v1.0.11
- Bundled handle: `youtube-transcript`
- Executa: `tool-nikku696969-learntube-study-transcript-ujzngt7x` v1.0.4
- Review video: `https://www.youtube.com/watch?v=97BK06JjDmE`

## Local gate

```powershell
npm test
uv run --project executas/my-first-anna-app --with pytest pytest executas/my-first-anna-app/test_plugin.py -q
anna-app validate --strict
anna-app dev --mock-llm fixtures/happy-path.jsonl
```

Also call the Executa directly with the review video and confirm a non-empty transcript. The 2026-08-25 acceptance run returned 136 segments, 6,186 transcript characters, English captions, and the title `Build & Publish Your First Anna App: Step by Step | From Demo to App Store`.

## Production gate

Follow the current single-command publish flow:

```powershell
anna-app apps publish --account https://anna.partners --json
```

Then install v1.0.11 and confirm all of the following before review submission:

1. The permission dialog identifies `learntube-study · v1.0.11` and declares `llm.complete`, `agent.auto`, and `agent.fixed`.
2. `anna-app apps grants learntube-study --account https://anna.partners --json` reports `satisfied: true` and no missing scopes.
3. The immutable version manifest resolves `bundled:youtube-transcript` to the formal Executa tool ID.
4. The Cloud Agent reports the helper installed, loaded, running, and at v1.0.4.
5. The review YouTube URL reaches caption retrieval without an API key or OAuth prompt, then generates the saved study workspace.
6. The Marketplace listing contains the three product screenshots from `assets/screenshots/`.

Submit for review only after these checks. Do not publicly release until Anna approves the candidate.
