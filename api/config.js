// api/config.js — Read/Write org config from Upstash Redis
// GET  ?org=xxx        → returns org config (public fields only)
// POST { action, ... } → admin operations

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Prefer the active store's vars (BUGFORGE_REST_API_ prefix), fall back to legacy KV_ names
  const KV_URL   = process.env.BUGFORGE_REST_API_KV_REST_API_URL   || process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.BUGFORGE_REST_API_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'Database not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN to Vercel env vars.' });
  }

  // ── KV helpers ─────────────────────────────────────────────
  async function kvGet(key) {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : null;
  }

  async function kvSet(key, value) {
    // Upstash REST: POST /set/{key} stores the request BODY as the value verbatim.
    // Send the stringified object directly (kvGet does JSON.parse on read).
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' },
      body: JSON.stringify(value)
    });
    return r.ok;
  }

  async function kvDel(key) {
    const r = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    return r.ok;
  }

  async function kvKeys(pattern) {
    const r = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    return d.result || [];
  }

  try {
  // ── GET: load org config for app ───────────────────────────
  if (req.method === 'GET') {
    const org = req.query.org;
    if (!org) return res.status(400).json({ error: 'org parameter required' });

    const config = await kvGet(`org:${org}`);
    if (!config) return res.status(404).json({ error: `Organisation "${org}" not found. Check your URL.` });

    // Return safe config — NO tokens exposed to browser
    // Tokens stay in KV, only metadata returned
    return res.json({
      orgName:        config.orgName || org,
      orgCode:        org,
      logo:           config.logo || '',
      jiraUrl:        config.jiraUrl || '',
      jiraProj:       config.jiraProj || '',
      adoOrg:         config.adoOrg || '',
      adoProj:        config.adoProj || '',
      ghOwner:        config.ghOwner || '',
      ghRepo:         config.ghRepo || '',
      hasTeams:       !!config.teamsWebhook,
      plan:           config.plan || 'free',
      createdAt:      config.createdAt || '',
      // Platform status — what's configured vs what's missing
      hasJira:        !!(config.jiraUrl && config.jiraToken),
      hasAdo:         !!(config.adoOrg && config.adoPat),
      hasGitHub:      !!(config.ghOwner && config.ghRepo && config.ghToken),
      // What's partially configured (URL set but no token)
      jiraPartial:    !!(config.jiraUrl && !config.jiraToken),
      adoPartial:     !!(config.adoOrg && !config.adoPat),
      ghPartial:      !!(config.ghOwner && !config.ghToken),
      // What needs setup by client
      needsJira:      !(config.jiraUrl && config.jiraToken),
      needsAdo:       !(config.adoOrg && config.adoPat),
      needsGitHub:    !(config.ghOwner && config.ghRepo && config.ghToken),
    });
  }

  // ── POST: admin + setup operations ─────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body;

    // ── Admin: create org ───────────────────────────────────
    if (action === 'admin_create_org') {
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret || req.body.adminKey !== adminSecret) {
        return res.status(401).json({ error: 'Invalid admin key' });
      }

      const { orgName, orgCode, jiraUrl, jiraEmail, jiraToken, jiraProj,
              adoOrg, adoPat, adoProj, ghOwner, ghRepo, ghToken,
              teamsWebhook, plan } = req.body;

      if (!orgCode || !orgName) return res.status(400).json({ error: 'orgCode and orgName required' });

      // Check if org already exists
      const existing = await kvGet(`org:${orgCode}`);
      if (existing) return res.status(409).json({ error: `Org "${orgCode}" already exists` });

      const orgData = {
        orgName, orgCode,
        jiraUrl:      jiraUrl || '',
        jiraEmail:    jiraEmail || '',
        jiraToken:    jiraToken || '',
        jiraProj:     jiraProj || '',
        adoOrg:       adoOrg || '',
        adoPat:       adoPat || '',
        adoProj:      adoProj || '',
        ghOwner:      ghOwner || '',
        ghRepo:       ghRepo || '',
        ghToken:      ghToken || '',
        teamsWebhook: teamsWebhook || '',
        plan:         plan || 'free',
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
      };

      await kvSet(`org:${orgCode}`, orgData);
      return res.json({
        ok: true,
        orgCode,
        url: `/?org=${orgCode}`,
        setupUrl: `/setup?org=${orgCode}`,
        message: `Org "${orgName}" created successfully`
      });
    }

    // ── Admin: list all orgs ────────────────────────────────
    if (action === 'admin_list_orgs') {
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret || req.body.adminKey !== adminSecret) {
        return res.status(401).json({ error: 'Invalid admin key' });
      }

      const keys = await kvKeys('org:*');
      const orgs = [];
      for (const key of keys) {
        try {
          const org = await kvGet(key);
          const rawCode = key.replace('org:', '');
          // Include ALL entries — corrupt ones too so admin can delete
          orgs.push({
            rawKey:    key,
            orgCode:   org?.orgCode || rawCode || 'unknown',
            orgName:   org?.orgName || org?.name || rawCode || 'Unnamed',
            plan:      org?.plan || 'free',
            createdAt: org?.createdAt || '',
            hasJira:   !!(org?.jiraUrl && org?.jiraToken),
            hasAdo:    !!(org?.adoOrg && org?.adoPat),
            hasGitHub: !!(org?.ghOwner && org?.ghRepo && org?.ghToken),
            isCorrupt: !org || !org.orgCode || org.orgCode === 'undefined',
          });
        } catch(e) {
          // Include unparseable entries so they can be deleted
          orgs.push({
            rawKey:    key,
            orgCode:   key.replace('org:', '') || 'corrupt',
            orgName:   '',
            plan:      'free',
            createdAt: '',
            hasJira:   false,
            hasAdo:    false,
            hasGitHub: false,
            isCorrupt: true,
          });
        }
      }
      return res.json({ orgs });
    }

    // ── Admin: delete org ───────────────────────────────────
    if (action === 'admin_delete_org') {
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret || req.body.adminKey !== adminSecret) {
        return res.status(401).json({ error: 'Invalid admin key' });
      }
      const { orgCode, rawKey } = req.body;

      // Try deleting with rawKey first (most reliable)
      if (rawKey) await kvDel(rawKey);

      // Also try common formats
      await kvDel(`org:${orgCode}`);
      await kvDel(`org:undefined`);
      await kvDel(`org:`);

      // Scan ALL keys and delete any corrupt/invalid entries
      try {
        const allKeys = await kvKeys('org:*');
        for (const key of allKeys) {
          try {
            const data = await kvGet(key);
            // Delete if: no data, no orgCode, orgCode is undefined/empty
            // OR if key matches what we're trying to delete
            const keyOrgCode = key.replace('org:', '');
            if (!data || !data.orgCode || 
                data.orgCode === 'undefined' || 
                data.orgCode === '' ||
                keyOrgCode === orgCode ||
                keyOrgCode === 'undefined' ||
                keyOrgCode === '') {
              await kvDel(key);
              console.log(`Deleted corrupt/matched key: ${key}`);
            }
          } catch(e) {
            await kvDel(key); // delete if can't parse
          }
        }
      } catch(e) {
        console.warn('Scan failed:', e.message);
      }

      return res.json({ ok: true, message: `Org deleted successfully` });
    }

    // ── Admin: update org ───────────────────────────────────
    if (action === 'admin_update_org') {
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret || req.body.adminKey !== adminSecret) {
        return res.status(401).json({ error: 'Invalid admin key' });
      }
      const { orgCode, updates } = req.body;
      const existing = await kvGet(`org:${orgCode}`);
      if (!existing) return res.status(404).json({ error: 'Org not found' });
      const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      // Ensure orgName and orgCode are always set
      if (!updated.orgName) updated.orgName = orgCode;
      if (!updated.orgCode) updated.orgCode = orgCode;
      await kvSet(`org:${orgCode}`, updated);
      return res.json({ ok: true, message: 'Org updated' });
    }

    // Quick fix: repair existing org missing orgName
    if (action === 'admin_repair_org') {
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret || req.body.adminKey !== adminSecret) {
        return res.status(401).json({ error: 'Invalid admin key' });
      }
      const keys = await kvKeys('org:*');
      let fixed = 0;
      for (const key of keys) {
        try {
          const org = await kvGet(key);
          const rawCode = key.replace('org:', '');
          if (org && (!org.orgName || !org.orgCode)) {
            const repaired = {
              ...org,
              orgCode: org.orgCode || rawCode,
              orgName: org.orgName || rawCode,
              updatedAt: new Date().toISOString()
            };
            await kvSet(key, repaired);
            fixed++;
          }
        } catch(e) {}
      }
      return res.json({ ok: true, fixed, message: `Repaired ${fixed} organisations` });
    }

    // ── Client setup: save org credentials ─────────────────
    if (action === 'setup_org') {
      const { orgCode, setupKey, jiraUrl, jiraEmail, jiraToken, jiraProj,
              adoOrg, adoPat, adoProj, ghOwner, ghRepo, ghToken, teamsWebhook } = req.body;

      const existing = await kvGet(`org:${orgCode}`);
      if (!existing) return res.status(404).json({ error: 'Org not found. Contact your admin.' });

      // Verify setup key matches org code (simple auth)
      if (setupKey !== orgCode && setupKey !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: 'Invalid setup key' });
      }

      const updated = {
        ...existing,
        jiraUrl:      jiraUrl      || existing.jiraUrl,
        jiraEmail:    jiraEmail    || existing.jiraEmail,
        jiraToken:    jiraToken    || existing.jiraToken,
        jiraProj:     jiraProj     || existing.jiraProj,
        adoOrg:       adoOrg       || existing.adoOrg,
        adoPat:       adoPat       || existing.adoPat,
        adoProj:      adoProj      || existing.adoProj,
        ghOwner:      ghOwner      || existing.ghOwner,
        ghRepo:       ghRepo       || existing.ghRepo,
        ghToken:      ghToken      || existing.ghToken,
        teamsWebhook: teamsWebhook || existing.teamsWebhook,
        updatedAt:    new Date().toISOString(),
      };

      await kvSet(`org:${orgCode}`, updated);
      return res.json({ ok: true, url: `/?org=${orgCode}`, message: 'Setup complete!' });
    }

    // ── Get full org config (for API calls) ─────────────────
    // Called server-to-server only — returns credentials
    if (action === 'get_org_config') {
      const { orgCode, internalKey } = req.body;
      // Only allow internal calls from other API functions
      if (internalKey !== process.env.ADMIN_SECRET && internalKey !== process.env.ANTHROPIC_API_KEY?.slice(-8)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const config = await kvGet(`org:${orgCode}`);
      if (!config) return res.status(404).json({ error: 'Org not found' });
      return res.json(config);
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  }
  } catch (e) {
    const code = e?.cause?.code || e?.message || 'unknown';
    console.error('[config] KV error:', code);
    return res.status(503).json({ error: `Database unreachable (${code}). Check the KV store is active and KV_REST_API_URL is correct.` });
  }
}
