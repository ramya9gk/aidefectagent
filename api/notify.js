// api/notify.js — Vercel Serverless Function v4.0
// Slack and Teams webhook calls run server-side.
// Webhook URLs read from Vercel env vars — never exposed to browser.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { payload, config } = req.body;

  // Multi-tenant: if an orgCode is supplied, pull the org's webhooks from KV
  // (kept server-side). Otherwise use the browser-entered config.
  let _org = {};
  if (config?.orgCode) {
    const kvUrl = process.env.BUGFORGE_REST_API_KV_REST_API_URL || process.env.KV_REST_API_URL;
    const kvTok = process.env.BUGFORGE_REST_API_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;
    if (kvUrl) {
      try {
        const kr = await fetch(`${kvUrl}/get/org:${config.orgCode}`, { headers: { Authorization: `Bearer ${kvTok}` } });
        const kd = await kr.json();
        if (kd.result) _org = JSON.parse(kd.result);
      } catch(e) { /* fall back to browser config */ }
    }
  }

  const slackUrl = _org.slack || _org.slackWebhook || config?.slack || '';
  const teamsUrl = _org.teamsWebhook || _org.teams || config?.teams || '';

  const results = { slack: null, teams: null };

  if (slackUrl && payload?.slack) {
    try {
      const r = await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.slack),
      });
      results.slack = r.ok ? 'sent' : 'failed';
    } catch { results.slack = 'failed'; }
  } else if (!slackUrl) {
    results.slack = 'not_configured';
  }

  if (teamsUrl && payload?.teams) {
    try {
      const r = await fetch(teamsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.teams),
      });
      if (r.ok) { results.teams = 'sent'; }
      else { const t = await r.text().catch(() => ''); results.teams = 'failed'; results.teamsError = `${r.status} ${t.slice(0,250)}`; }
    } catch(e) { results.teams = 'failed'; results.teamsError = e.message; }
  } else if (!teamsUrl) {
    results.teams = 'not_configured';
  }

  return res.json(results);
}
