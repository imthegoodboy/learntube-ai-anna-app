# LearnTube AI Deploy Notes

Use production Anna unless intentionally testing staging.

```powershell
$ANNA_HOST = "https://anna.partners"
cd examples\anna-app-learntube-ai

npm install
npm test
npm run fixture:verify
npm run validate
npm run test:e2e

anna-app apps push --account $ANNA_HOST --json
anna-app apps cut 0.1.0 --account $ANNA_HOST --json
anna-app apps status learntube-ai --account $ANNA_HOST --json
```

Release only after review/approval:

```powershell
anna-app apps release 0.1.0 --account $ANNA_HOST --json
```

## GitHub Publishing

After local checks pass:

```powershell
gh repo create learntube-ai-anna-app --public --source . --remote origin --push
```

If this repository is already inside the shared Anna examples repo, push a branch instead:

```powershell
git checkout -b codex/learntube-ai
git add examples\anna-app-learntube-ai .github\workflows\learntube-ai.yml project.md anna.md
git commit -m "add learntube ai anna app"
git push -u origin codex/learntube-ai
```

## Binary Executa Gap

The current app uses local Executa distribution for development. Before a broad public release, create platform binaries and update:

```text
executas/learntube-processor/executa.json
  distribution.profiles.binary.binary_urls
```

Without binary URLs, users need a compatible Python/uv local environment to run the bundled processor.
