# Changes

## 2026.04.18

### UI redesign — "Bug Forge AI" layout
- **New two-card workspace** replacing the left-sidebar-plus-chat layout
  - Left: **New Bug** card (screenshot dropzone, describe textarea, example chips, Platform + Project dropdowns, Voice + Comment, Generate button)
  - Right: **Generated Ticket** card (empty state on first load, tickets render here)
- **Right-side Settings drawer** — opens via the gear button in the top bar or `Ctrl+,`. Contains Anthropic API, Platforms (Jira/ADO/GitHub tabs), Notifications, Quick Templates, Routing Rules, Session History.
- **Topbar** — brand, version, agent-status pill, theme toggle, dashboard, bulk, keyboard shortcuts, clear, settings
- Rebranded to **Bug Forge AI** throughout (topbar, title, manifest, welcome message, system prompt, session report heading)
- New design tokens — Inter body font, Syne display, indigo `#6366f1` accent, darker `#0a0d14` background, softer card borders

### New UX affordances
- Screenshot preview inline in dropzone (thumbnail + filename + remove button)
- Active-state highlighting on example chips
- Project dropdown in form mirrors the Jira/ADO project dropdowns in Settings (keeps both in sync)
- `Ctrl+,` opens Settings, `Esc` closes drawer or modals
- Responsive: cards stack at ≤ 960 px, form rows stack at ≤ 680 px

### Microsoft Teams compatibility
- Updated `vercel.json` CSP to allow Teams to iframe the app
  - `frame-ancestors` now includes `teams.microsoft.com`, `*.teams.microsoft.com`, `*.skype.com`, `*.office.com`, `*.officeapps.live.com`, `*.microsoftonline.com`
  - `Permissions-Policy` allows microphone in Teams iframe context (for Voice feature)
  - Removed `X-Frame-Options: SAMEORIGIN` (conflicted with frame-ancestors)
  - Added Teams CDN domains to `script-src`
- Separate Teams app package (`bugforgeai-teams.zip`) produced with manifest, icons, and setup script

### What did NOT change
- All 89 JavaScript functions preserved verbatim
- All `/api/*` serverless endpoints untouched
- All DOM IDs the JS references preserved (85 checked, 0 missing)
- `admin.html`, `setup.html` untouched

### Verified
- 0 console errors on page load (jsdom smoke test)
- All critical DOM IDs present
- Interactions pass: chip selection, drawer open/close, Esc / Ctrl+, shortcuts, platform tab switching, project mirror sync, form clear, section collapse, keyboard shortcut modal
