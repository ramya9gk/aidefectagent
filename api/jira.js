// api/jira.js — Vercel Serverless Function v3.4
// ALL Jira API calls run here (server-side). Zero CORS issues.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, config, payload } = req.body;

  // Multi-tenant: load from KV if orgCode provided
  let _org = {};
  if (config?.orgCode && process.env.KV_REST_API_URL) {
    try {
      const _r = await fetch(`${process.env.KV_REST_API_URL}/get/org:${config.orgCode}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const _d = await _r.json();
      if (_d.result) _org = JSON.parse(_d.result);
    } catch(e) {}
  }
  // Credentials come from the UI config (browser-entered). Optional multi-tenant
  // KV (_org, only when ?org= is used) takes precedence. Vercel env vars are NOT read.
  const jiraUrl   = _org.jiraUrl   || config?.jiraUrl   || '';
  const jiraEmail = _org.jiraEmail || config?.jiraEmail || '';
  const jiraToken = _org.jiraToken || config?.jiraToken || '';
  const jiraProj   = config?.jiraProj   || '';
  const jiraBoard  = config?.jiraBoard  || '';
  const jiraIssueType    = config?.jiraIssueType    || '';
  const jiraAssignee     = config?.jiraAssignee     || '';
  const jiraReporterEmail= config?.jiraReporterEmail || jiraEmail;

  if (!jiraUrl)   return res.status(400).json({ error: 'Jira URL not set. Enter it in Settings → Platforms → Jira.' });
  if (!jiraEmail) return res.status(400).json({ error: 'Jira email not set. Enter it in Settings → Platforms → Jira.' });
  if (!jiraToken) return res.status(400).json({ error: 'Jira API token not set. Enter it in Settings → Platforms → Jira.' });
  if (!jiraProj)  return res.status(400).json({ error: 'Jira project not set. Select a project in Settings → Platforms → Jira.' });

  const auth = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
  const base = jiraUrl.replace(/\/$/, '');
  const proj = jiraProj.trim().toUpperCase();

  // ── Auto-detect valid issue type for this project ──────────
  async function getIssueType() {
    // If user configured a specific type, use it
    if (jiraIssueType && jiraIssueType.trim()) return jiraIssueType.trim();

    try {
      // Fetch project metadata to get valid issue types
      const r = await fetch(
        `${base}/rest/api/3/project/${proj}`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );
      if (!r.ok) return 'Task'; // safe fallback

      const d = await r.json();
      const types = (d.issueTypes || []).map(t => t.name);

      // Priority order: Bug → Story → Task → first available
      const preferred = ['Bug', 'Story', 'Task', 'Issue', 'Defect'];
      for (const t of preferred) {
        if (types.includes(t)) return t;
      }
      // Return first non-subtask type
      const nonSub = (d.issueTypes || []).find(t => !t.subtask);
      return nonSub?.name || 'Task';
    } catch {
      return 'Task';
    }
  }

  // ── Lookup any user accountId from email ─────────────────
  async function lookupAccountId(email) {
    if (!email) return null;
    try {
      const r = await fetch(
        `${base}/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=1`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );
      if (!r.ok) return null;
      const users = await r.json();
      const match = users.find(u => u.emailAddress?.toLowerCase() === email.toLowerCase());
      return match?.accountId || users[0]?.accountId || null;
    } catch { return null; }
  }

  // ── Lookup reporter accountId from email ─────────────────
  async function getReporterAccountId() {
    try {
      const r = await fetch(
        `${base}/rest/api/3/user/search?query=${encodeURIComponent(jiraReporterEmail)}&maxResults=1`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );
      if (!r.ok) return null;
      const users = await r.json();
      // Find exact email match
      const match = users.find(u =>
        u.emailAddress?.toLowerCase() === jiraReporterEmail.toLowerCase()
      );
      return match?.accountId || users[0]?.accountId || null;
    } catch {
      return null;
    }
  }

  try {
    switch (action) {

      case 'create_issue': {
        const issueType = await getIssueType();
        const issueReporterAccountId = await getReporterAccountId();
        const issueAssigneeAccountId = await lookupAccountId(jiraAssignee);

        const buildFields = (stripFields = []) => {
          const f = {
            ...payload.fields,
            project:   { key: proj },
            issuetype: { name: issueType },
            ...(issueReporterAccountId ? { reporter:  { id: issueReporterAccountId } } : {}),
            ...(issueAssigneeAccountId ? { assignee:  { id: issueAssigneeAccountId } } : {}),
          };
          // Remove any fields the caller asked to strip (from prior rejection)
          for (const k of stripFields) delete f[k];
          return f;
        };

        let fields = buildFields();

        if (!fields.summary?.trim()) {
          return res.status(400).json({ error: 'Summary is empty — generate the ticket first.' });
        }

        // Attempt up to 3 times, stripping rejected fields between retries.
        // Jira's typical failure modes: priority not on screen, labels disabled,
        // components not available, etc. Retry drops offending fields and tries again.
        const stripped = [];
        const REQUIRED = new Set(['project', 'issuetype', 'summary', 'description']);
        let lastErr = null;

        for (let attempt = 0; attempt < 3; attempt++) {
          console.log(`Creating Jira issue (attempt ${attempt + 1}): project=${proj}, type=${issueType}, summary=${fields.summary?.slice(0, 50)}, stripped=[${stripped.join(',')}]`);

          const r = await fetch(`${base}/rest/api/3/issue`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ fields }),
          });

          const d = await r.json();
          if (r.ok) {
            // If we stripped fields but still succeeded, add a note about what was dropped
            const note = stripped.length
              ? ` (note: these fields were not available on this project's Bug screen and were omitted: ${stripped.join(', ')})`
              : '';
            return res.json({ id: d.key, url: `${base}/browse/${d.key}`, note });
          }

          // Try to figure out which field(s) Jira rejected
          const fieldErrors = d.errors || {};
          const rejected = Object.keys(fieldErrors).filter(k => !REQUIRED.has(k));

          if (rejected.length && attempt < 2) {
            // Strip rejected fields and retry
            stripped.push(...rejected);
            fields = buildFields(stripped);
            console.log(`Jira rejected fields [${rejected.join(',')}]: ${JSON.stringify(fieldErrors).slice(0,200)}. Retrying without them.`);
            continue;
          }

          // Final failure — surface a helpful error
          lastErr = d.errorMessages?.[0]
            || Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v}`).join('; ')
            || d.message
            || `Jira ${r.status}`;
          return res.status(r.status).json({ error: lastErr, rejectedFields: rejected });
        }

        return res.status(500).json({ error: lastErr || 'Jira create failed after 3 attempts' });
      }

      case 'add_comment': {
        const { issueKey, comment } = payload;
        const body = {
          body: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] }
        };
        const r = await fetch(`${base}/rest/api/3/issue/${issueKey}/comment`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.errorMessages?.[0] || `Jira ${r.status}` }); }
        return res.json({ ok: true });
      }

      case 'get_issue_types': {
        // Expose available issue types to frontend for sidebar display
        const r = await fetch(`${base}/rest/api/3/project/${proj}`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (!r.ok) return res.json({ types: ['Bug', 'Task', 'Story'] });
        const d = await r.json();
        const types = (d.issueTypes || []).filter(t => !t.subtask).map(t => t.name);
        return res.json({ types });
      }

      case 'search_duplicates': {
        const { jql, maxResults=8 } = payload;
        const r = await fetch(`${base}/rest/api/3/issue/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=key,summary,status`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (!r.ok) return res.json({ issues: [] });
        const d = await r.json();
        return res.json({ issues: (d.issues || []).map(i => ({ id: i.key, title: i.fields.summary, status: i.fields.status.name, url: `${base}/browse/${i.key}` })) });
      }

      case 'link_duplicate': {
        // Create a "Duplicates" issue link from new ticket → existing ticket
        const { inwardKey, outwardKey } = payload;
        const r = await fetch(`${base}/rest/api/3/issueLink`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            type: { name: 'Duplicate' },
            inwardIssue:  { key: String(inwardKey)  },   // new ticket "is duplicated by"
            outwardIssue: { key: String(outwardKey) },    // existing ticket "duplicates"
          }),
        });
        if (!r.ok) {
          const e = await r.text();
          return res.json({ ok: false, error: `Jira link ${r.status}: ${e.slice(0,150)}` });
        }
        return res.json({ ok: true });
      }

      case 'get_sprint': {
        if (!jiraBoard) return res.json({ sprint: null });
        const r = await fetch(`${base}/rest/agile/1.0/board/${jiraBoard}/sprint?state=active`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (!r.ok) return res.json({ sprint: null });
        const d = await r.json();
        return res.json({ sprint: d.values?.[0] || null });
      }

      case 'assign_sprint': {
        const { sprintId, issueKey } = payload;
        await fetch(`${base}/rest/agile/1.0/sprint/${sprintId}/issue`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ issues: [issueKey] }),
        });
        return res.json({ ok: true });
      }

      case 'link_issue': {
        const { inwardKey, outwardKey } = payload;
        const r = await fetch(`${base}/rest/api/3/issueLink`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: { name: 'is child of' }, inwardIssue: { key: inwardKey }, outwardIssue: { key: outwardKey } }),
        });
        if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.message || `Jira ${r.status}` }); }
        return res.json({ ok: true });
      }

      case 'validate': {
        // Test if Jira credentials are valid
        const r = await fetch(`${base}/rest/api/3/myself`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (!r.ok) return res.json({ valid: false, error: `Invalid credentials (${r.status}). Check email and API token.` });
        const d = await r.json();
        return res.json({ valid: true, displayName: d.displayName || d.emailAddress });
      }

      case 'get_reporter': {
        // Return the resolved reporter accountId for sidebar display
        const accountId = await getReporterAccountId();
        if (!accountId) return res.json({ found: false, email: jiraReporterEmail, error: 'User not found in Jira' });
        return res.json({ found: true, accountId, email: jiraReporterEmail });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Jira API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
