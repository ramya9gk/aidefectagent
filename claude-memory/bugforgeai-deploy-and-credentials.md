---
name: bugforgeai-deploy-and-credentials
description: How BugForge AI is deployed and its credential model (non-obvious; not in repo)
metadata: 
  node_type: memory
  type: project
  originSessionId: ed5ac978-7365-44ef-8ba9-70b81107f331
---

BugForge AI (repo `C:\Users\RamyaBIN\aidefectagent`, GitHub `ramya9gk/aidefectagent`).

**Deployment** — the live site **https://bugforgeai.vercel.app is NOT git-connected.** Deploy via the Vercel CLI from local: `vercel --prod --yes`. Vercel account `ramya9bgk-3840`, project name `bugforgeai` (the `.vercel/` link is gitignored). Pushing to GitHub does NOT auto-deploy. The repo is otherwise maintained by web-upload ("Add files via upload"). The old alias `aidefectagent.vercel.app` is dead (DEPLOYMENT_NOT_FOUND).

**Vercel Hobby plan caps serverless functions at 12** — `api/` must stay ≤12 `.js` files (dead `claude.js`/`status.js` were removed to fit; currently 11).

**Credential model** (decided 2026-05-31): all credentials — AI provider keys (Claude/Gemini/Groq), Jira, ADO, GitHub, Slack/Teams — are **entered in the UI and stored in the browser (localStorage, `da_*` keys, tokens base64-encoded)**. The app is **config-only**: API handlers never read `process.env` for credentials. Do NOT reintroduce Vercel env-var credential reading.

**Gemini specifics:** chat models are the `gemini-3.x-preview` chain (v1beta); embeddings use **`gemini-embedding-001`** (v1beta) — `text-embedding-004` 404s on current accounts.

**Git auth:** repo owner is `ramya9gk`; push requires being logged in as `ramya9gk` (`gh auth login`), not `ramya9b`.
