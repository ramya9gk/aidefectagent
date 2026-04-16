// api/projects.js — Fetch live project lists from Jira and ADO
// Returns projects for UI dropdowns — no hardcoded project needed

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform } = req.body;

  // ── JIRA projects ──────────────────────────────────────────
  if (platform === 'jira') {
    const jiraUrl   = process.env.JIRA_URL   || '';
    const jiraEmail = process.env.JIRA_EMAIL || '';
    const jiraToken = process.env.JIRA_TOKEN || '';

    if (!jiraUrl || !jiraEmail || !jiraToken) {
      return res.json({ projects: [], error: 'Jira credentials not configured in Vercel env vars' });
    }

    const auth = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
    const base = jiraUrl.replace(/\/$/, '');

    try {
      const r = await fetch(`${base}/rest/api/3/project/search?maxResults=50&orderBy=name`, {
        headers: { Authorization: auth, Accept: 'application/json' }
      });
      if (!r.ok) return res.json({ projects: [], error: `Jira ${r.status}` });

      const d = await r.json();
      const projects = (d.values || []).map(p => ({
        key:  p.key,
        name: p.name,
        type: p.projectTypeKey,
        id:   p.id
      }));

      return res.json({ projects });
    } catch (err) {
      return res.json({ projects: [], error: err.message });
    }
  }

  // ── ADO projects ───────────────────────────────────────────
  if (platform === 'azure_devops') {
    const adoOrg = process.env.ADO_ORG || '';
    const adoPat = process.env.ADO_PAT || '';

    if (!adoOrg || !adoPat) {
      return res.json({ projects: [], error: 'ADO credentials not configured in Vercel env vars' });
    }

    const auth = 'Basic ' + Buffer.from(`:${adoPat}`).toString('base64');

    try {
      const r = await fetch(
        `https://dev.azure.com/${adoOrg}/_apis/projects?api-version=6.0&$top=50`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );

      // ADO returns HTML on bad PAT
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        return res.json({ projects: [], error: 'ADO PAT invalid or expired' });
      }

      if (!r.ok) return res.json({ projects: [], error: `ADO ${r.status}` });

      const d = await r.json();
      const projects = (d.value || []).map(p => ({
        key:  p.id,
        name: p.name,
        type: p.projectTypeKey || 'agile',
        id:   p.id
      }));

      return res.json({ projects });
    } catch (err) {
      return res.json({ projects: [], error: err.message });
    }
  }

  return res.status(400).json({ error: `Unknown platform: ${platform}` });
}
