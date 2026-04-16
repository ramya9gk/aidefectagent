// api/ado.js — Vercel Serverless Function
// All Azure DevOps API calls run server-side. Zero CORS.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, config, payload } = req.body;

  // Read from Vercel env vars first, fall back to browser-supplied config
  const adoOrg  = process.env.ADO_ORG     || config?.adoOrg  || '';
  const adoProj = process.env.ADO_PROJECT  || config?.adoProj || '';
  const adoPat  = process.env.ADO_PAT      || config?.adoPat  || '';
  const adoTeam = process.env.ADO_TEAM     || config?.adoTeam || '';

  if (!adoOrg)  return res.status(400).json({ error: 'ADO_ORG not set. Add to Vercel Environment Variables.' });
  if (!adoPat)  return res.status(400).json({ error: 'ADO_PAT not set. Add to Vercel Environment Variables.' });
  if (!adoProj) return res.status(400).json({ error: 'ADO_PROJECT not set. Add to Vercel Environment Variables.' });

  const auth = 'Basic ' + Buffer.from(`:${adoPat}`).toString('base64');
  const proj = encodeURIComponent(adoProj);
  const base = `https://dev.azure.com/${adoOrg}`;

  async function adoFetch(url, opts = {}) {
    const r = await fetch(url, {
      ...opts,
      headers: { Authorization: auth, ...(opts.headers || {}) }
    });
    const ct = r.headers.get('content-type') || '';
    // ADO returns HTML login page when PAT is invalid
    if (ct.includes('text/html')) return { ok: false, status: 401, _html: true };
    return r;
  }

  function authErr() {
    return res.status(401).json({
      error: 'ADO PAT invalid or expired. Go to ADO → User Settings → Personal Access Tokens → create new token with Work Items: Read & Write scope.'
    });
  }

  try {
    switch (action) {

      case 'create_bug': {
        const r = await adoFetch(`${base}/${proj}/_apis/wit/workitems/$Bug?api-version=6.0`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json-patch+json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        if (r._html || r.status === 401 || r.status === 203) return authErr();
        if (r.status === 404) return res.status(404).json({ error: `Project "${adoProj}" not found in org "${adoOrg}". Check exact spelling.` });
        if (r.status === 403) return res.status(403).json({ error: 'PAT lacks permissions. Enable Work Items: Read & Write in your PAT.' });
        if (!r.ok) { const t = await r.text(); return res.status(r.status).json({ error: `ADO ${r.status}: ${t.slice(0,200)}` }); }
        const d = await r.json();
        return res.json({ id: `#${d.id}`, rawId: d.id, url: d._links?.html?.href || `${base}/${adoProj}/_workitems/edit/${d.id}` });
      }

      case 'add_comment': {
        const { workItemId, comment } = payload;
        const r = await adoFetch(`${base}/${proj}/_apis/wit/workitems/${workItemId}?api-version=6.0`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([{ op: 'add', path: '/fields/System.History', value: comment }]),
        });
        if (r._html || r.status === 401) return authErr();
        if (!r.ok) return res.status(r.status).json({ error: `ADO ${r.status}` });
        return res.json({ ok: true });
      }

      case 'search_duplicates': {
        const { wiql } = payload;
        const r = await adoFetch(`${base}/${proj}/_apis/wit/wiql?api-version=6.0&$top=5`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: wiql }),
        });
        if (r._html || !r.ok) return res.json({ items: [] });
        const d = await r.json();
        const ids = (d.workItems || []).slice(0, 5).map(w => w.id);
        if (!ids.length) return res.json({ items: [] });
        const r2 = await adoFetch(`${base}/${proj}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.State&api-version=6.0`);
        if (!r2.ok) return res.json({ items: [] });
        const d2 = await r2.json();
        return res.json({ items: (d2.value || []).map(i => ({ id: `#${i.id}`, title: i.fields['System.Title'], status: i.fields['System.State'], url: `${base}/${adoProj}/_workitems/edit/${i.id}` })) });
      }

      case 'get_iteration': {
        const team = encodeURIComponent(adoTeam || adoProj);
        const r = await adoFetch(`${base}/${proj}/${team}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=6.0`);
        if (r._html || !r.ok) return res.json({ iteration: null });
        const d = await r.json();
        return res.json({ iteration: d.value?.[0] || null });
      }

      case 'assign_iteration': {
        const { workItemId, iterationPath } = payload;
        const r = await adoFetch(`${base}/${proj}/_apis/wit/workitems/${workItemId}?api-version=6.0`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([{ op: 'add', path: '/fields/System.IterationPath', value: iterationPath }]),
        });
        return res.json({ ok: r.ok });
      }

      case 'link_parent': {
        const { workItemId, parentId } = payload;
        const r = await adoFetch(`${base}/${proj}/_apis/wit/workitems/${workItemId}?api-version=6.0`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([{ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${base}/_apis/wit/workItems/${parentId}` } }]),
        });
        if (!r.ok) return res.status(r.status).json({ error: `ADO ${r.status}` });
        return res.json({ ok: true });
      }

      case 'validate': {
        const r = await adoFetch(`${base}/_apis/projects?api-version=6.0`);
        if (r._html || r.status === 401) return res.json({ valid: false, error: 'Invalid PAT token or expired.' });
        if (!r.ok) return res.json({ valid: false, error: `ADO ${r.status}` });
        const d = await r.json();
        const projCount = d.count || 0;
        return res.json({ valid: true, displayName: `${adoOrg} (${projCount} project${projCount !== 1 ? 's' : ''})` });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return res.status(500).json({ error: `Server error: ${err.message}` });
  }
}
