# Bug Forge AI

AI-powered bug ticket generator for **Jira Cloud**, **Azure DevOps** and **GitHub Issues**. Drag a screenshot, type a one-liner, and Bug Forge AI produces a structured ticket with severity score, steps to reproduce, expected/actual results, acceptance criteria — and auto-routes it to the right platform.

Version `2026.04.18` · Compatible with Microsoft Teams (sideload the separate Teams package).

---

## Features

- **AI severity scoring** — 0–100 score with reasoning, color-coded
- **Smart routing** — keywords route to Jira, ADO, or GitHub automatically (or override manually)
- **Screenshot attach** — drag, paste (Ctrl+V), or click to upload
- **Voice input** — speak your bug, transcribed inline
- **Bulk mode** — paste 20 defects at once, create them all
- **Root cause analysis** — AI suggests likely causes
- **Test case generation** — positive / negative / edge cases from the bug
- **Quality scorer** — rates how well-structured the ticket is
- **Duplicate detection** — checks existing tickets before creating
- **Comment on existing** — add repro steps to an open ticket
- **Templates** — 8 built-in (Login/Auth, Payment, Mobile, API, Dashboard, Database, Performance, Integration)
- **Slack + Teams notifications** — webhook on every created ticket
- **Session dashboard** — charts for severity, platform, timeline
- **Dark/Light theme** · **Keyboard shortcuts** · **WCAG 2.1 AA**

---

## Deploy to Vercel

### Option A — Vercel Dashboard (easiest)

1. Push this folder to a GitHub repo
2. Go to **vercel.com** → **Add New Project** → import the repo
3. Framework Preset: **Other**
4. Build Command: *leave blank*
5. Output Directory: *leave blank* (the `vercel.json` handles routing)
6. Click **Deploy**
7. After deploy: **Settings → Environment Variables** and add the vars from the table below
8. Redeploy once so env vars take effect

### Option B — Vercel CLI

```bash
npm install -g vercel
cd bugforgeai
vercel --prod
```

Then add env vars in the dashboard and run `vercel --prod` again.

### Required environment variables

Set these in **Vercel → Settings → Environment Variables**:

| Variable | Required | Example |
|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** — required for all AI features | `sk-ant-api03-...` |
| `JIRA_URL` | for Jira | `https://yourco.atlassian.net` |
| `JIRA_EMAIL` | for Jira | `you@company.com` |
| `JIRA_TOKEN` | for Jira | API token from id.atlassian.com |
| `ADO_PAT` | for Azure DevOps | Personal Access Token |
| `GITHUB_OWNER` | for GitHub | `your-org-or-username` |
| `GITHUB_REPO` | for GitHub | `your-repo-name` |
| `GITHUB_TOKEN` | for GitHub | PAT with `repo` scope |
| `SLACK_WEBHOOK_URL` | optional | `https://hooks.slack.com/services/...` |
| `TEAMS_WEBHOOK_URL` | optional | `https://...webhook.office.com/...` |

You only need vars for the platforms you use. Skipped platforms are gracefully disabled.

---

## Local development

```bash
npm install
npm run dev
# Opens at http://localhost:3000
```

Note: `/api/*` serverless functions only run in the Vercel environment. For local dev with the backend, use `vercel dev` instead.

---

## Project structure

```
bugforgeai/
├── index.html            # The app — UI + all client JS inline
├── admin.html            # /admin route — session log dashboard
├── setup.html            # /setup route — onboarding flow
├── manifest.json         # PWA manifest (icons, theme color)
├── vercel.json           # Routing, security headers, CSP, Teams iframe support
├── package.json
├── .gitignore
├── README.md
├── CHANGES.md
└── api/                  # 10 serverless endpoints
    ├── claude.js         # Anthropic API proxy (server-side key)
    ├── jira.js           # Jira Cloud POST
    ├── ado.js            # Azure DevOps POST
    ├── github.js         # GitHub Issues POST
    ├── config.js         # Env-var config loader (served to client)
    ├── projects.js       # Auto-load Jira / ADO project lists
    ├── proxy.js          # CORS proxy for platform APIs
    ├── attach.js         # File attachment upload
    ├── notify.js         # Slack / Teams webhook dispatcher
    └── testcase.js       # AI test case generator
```

---

## Security

- All credentials live in Vercel environment variables — never in client-side code or localStorage
- The CSP in `vercel.json` restricts `connect-src` to only the APIs the app talks to (Anthropic, Atlassian, Azure DevOps, GitHub, Slack, Teams webhooks)
- User-supplied fields are HTML-entity-encoded before DOM injection (XSS protection)
- `window.open()` validates `https://` scheme before opening external links
- `frame-ancestors` allows Microsoft Teams domains so the app can be embedded as a Teams tab (remove those entries if you don't want Teams support)
- No analytics, no third-party data collection, no server-side storage of bug content

---

## Microsoft Teams integration

A separate Teams app package (`bugforgeai-teams.zip`) lets your team use Bug Forge AI as a tab inside Microsoft Teams — personal, channel, group chat, or meeting tab. See the README inside that package for the 3-step setup. The Teams app iframes this Vercel deployment; the `vercel.json` in this folder already includes the required `frame-ancestors` entries and Teams CDN allowances.

---

## Post-deploy smoke test

1. Open the deployed URL → topbar reads **Bug Forge AI**
2. Click the **Settings** gear → Anthropic section shows a green dot
3. Platform tabs load project dropdowns for Jira / ADO
4. Type "Login fails on mobile" → **Generate ticket** → ticket renders on the right
5. Click **Post** on the ticket → confirm it appears in your real Jira / ADO / GitHub
6. Toggle dark/light theme → persists on refresh
7. Press `?` → keyboard shortcuts modal opens
8. Press `Ctrl+Shift+V` → voice indicator appears (allow mic)
9. Press `Ctrl+,` → Settings drawer opens

All 9 ✓ = production ready.

---

## Troubleshooting

**Blank page / CSP errors in console**
Your `vercel.json` didn't deploy. Verify with `curl -I https://your-url.vercel.app` — look for the `content-security-policy` response header.

**Jira / ADO / GitHub post buttons are disabled**
Env vars missing. Check Vercel → Settings → Environment Variables, then redeploy.

**"Test connection" fails for Jira**
`JIRA_TOKEN` should be an API token (not a password). `JIRA_URL` should have no trailing slash.

**Topbar still says "Bug Sync" or "BugForge AI" (no spaces)**
Hard refresh — `Ctrl+Shift+R` on Windows/Linux, `Cmd+Shift+R` on Mac. If still wrong, confirm the latest `index.html` was actually pushed to git and Vercel deployed the latest commit (check **Deployments** in the Vercel dashboard).

**"Bulk" button doesn't appear / doesn't work**
Bulk mode is triggered by the topbar ⚡ button or `Ctrl+B`. If neither works, the JS failed to load — check browser devtools Console for errors.
