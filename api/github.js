// api/github.js — Vercel Serverless Function
// All GitHub API calls run server-side. Zero CORS.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, config, payload } = req.body;
  const { ghOwner, ghRepo, ghToken } = config || {};

  if (!ghOwner || !ghRepo || !ghToken) return res.status(400).json({ error: 'Missing GitHub credentials' });

  const auth = `token ${ghToken}`;
  const base = `https://api.github.com/repos/${ghOwner}/${ghRepo}`;

  try {
    switch (action) {

      case 'create_issue': {
        const { title, body, labels } = payload;
        // Auto-create labels (ignore 422 = already exists)
        for (const label of labels) {
          await fetch(`${base}/labels`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: label, color: 'ededed' }),
          }).catch(() => {});
        }
        const r = await fetch(`${base}/issues`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
          body: JSON.stringify({ title, body, labels }),
        });
        if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.message || `GitHub ${r.status}` }); }
        const d = await r.json();
        return res.json({ id: `#${d.number}`, rawId: d.number, url: d.html_url });
      }

      case 'add_comment': {
        const { issueNumber, comment } = payload;
        const r = await fetch(`${base}/issues/${issueNumber}/comments`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: comment }),
        });
        if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.message || `GitHub ${r.status}` }); }
        return res.json({ ok: true });
      }

      case 'search_duplicates': {
        const { query } = payload;
        const r = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}+repo:${ghOwner}/${ghRepo}+is:issue+is:open&per_page=5`, {
          headers: { Authorization: auth, Accept: 'application/vnd.github.v3+json' },
        });
        if (!r.ok) return res.json({ items: [] });
        const d = await r.json();
        return res.json({ items: (d.items || []).map(i => ({ id: `#${i.number}`, title: i.title, status: i.state, url: i.html_url })) });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('GitHub API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
