/**
 * api/status.js — Environment key configuration check
 * Called once on page load. Returns which AI provider keys are
 * configured as Vercel environment variables.
 * Adapted from Shuddhi QA's api/status.js
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const hasClaude = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasGroq   = !!process.env.GROQ_API_KEY;

  const preferred = (process.env.AI_PROVIDER || '').toLowerCase();
  const activeProvider = preferred ||
    (hasClaude ? 'claude' : hasGemini ? 'gemini' : hasGroq ? 'groq' : 'none');

  return res.json({
    claudeKey:   hasClaude,
    geminiKey:   hasGemini,
    groqKey:     hasGroq,
    aiProvider:  activeProvider,
    // Bug Forge AI platform config status
    hasJira:     !!(process.env.JIRA_URL && process.env.JIRA_TOKEN),
    hasAdo:      !!(process.env.ADO_ORG && process.env.ADO_PAT),
    hasGitHub:   !!(process.env.GITHUB_OWNER && process.env.GITHUB_TOKEN),
  });
}
