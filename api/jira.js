// api/jira.js — Vercel Serverless Function
// ALL Jira API calls run here (server-side). Zero CORS issues.
// Browser sends: { action, config, payload }
// Server calls Jira, returns result to browser.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, config, payload } = req.body;
  const { jiraUrl, jiraEmail, jiraToken, jiraProj, jiraBoard } = config || {};

  if (!jiraUrl || !jiraEmail || !jiraToken) {
    return res.status(400).json({ error: 'Missing Jira credentials' });
  }

  const auth = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
  const base = jiraUrl.replace(/\/$/, '');

  try {
    switch (action) {

      case 'create_issue': {
        const r = await fetch(`${base}/rest/api/3/issue`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: d.errorMessages?.[0] || d.message || `Jira ${r.status}` });
        return res.json({ id: d.key, url: `${base}/browse/${d.key}` });
      }

      case 'add_comment': {
        const { issueKey, comment } = payload;
        const body = { body: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] } };
        const r = await fetch(`${base}/rest/api/3/issue/${issueKey}/comment`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.errorMessages?.[0] || `Jira ${r.status}` }); }
        return res.json({ ok: true });
      }

      case 'search_duplicates': {
        const { jql } = payload;
        const r = await fetch(`${base}/rest/api/3/issue/search?jql=${encodeURIComponent(jql)}&maxResults=5&fields=key,summary,status`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (!r.ok) return res.json({ issues: [] });
        const d = await r.json();
        return res.json({ issues: (d.issues || []).map(i => ({ id: i.key, title: i.fields.summary, status: i.fields.status.name, url: `${base}/browse/${i.key}` })) });
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

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Jira API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
