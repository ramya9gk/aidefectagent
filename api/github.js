// api/github.js — Vercel Serverless Function
// All GitHub API calls run server-side. Zero CORS.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, config, payload } = req.body;

  // Read from Vercel env vars first, fall back to browser-supplied config
  // Multi-tenant: load from KV if orgCode provided
  let orgCfgGh = {};
  if (config?.orgCode && process.env.KV_REST_API_URL) {
    try {
      const kvR = await fetch(`${process.env.KV_REST_API_URL}/get/org:${config.orgCode}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const kvD = await kvR.json();
      if (kvD.result) orgCfgGh = JSON.parse(kvD.result);
    } catch(e) { console.warn('KV lookup failed:', e.message); }
  }

  const ghOwner = orgCfgGh.ghOwner || process.env.GITHUB_OWNER || config?.ghOwner || '';
  const ghRepo  = orgCfgGh.ghRepo  || process.env.GITHUB_REPO  || config?.ghRepo  || '';
  const ghToken = orgCfgGh.ghToken || process.env.GITHUB_TOKEN || config?.ghToken  || '';

  if (!ghOwner) return res.status(400).json({ error: 'GITHUB_OWNER not set. Add to Vercel Environment Variables.' });
  if (!ghRepo)  return res.status(400).json({ error: 'GITHUB_REPO not set. Add to Vercel Environment Variables.' });
  if (!ghToken) return res.status(400).json({ error: 'GITHUB_TOKEN not set. Add to Vercel Environment Variables.' });

  const auth = `token ${ghToken}`;
  const base = `https://api.github.com/repos/${ghOwner}/${ghRepo}`;

  try {
    switch (action) {

      case 'create_issue': {
        const { title, body, labels, assignees } = payload;

        // Guard: GitHub will reject with 422 if title is missing
        if (!title || !String(title).trim()) {
          return res.status(400).json({
            error: 'Title is required but was not supplied. The AI ticket may have used "summary" instead of "title" — regenerate with platform=GitHub or edit the ticket to add a title.'
          });
        }

        // Auto-create labels (ignore 422 = already exists)
        for (const label of (labels||[])) {
          await fetch(`${base}/labels`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: label, color: 'ededed' }),
          }).catch(() => {});
        }

        // Build issue payload
        const issuePayload = { title: String(title).trim(), body: body || '', labels: labels||[] };
        if (assignees && assignees.length > 0) issuePayload.assignees = assignees;

        const r = await fetch(`${base}/issues`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
          body: JSON.stringify(issuePayload),
        });
        if (!r.ok) {
          const e = await r.json();
          if (r.status === 404) return res.status(404).json({
            error: `Repo "${ghOwner}/${ghRepo}" not found. Check GITHUB_OWNER and GITHUB_REPO in Vercel env vars. Repo must exist and token must have repo access.`
          });
          if (r.status === 401) return res.status(401).json({
            error: `GitHub token invalid or expired. Update GITHUB_TOKEN in Vercel env vars.`
          });
          return res.status(r.status).json({ error: e.message || `GitHub ${r.status}` });
        }
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
        const { query, maxResults=8 } = payload;
        // Search both open and closed issues (closed dupes still matter)
        const r = await fetch(
          `https://api.github.com/search/issues?q=${encodeURIComponent(query)}+repo:${ghOwner}/${ghRepo}+is:issue&per_page=${maxResults}&sort=relevance`,
          { headers: { Authorization: auth, Accept: 'application/vnd.github.v3+json' } }
        );
        if (!r.ok) return res.json({ items: [] });
        const d = await r.json();
        return res.json({ items: (d.items || []).map(i => ({ id: `#${i.number}`, title: i.title, status: i.state, url: i.html_url })) });
      }

      case 'link_duplicate': {
        // Add "duplicate" label to the new issue + post a comment referencing the original
        const { issueNumber, duplicateOfNumber, duplicateOfUrl } = payload;
        const newNum  = String(issueNumber).replace('#','');
        const origNum = String(duplicateOfNumber).replace('#','');
        // Add label
        await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/issues/${newNum}/labels`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
          body: JSON.stringify({ labels: ['duplicate'] })
        });
        // Post comment
        const commentR = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/issues/${newNum}/comments`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
          body: JSON.stringify({ body: `🔁 This issue is a duplicate of #${origNum}.\n\nOriginal: ${duplicateOfUrl}\n\n> Linked by Bug Forge AI` })
        });
        if (!commentR.ok) {
          const e = await commentR.text();
          return res.json({ ok: false, error: `GitHub comment ${commentR.status}: ${e.slice(0,100)}` });
        }
        return res.json({ ok: true });
      }

      case 'validate': {
        const r = await fetch('https://api.github.com/user', {
          headers: { Authorization: auth, Accept: 'application/vnd.github.v3+json' },
        });
        if (!r.ok) return res.json({ valid: false, error: 'Invalid GitHub token.' });
        const d = await r.json();
        return res.json({ valid: true, displayName: d.login });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('GitHub API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
