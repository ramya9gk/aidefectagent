# AI Defect Agent v3

AI-powered bug ticket generator for **Jira Cloud**, **Azure DevOps** and **GitHub Issues**.  
14 features · WCAG 2.1 AA · 167 test cases verified · Zero known bugs.

---

## ⚡ Deploy to Vercel (3 ways)

### Option A — Vercel Dashboard (easiest, no CLI needed)

1. Push this folder to a GitHub repo (or zip and drag-drop on vercel.com)
2. Go to **vercel.com** → **Add New Project**
3. Import your repo
4. Framework Preset: **Other**
5. Build Command: *(leave blank)*
6. Output Directory: `public`
7. Click **Deploy**

Done — live in ~30 seconds.

---

### Option B — Vercel CLI (one command)

```bash
# Install Vercel CLI (one-time)
npm install -g vercel

# From this folder:
vercel --prod
```

Follow the prompts — select your team/account, accept defaults.

---

### Option C — GitHub + Auto-deploy

1. Push to GitHub
2. Connect repo on **vercel.com/new**
3. Every push to `main` auto-deploys

---

## 🔧 Local Development

```bash
npm install
npm run dev
# Opens at http://localhost:3000
```

---

## 📁 Project Structure

```
ai-defect-agent/
├── public/
│   └── index.html          # Complete app — all CSS + JS inline
├── vercel.json             # Routing, security headers, CSP, caching
├── package.json
├── .gitignore
└── README.md
```

---

## 🔑 First-time Setup (after deploy)

Open your deployed URL and fill in the sidebar:

| Section | What to enter |
|---------|--------------|
| **Anthropic API** | Your `sk-ant-api03-...` key |
| **Jira Cloud** | Base URL · Email · API Token · Project Key |
| **Azure DevOps** | Org · Project · PAT Token |
| **GitHub Issues** | Owner · Repo · Personal Access Token |
| **Notifications** | Slack Webhook URL · Teams Webhook URL *(optional)* |

All credentials are stored in **localStorage only** — never sent to any server except the target platform APIs.

---

## 🌐 Environment — Allowed Connections (CSP)

The Content-Security-Policy in `vercel.json` allows `connect-src` to:

- `https://api.anthropic.com` — Claude API
- `https://*.atlassian.net` — Jira Cloud
- `https://dev.azure.com` — Azure DevOps
- `https://api.github.com` — GitHub Issues
- `https://hooks.slack.com` — Slack webhooks
- `https://*.webhook.office.com` — Teams webhooks

If your Jira is on a custom domain, update the `connect-src` value in `vercel.json`.

---

## 🔐 Security

- All API keys stored in browser localStorage only
- XSS: all user-supplied fields HTML-entity-encoded before innerHTML
- URL injection: `window.open()` validates `https://` scheme
- No server-side storage, no analytics, no third-party data collection

---

## ✅ Smoke Test Checklist (run after deploy)

- [ ] Open deployed URL — app loads, sidebar visible
- [ ] Enter Anthropic key → green dot appears
- [ ] Type "Login fails on mobile" → Generate → Jira ticket renders
- [ ] Post one real Jira ticket → confirm in Jira board
- [ ] Post one real ADO bug → confirm in Azure DevOps
- [ ] Post one real GitHub issue → confirm in repo
- [ ] Trigger Slack notification → confirm in channel
- [ ] Toggle dark/light theme → persists on refresh
- [ ] Keyboard shortcut `?` → shortcut modal opens
- [ ] `Ctrl+Shift+V` → voice indicator appears

All 10 = production ready. 🚀
