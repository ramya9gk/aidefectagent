// api/ado.js — Vercel Serverless Function
// All Azure DevOps API calls run server-side. Zero CORS.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, config, payload } = req.body;

  // Multi-tenant: load from KV if orgCode provided
  let _orgA = {};
  if (config?.orgCode && process.env.KV_REST_API_URL) {
    try {
      const _r = await fetch(`${process.env.KV_REST_API_URL}/get/org:${config.orgCode}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const _d = await _r.json();
      if (_d.result) _orgA = JSON.parse(_d.result);
    } catch(e) {}
  }
  // Credentials come from the UI config (browser-entered). Optional multi-tenant
  // KV (_orgA, only when ?org= is used) takes precedence. Vercel env vars are NOT read.
  const adoOrg  = _orgA.adoOrg  || config?.adoOrg  || '';
  const adoProj = _orgA.adoProj || config?.adoProj || '';
  const adoPat  = _orgA.adoPat  || config?.adoPat  || '';
  const adoTeam     = config?.adoTeam     || '';
  const adoAssignee = config?.adoAssignee || '';

  if (!adoOrg)  return res.status(400).json({ error: 'Azure DevOps organisation not set. Enter it in Settings → Platforms → ADO.' });
  if (!adoPat)  return res.status(400).json({ error: 'Azure DevOps PAT not set. Enter it in Settings → Platforms → ADO.' });
  if (!adoProj) return res.status(400).json({ error: 'Azure DevOps project not set. Select a project in Settings → Platforms → ADO.' });

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
        // Sanitize payload — fix Priority, Severity, and ReproSteps
        const priMap = {'P0':1,'P1':1,'P2':2,'P3':3,'P4':4,'Critical':1,'High':1,'Medium':2,'Low':3};
        const sevMap = {'Critical':'1 - Critical','High':'2 - High','Medium':'3 - Medium','Low':'4 - Low',
                        '1 - Critical':'1 - Critical','2 - High':'2 - High','3 - Medium':'3 - Medium','4 - Low':'4 - Low'};
        const sanitizedPayload = (payload||[]).map(op => {
          if (op.path === '/fields/Microsoft.VSTS.Common.Priority') {
            const n = priMap[op.value] || parseInt(op.value) || 2;
            return { ...op, value: [1,2,3,4].includes(n) ? n : 2 };
          }
          if (op.path === '/fields/Microsoft.VSTS.Common.Severity') {
            return { ...op, value: sevMap[op.value] || '3 - Medium' };
          }
          // If ReproSteps arrived as a plain string, wrap each line in <li>
          if (op.path === '/fields/Microsoft.VSTS.TCM.ReproSteps') {
            let val = op.value || '';
            if (typeof val === 'string' && !val.startsWith('<')) {
              // Plain text — convert newline-separated steps into HTML list
              const items = val
                .split('\n')
                .map(s => s.replace(/^\s*\d+[\.\)]\s*/, '').trim())
                .filter(s => s.length > 0)
                .map((s,i) => `<li>${i+1}. ${s}</li>`)
                .join('');
              val = items ? `<ol>${items}</ol>` : '';
            }
            return { ...op, value: val };
          }
          if (op.path === '/fields/System.AssignedTo') {
            const assigneeVal = adoAssignee || op.value || '';
            return assigneeVal ? { ...op, value: assigneeVal } : null;
          }
          return op;
        }).filter(op => {
          if (!op) return false;
          if (op.path === '/fields/System.Title') return true;
          if (op.value === undefined || op.value === null) return false;
          const s = String(op.value).trim();
          return s !== '' && s !== '<ol></ol>';
        });

        // Add assignee from env var if not already in payload
        if (adoAssignee && !sanitizedPayload.find(op => op.path === '/fields/System.AssignedTo')) {
          sanitizedPayload.push({ op: 'add', path: '/fields/System.AssignedTo', value: adoAssignee });
        }

        const r = await adoFetch(`${base}/${proj}/_apis/wit/workitems/$Bug?api-version=6.0`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json-patch+json', Accept: 'application/json' },
          body: JSON.stringify(sanitizedPayload),
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
        const { wiql, maxResults=8 } = payload;
        const r = await adoFetch(`${base}/${proj}/_apis/wit/wiql?api-version=6.0&$top=${maxResults}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: wiql }),
        });
        if (r._html || !r.ok) return res.json({ items: [] });
        const d = await r.json();
        const ids = (d.workItems || []).slice(0, maxResults).map(w => w.id);
        if (!ids.length) return res.json({ items: [] });
        const r2 = await adoFetch(`${base}/${proj}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.State&api-version=6.0`);
        if (!r2.ok) return res.json({ items: [] });
        const d2 = await r2.json();
        return res.json({ items: (d2.value || []).map(i => ({ id: `#${i.id}`, title: i.fields['System.Title'], status: i.fields['System.State'], url: `${base}/${adoProj}/_workitems/edit/${i.id}` })) });
      }

      case 'link_duplicate': {
        // Add a "Duplicate" relation from the new work item to the existing one
        const { workItemId, duplicateOfId } = payload;
        const newWid = String(workItemId).replace('#','');
        const existWid = String(duplicateOfId).replace('#','');
        // Get the URL of the existing work item first
        const existR = await adoFetch(`${base}/${proj}/_apis/wit/workitems/${existWid}?api-version=6.0`);
        if (!existR.ok) return res.json({ ok: false, error: `Could not find work item #${existWid}` });
        const existData = await existR.json();
        const existUrl = existData.url;
        // Add "Duplicate" relation (System.LinkTypes.Duplicate-Forward)
        const patchR = await adoFetch(`${base}/${proj}/_apis/wit/workitems/${newWid}?api-version=6.0`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([{
            op: 'add', path: '/relations/-',
            value: {
              rel: 'System.LinkTypes.Duplicate-Forward',
              url: existUrl,
              attributes: { comment: `Duplicate of #${existWid} — linked by Bug Forge AI` }
            }
          }])
        });
        if (!patchR.ok) {
          const e = await patchR.text();
          return res.json({ ok: false, error: `ADO link ${patchR.status}: ${e.slice(0,150)}` });
        }
        return res.json({ ok: true });
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
