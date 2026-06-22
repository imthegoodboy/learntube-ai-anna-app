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
anna-app apps cut 0.1.3 --account $ANNA_HOST --json
anna-app apps status learntube-ai --account $ANNA_HOST --json
```

Release only after review/approval:

```powershell
anna-app apps release 0.1.3 --account $ANNA_HOST --json
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

## Production Executa Binaries

The source app keeps the bundled Executa in local mode for development. For broad production distribution, use the root GitHub workflow:

```powershell
gh workflow run anna-app-publish.yml -f app=anna-app-learntube-ai -f lifecycle=cut -f dry_run=false
```

That workflow builds macOS, Linux, and Windows binaries, rewrites:

```text
executas/learntube-processor/executa.json
  distribution.profiles.binary.binary_urls
```

and switches the published snapshot to binary mode before `apps push` / `apps cut`.

Use the local `anna-app apps push/cut` commands only for development or review when you intentionally want local Executa distribution.
