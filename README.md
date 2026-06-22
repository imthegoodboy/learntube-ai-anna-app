# LearnTube AI

Demo video : https://youtu.be/ciF_u-fdelg

LearnTube AI is an Anna App that turns YouTube learning sessions into a saved study workspace.

Paste a video link or transcript and the app generates:

- Smart notes with summary, examples, and watch-outs
- Flashcards with Easy/Hard memory tracking
- Quiz mode with weak-concept detection
- Action items and a topic roadmap
- History, XP, streaks, and revision timing
- Grounded mentor Q&A using only the current lesson evidence
- One-page PDF cheat-sheet export

## Architecture

```text
bundle/index.html
  -> bundle/app.js connects to Anna runtime
  -> anna.tools.invoke(required:bundled:learntube-processor)
  -> anna.llm.complete enhances artifacts when granted
  -> anna.storage persists compact history/progress
  -> browser PDF export keeps data local to the app
```

The bundled `learntube-processor` Executa is deterministic and requires no provider key. It:

1. Parses YouTube video IDs.
2. Attempts public title and caption extraction.
3. Prefers pasted transcript text when supplied.
4. Generates a complete workspace from transcript evidence when captions are unavailable.

The direct Anna LLM path is optional. If it is not granted or fails, the app remains usable.

## Local Development

```powershell
cd examples\anna-app-learntube-ai
npm install
npm test
npm run fixture:verify
npm run validate
npm run dev:no-llm
```

Open:

```text
http://127.0.0.1:5186/
```

Run browser checks:

```powershell
npm run test:e2e
```

## Anna Runtime Requirements

The app declares:

- `tools.invoke` for the bundled processor
- `storage.get/set/list/delete` for progress and history
- `llm.complete` for optional artifact refinement and mentor answers
- `chat.write_message` for user-visible study events
- `window.set_title` for the Anna window title

## Privacy

LearnTube AI stores compact study history and progress in Anna storage. Runtime tokens are not requested or stored. YouTube links and transcript text are sent only to the bundled Executa and, when LLM access is granted, a compact lesson context is sent to Anna-hosted LLM completion.

## Production Notes

For review-ready distribution, run the root `anna-app-publish.yml` workflow for `anna-app-learntube-ai`. It builds macOS, Linux, and Windows Executa archives, pins `distribution.profiles.binary.binary_urls`, and cuts the app with binary distribution. Local distribution remains appropriate for development and harness testing.
