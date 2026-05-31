# BugForge AI — Verification Report
Date: 2026-05-29
Version: **v2026.04.18** (brand subtitle) — welcome banner still says "Bug Forge AI v4.7" (version string inconsistency)
File: index.html (**277.1 KB** / 283,753 bytes)

---

## Summary
| Result | Count |
|--------|-------|
| PASS   | 240   |
| FAIL   | 61    |
| WARN   | 2     |
| TOTAL  | 303   |

## Final Verdict
**❌ FIXES REQUIRED**

> ⚠️ **Important context:** The overwhelming majority of failures (Phases 9, 10, 18, and parts of 11 & 17 — ~58 of 61) are **not regressions** — they are the result of a deliberate **architecture change**. This build moved credential handling from *browser localStorage + in-UI credential inputs* (which the checklist was written against) to a **Vercel environment-variable / server-side model**. The credential-entry UI, the `_jiraSaveLs` / `_jiraReadInputs` / `_showConnStatus` helper layer, the `da_jira_*` / `da_ado_*` localStorage keys, and `btoa`/`atob` encoding were all intentionally removed. The checklist appears to describe a different (v12.x) design than the deployed code.
>
> The **core engine is healthy**: duplicate-detection 4-tier pipeline (Phase 5 — 25/25), the 5-path duplicate gate (Phase 6 — 13/15), the dup-status strip & modal (Phases 7–8 — 28/28), ProviderManager (Phase 12 — 12/12), state reset (Phase 13 — 15/15), ticket generation & post execution (Phases 14–15 — 27/27), mobile responsiveness (Phase 16 — 15/15), PWA (Phase 19 — 6/6), and Vercel config (Phase 20 — 8/8) **all pass cleanly.**
>
> There are **3 genuine defects** worth fixing regardless of the credential model — see **JS-06**, **GS-14**, and the Tier-4 regex bug in **Notes**.

---

## ✅ Fixes Applied (2026-05-29)

All three genuine defects have been fixed and the inline `<script>` blocks re-validated with `node --check` (all pass).

