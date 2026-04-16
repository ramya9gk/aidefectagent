// api/notify.js — Vercel Serverless Function v4.0
// Slack and Teams webhook calls run server-side.
// Webhook URLs read from Vercel env vars — never exposed to browser.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { payload } = req.body;

  // Read from Vercel env vars — webhook URLs never touch the browser
  const slackUrl = process.env.SLACK_WEBHOOK_URL || '';
  const teamsUrl = process.env.TEAMS_WEBHOOK_URL || '';

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
      results.teams = r.ok ? 'sent' : 'failed';
    } catch { results.teams = 'failed'; }
  } else if (!teamsUrl) {
    results.teams = 'not_configured';
  }

  return res.json(results);
}
