// api/projects.js — Fetch live project lists from Jira and ADO
// Jira: uses env vars for credentials, returns project list
// ADO: uses ADO_PAT from env var, but accepts org from browser (user types it)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, adoOrg, config } = req.body;

  // Multi-tenant: if an orgCode is supplied, load that org's full creds from KV
  // (browser never holds the tokens in org mode). Merge over the browser config.
  let cfg = config || {};
  if (cfg.orgCode) {
    const kvUrl = process.env.BUGFORGE_REST_API_KV_REST_API_URL || process.env.KV_REST_API_URL;
    const kvTok = process.env.BUGFORGE_REST_API_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;
    if (kvUrl) {
      try {
        const kr = await fetch(`${kvUrl}/get/org:${cfg.orgCode}`, { headers: { Authorization: `Bearer ${kvTok}` } });
        const kd = await kr.json();
        if (kd.result) cfg = { ...cfg, ...JSON.parse(kd.result) };
      } catch(e) { /* fall through to whatever config has */ }
    }
  }

  // ── JIRA projects ──────────────────────────────────────────
  if (platform === 'jira') {
    // Credentials from KV (org mode) or the browser config (single-tenant).
    const jiraUrl   = cfg.jiraUrl   || '';
    const jiraEmail = cfg.jiraEmail || '';
    const jiraToken = cfg.jiraToken || '';

    if (!jiraUrl || !jiraEmail || !jiraToken) {
      return res.json({ projects: [], error: 'Enter your Jira URL, email and API token in Settings.' });
    }

    const auth = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
    const base = jiraUrl.replace(/\/$/, '');

    try {
      const r = await fetch(`${base}/rest/api/3/project/search?maxResults=50&orderBy=name`, {
        headers: { Authorization: auth, Accept: 'application/json' }
      });
      if (!r.ok) return res.json({ projects: [], error: `Jira ${r.status} — check credentials` });
      const d = await r.json();
      const projects = (d.values || []).map(p => ({
        key: p.key, name: p.name, type: p.projectTypeKey, id: p.id
      }));
      return res.json({ projects });
    } catch (err) {
      return res.json({ projects: [], error: err.message });
    }
  }

  // ── ADO organisations ──────────────────────────────────────
  // Uses the Azure DevOps profile + accounts API to list all orgs the PAT can access.
  if (platform === 'azure_devops_orgs') {
    const adoPat = cfg.adoPat || '';
    if (!adoPat) return res.json({ orgs: [], error: 'Enter your Azure DevOps PAT in Settings.' });

    const auth = 'Basic ' + Buffer.from(`:${adoPat}`).toString('base64');

    try {
      // Step 1: get the member (user) ID from the profile API
      const profileR = await fetch(
        'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=6.0',
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );
      if (profileR.status === 401 || profileR.status === 203) {
        return res.json({ orgs: [], error: 'ADO PAT is invalid or expired — update it in Settings' });
      }
      if (!profileR.ok) return res.json({ orgs: [], error: `Profile API ${profileR.status}` });
      const profile = await profileR.json();
      const memberId = profile.id;
      if (!memberId) return res.json({ orgs: [], error: 'Could not resolve ADO member ID from PAT' });

      // Step 2: list all organizations the member belongs to
      const accountsR = await fetch(
        `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${memberId}&api-version=6.0`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );
      if (!accountsR.ok) return res.json({ orgs: [], error: `Accounts API ${accountsR.status}` });
      const accountsD = await accountsR.json();
      const orgs = (accountsD.value || []).map(a => ({
        name: a.accountName,
        id:   a.accountId,
        url:  a.accountUri
      }));
      return res.json({ orgs });
    } catch (err) {
      return res.json({ orgs: [], error: err.message });
    }
  }

  // ── ADO projects ───────────────────────────────────────────
  // ADO_PAT from env var (secure), org name from browser (user types it)
  if (platform === 'azure_devops') {
    const adoPat = cfg.adoPat || '';
    const org    = adoOrg || cfg.adoOrg || '';

    if (!adoPat) {
      return res.json({ projects: [], error: 'Enter your Azure DevOps PAT in Settings.' });
    }
    if (!org) {
      return res.json({ projects: [], error: 'Enter your ADO organisation name first' });
    }

    const auth = 'Basic ' + Buffer.from(`:${adoPat}`).toString('base64');

    try {
      const r = await fetch(
        `https://dev.azure.com/${org}/_apis/projects?api-version=6.0&$top=50`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );

      const ct = r.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        return res.json({ projects: [], error: 'Invalid organisation name or PAT expired' });
      }
      if (r.status === 401) {
        return res.json({ projects: [], error: 'ADO PAT is invalid or expired — update it in Settings' });
      }
      if (r.status === 404) {
        return res.json({ projects: [], error: `Organisation "${org}" not found — check spelling` });
      }
      if (!r.ok) return res.json({ projects: [], error: `ADO ${r.status}` });

      const d = await r.json();
      const projects = (d.value || []).map(p => ({
        key: p.id, name: p.name, id: p.id
      }));
      return res.json({ projects });
    } catch (err) {
      return res.json({ projects: [], error: err.message });
    }
  }

  return res.status(400).json({ error: `Unknown platform: ${platform}` });
}