| # | Defect | Fix | Location |
|---|--------|-----|----------|
| 1 | **JS-06** — blanket `localStorage.clear()` on every load wiped theme/history/provider and contradicted the persistence comment | Removed the `localStorage.clear()` call (replaced with an explanatory comment); `resetSessionOnLoad()` now **reloads** `sessionLog` from `da_log` instead of zeroing it, so session history persists across reloads while chat/ticket/bulk working state is still reset | [index.html:1122-1128](index.html#L1122), [index.html:3852-3857](index.html#L3852) |
| 2 | **GS-14** — legacy `postTicket()` posted directly, bypassing the duplicate gate | Added a gate guard at the top of `postTicket()`: if `!dupCheckCompleted \|\| dupCheckHasResults`, it now routes through `postToSpecificPlatform(platform)` (the gated path) and returns; it only continues the legacy attachment flow once a clean check has run. *(The bulk loop was re-examined and already performs its own per-item duplicate check and skips dupes — [index.html:2961-2982](index.html#L2961) — so it is batch-appropriate, not a true bypass; left as-is.)* | [index.html:2571-2578](index.html#L2571) |
| 3 | **Tier-4 regex** — `/\[\s\S]*?\]/` (missing char-class `[`) silently dropped AI duplicate scores | Corrected to `/\[[\s\S]*?\]/` so the AI's JSON score array parses and Tier-4 holistic scoring takes effect | [index.html:2365](index.html#L2365) |

> The remaining 58 architecture-divergence failures (Phases 9, 10, 18, AJ/AA-*, SC-07/08/09) are unchanged — they reflect the intentional env-var credential model and are **not** code defects under that design. They are retained below for completeness.

---

## Failed Checks

### Genuine defects (fix regardless of architecture) — ✅ ALL FIXED

| ID | Description | File / Line | Recommended fix |
|----|-------------|-------------|-----------------|
| **JS-06** ✅ FIXED | `localStorage.clear()` ran unconditionally at the top of the main `<script>` on **every page load** — wipes `da_theme` and `da_log`. This is *worse* than the pattern the check guards against (it's not even gated behind a load listener). The comment at [index.html:3840-3841](index.html#L3840-L3841) (`resetSessionOnLoad`) explicitly claims *"Credentials persist in localStorage"* — directly **contradicted** by this line. | [index.html:1124](index.html#L1124) | If the env-var credential model is intended, **remove this line** and instead clear only session keys (`da_log`) explicitly, OR fix the misleading comment. As written, session history (`da_log`) can never persist across reloads. |
| **GS-14** ✅ FIXED | `_executePost` was **not** the only caller of `postJira()`/`postADO()`/`postGH()`. The legacy `postTicket()` ([index.html:2569](index.html#L2569)) and the bulk-processing loop ([index.html:2986-2988](index.html#L2986-L2988)) call them directly, **bypassing the duplicate-check gate**. | [index.html:2579-2587](index.html#L2579-L2587), [index.html:2986-2988](index.html#L2986-L2988) | Route `postTicket()` and bulk posting through `_executePost()` / the gate, or remove the dead `postTicket()` path. The primary 4 UI buttons correctly route through `postToSpecificPlatform → _executePost`, so this is a secondary-path leak. |

### Architecture-divergence failures (expected if the Vercel env-var credential model is the intended design)

**Phase 9 — Jira Configuration UI (GM-xx — IDs collide with Phase 7; listed here as P9)**

| ID | Description | Status |
|----|-------------|--------|
| GM-01 (P9) | `id="jira-url-input"` (type="url") | FAIL — input removed; panel shows "Credentials secured via Vercel env vars" ([index.html:907-916](index.html#L907)) |
| GM-02 (P9) | `id="jira-email-input"` (type="email") | FAIL — removed |
| GM-03 (P9) | `id="jira-token-input"` (type="password") | FAIL — removed |
| GM-04 (P9) | Show/hide token toggle | FAIL — no token field |
| GM-05 (P9) | `id="jira-conn-status"` status bar | FAIL — not present |
| GM-06 (P9) | `id="jira-test-btn"` | FAIL — Test button exists ([index.html:928](index.html#L928)) but has no `id` |
| GM-09 (P9) | "Create token" link to id.atlassian.com | FAIL — not present |
| GM-10 (P9) | "Stored in browser only" label | FAIL — replaced by "secured via Vercel env vars" |
| GM-11 (P9) | `function _jiraReadInputs()` | FAIL — does not exist |
| GM-12 (P9) | `function _jiraSaveLs()` (btoa) | FAIL — does not exist; `saveCfg('jira')` is a no-op ([index.html:3773-3777](index.html#L3773)) |
| GM-13 (P9) | `function _jiraClearCreds()` | FAIL — does not exist |
| GM-14 (P9) | `jiraCfg()` calls `_jiraReadInputs()` | FAIL — `jiraCfg()` reads `CFG.*` directly ([index.html:2652](index.html#L2652)) |
| GM-15 (P9) | `restoreConfig()` sets jira-url/email/token-input | FAIL — sets `ci-jira-*` ids instead ([index.html:3795-3796](index.html#L3795)) |
| GM-16 (P9) | `updateDots()` calls `_jiraReadInputs()` | FAIL — does not |
| GM-17 (P9) | `validateCfg('jira')` empty-field check | FAIL — none (creds from env) ([index.html:3151](index.html#L3151)) |
| GM-18 (P9) | `_showConnStatus('jira','testing')` | FAIL — `_showConnStatus` does not exist; uses `toast()` |
| GM-19 (P9) | `_showConnStatus('jira','success')` | FAIL — uses `toast()` |
| GM-20 (P9) | auto-calls `loadProjects('jira')` after test | FAIL — sets dot only |
| GM-07 (P9) | `id="jira-proj-select"` | ✅ PASS ([index.html:919](index.html#L919)) |
| GM-08 (P9) | `id="jira-assignee-input"` | ✅ PASS ([index.html:925](index.html#L925)) |

**Phase 10 — ADO Configuration UI**

| ID | Description | Status |
|----|-------------|--------|
| AD-02 | `id="ado-pat-input"` (type="password") | FAIL — removed |
| AD-03 | Show/hide PAT toggle | FAIL — no PAT field |
| AD-04 | `id="ado-conn-status"` | FAIL — not present |
| AD-05 | `id="ado-test-btn"` | FAIL — Test button exists ([index.html:970](index.html#L970)) but no `id` |
| AD-08 | "Create PAT" link to dev.azure.com | FAIL — not present |
| AD-09 | "Stored in browser only" label | FAIL — replaced by env-var note |
| AD-10 | `function _adoReadInputs()` | FAIL — does not exist |
| AD-11 | `function _adoClearCreds()` | FAIL — does not exist |
| AD-12 | `btoa(CFG.adoPat)` → `da_ado_pat` | FAIL — no localStorage credential storage |
| AD-13 | `adoCfg()` calls `_adoReadInputs()` | FAIL — reads `ado-org-text` inline instead ([index.html:2653-2660](index.html#L2653)) |
| AD-14 | `restoreConfig()` sets ado-org-text **and** ado-pat-input | FAIL — sets `ado-org-text` ✓ but `ado-pat-input` does not exist |
| AD-15 | `validateCfg('ado')` empty-field check | FAIL — none |
| AD-16 | `_showConnStatus('ado','testing')` | FAIL — not present |
| AD-17 | `_showConnStatus('ado','success')` | FAIL — not present |
| AD-18 | auto-calls `loadAdoProjects()` after test | FAIL — sets dot only |
| AD-01 | `id="ado-org-text"` | ✅ PASS ([index.html:944](index.html#L944)) |
| AD-06 | `id="ado-proj-select"` | ✅ PASS ([index.html:961](index.html#L961)) |
| AD-07 | `id="ado-assignee-input"` | ✅ PASS ([index.html:967](index.html#L967)) |

**Phase 11 — API credential priority & error copy** (consistent with env-var model)

| ID | Description | File / Line | Note |
|----|-------------|-------------|------|
| AJ-01 | `config?.jiraUrl` before `process.env.JIRA_URL` | [api/jira.js:25](api/jira.js#L25) | Order is **reversed** — env wins (`_org || env || config`). Intentional for env-var model. |
| AJ-02 | `config?.jiraEmail` before env | [api/jira.js:26](api/jira.js#L26) | reversed |
| AJ-03 | `config?.jiraToken` before env | [api/jira.js:27](api/jira.js#L27) | reversed |
| AJ-04 | URL error says "Enter in Settings" | [api/jira.js:34](api/jira.js#L34) | says "Add to Vercel Environment Variables" — actually **correct** for env-var model, but fails the checklist wording |
| AJ-05 | Token error says "Enter in Settings" | [api/jira.js:36](api/jira.js#L36) | says "Add to Vercel…" |
| AA-01 | `config?.adoPat` before `process.env.ADO_PAT` | [api/ado.js:27](api/ado.js#L27) | reversed |
| AA-02 | `config?.adoOrg` before env | [api/ado.js:25](api/ado.js#L25) | reversed |
| AA-03 | PAT error says "Enter in Settings" | [api/ado.js:32](api/ado.js#L32) | says "Add to Vercel…" |

**Phase 17 — Security (credential-storage items)**

| ID | Description | Note |
|----|-------------|------|
| SC-07 | Jira token stored with `btoa()` in `_jiraSaveLs` | FAIL — no client-side token storage (env-var model). *Arguably more secure.* |
| SC-08 | ADO PAT stored with `btoa()` | FAIL — no client-side storage |
| SC-09 | `type="password"` on jira-token-input / ado-pat-input | FAIL — those inputs do not exist |

**Phase 18 — localStorage Schema** (credential keys removed; `LS = k => ''` stub at [index.html:1126](index.html#L1126))

| ID | Key | Status |
|----|-----|--------|
| LS-01 → LS-14 | `da_jira_url`, `da_jira_email`, `da_jira_token`, `da_jira_proj`, `da_jira_assignee`, `da_ado_org`, `da_ado_pat`, `da_ado_proj`, `da_ado_assignee`, `da_gh_owner`, `da_gh_repo`, `da_gh_token`, `da_slack`, `da_teams` | **FAIL (×14)** — none of these keys are read or written anywhere. Credentials are env-var/server-side now. |
| LS-17 | `restoreConfig()` uses `atob()` | FAIL — `atob`/`btoa` not used anywhere |
| LS-15 | `da_log` — JSON array | ✅ PASS ([index.html:1613](index.html#L1613), [2893](index.html#L2893)) — *but see JS-06: cleared on every load* |
| LS-16 | `da_theme` — 'dark'/'light' | ✅ PASS ([index.html:523](index.html#L523), [1924](index.html#L1924)) |

---

## Warnings

| ID | Description | Recommendation |
|----|-------------|----------------|
| **JS-05** | A `document.write()` call exists at [index.html:1870](index.html#L1870). | Acceptable — it writes to a **newly opened popup window** (`w.document.write`) for the print/export feature, not the live document. No action needed; flagged only because the check forbids `document.write(` outright. |
| **GS-08** | Path 3 ("clean auto-post") — the text *"Check ran cleanly, no dupes — auto-proceed"* exists as a **code comment** ([index.html:3489](index.html#L3489)), not a `console.log`. | Cosmetic. The auto-proceed behaviour is correct and is logged via the adjacent Path-5 `console.log` at [index.html:3515](index.html#L3515). Optionally add the explicit log. |

---

## Section Breakdown
| Section | PASS | FAIL | WARN |
|---------|------|------|------|
| 1 File structure | 7 | 0 | 0 |
| 2 JS integrity | 6 | 1 | 1 |
| 3 State variables | 10 | 0 | 0 |
| 4 Core functions | 30 | 0 | 0 |
| 5 Duplicate detection (4-tier) | 25 | 0 | 0 |
| 6 Duplicate gate (5 paths) | 13 | 1 | 1 |
| 7 Dup gate modal | 12 | 0 | 0 |
| 8 Dup status strip | 16 | 0 | 0 |
| 9 Jira config UI | 2 | 18 | 0 |
| 10 ADO config UI | 3 | 15 | 0 |
| 11 API handlers | 22 | 8 | 0 |
| 12 Provider manager | 12 | 0 | 0 |
| 13 State reset completeness | 15 | 0 | 0 |
| 14 Ticket generation flow | 14 | 0 | 0 |
| 15 Post execution | 13 | 0 | 0 |
| 16 Mobile responsiveness | 15 | 0 | 0 |
| 17 Security | 9 | 3 | 0 |
| 18 localStorage schema | 2 | 15 | 0 |
| 19 PWA | 6 | 0 | 0 |
| 20 Vercel configuration | 8 | 0 | 0 |
| **TOTAL** | **240** | **61** | **2** |

---

## Notes

1. **Credential-model migration is the headline.** This build serves all platform credentials (Jira/ADO/GitHub) from **Vercel environment variables** (and optional multi-tenant KV via `?org=` — see [api/jira.js:16-24](api/jira.js#L16) and `loadOrgConfig()` at [index.html:3717](index.html#L3717)). The checklist was authored against an earlier *browser-stored-credentials* design. If the env-var model is the intended direction, **Phases 9, 10, 18, SC-07/08/09, and AJ/AA-01..05 should be treated as "checklist out-of-date," not as code defects.** If browser-stored credentials are still a requirement, this build is a major regression in that area.

2. **🐛 Latent bug — Tier-4 AI duplicate scoring regex was malformed. ✅ NOW FIXED** (`/\[\s\S]*?\]/` → `/\[[\s\S]*?\]/` at [index.html:2365](index.html#L2365)). Original analysis below:
   ```js
   const scores = JSON.parse(txt.match(/\[\s\S]*?\]/)?.[0]||'[]');
   ```
   The intended regex is `/\[[\s\S]*?\]/` (literal `[` + char-class `[\s\S]` lazy + literal `]`). As written, `/\[\s\S]*?\]/` has a **missing opening `[`** for the character class, so it matches "`[`, one whitespace, one non-whitespace, zero-or-more `]`, `]`" — which will **fail to match a normal `[{...}]` JSON array** in most cases. The `JSON.parse` then falls back to `'[]'`, meaning **AI holistic scores are silently dropped** and candidates keep their default score of `50`. The 4-tier pipeline's "Tier 4" therefore likely degrades to keyword+semantic only. The error is swallowed by the `try/catch` at [index.html:2374](index.html#L2374), so it fails silently. **Recommend fixing to `/\[[\s\S]*?\]/`.** (Not part of the checklist; surfaced during review.)

3. **Version string inconsistency.** The brand subtitle reads `v2026.04.18` ([index.html:634](index.html#L634), [1291](index.html#L1291)) while the chat welcome banner still reads `Bug Forge AI v4.7` ([index.html:3857](index.html#L3857)). Pick one source of truth. (Neither matches the report template's expected "v12.x".)

4. **`saveCfg()` is a deliberate no-op** for jira/ado/gh/notif sections ([index.html:3773-3777](index.html#L3773)) — it toasts "Credentials are configured via Vercel Environment Variables" and returns. Consistent with note 1.

5. **CSP is well-formed and complete** — `object-src 'none'`, `frame-ancestors`, and all required connect-src domains (anthropic, generativelanguage, groq, atlassian.net, dev.azure.com, github) are present ([vercel.json:26](vercel.json#L26)). Security posture for headers is strong.

6. **PW-02 nuance:** `sw.js` uses `const CACHE = 'bugforgeai-offline-v1'` rather than the literal identifier `CACHE_NAME`. Counted as PASS (a cache-name constant exists and functions identically); rename for convention if desired.

7. **Naming:** the checklist reuses the `GM-` prefix for both Phase 7 (gate modal) and Phase 9 (Jira UI). They are disambiguated in this report as `GM-xx` (Phase 7) and `GM-xx (P9)` (Phase 9).
