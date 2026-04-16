// api/notify.js — Vercel Serverless Function
// Slack and Teams webhook calls run server-side.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slackUrl, teamsUrl, payload } = req.body;

  const results = { slack: null, teams: null };

  if (slackUrl) {
    try {
      await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.slack),
      });
      results.slack = 'sent';
    } catch (e) {
      results.slack = 'failed';
    }
  }

  if (teamsUrl) {
    try {
      await fetch(teamsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.teams),
      });
      results.teams = 'sent';
    } catch (e) {
      results.teams = 'failed';
    }
  }

  return res.json(results);
}
