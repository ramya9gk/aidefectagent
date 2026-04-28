/**
 * api/status.js — Environment key configuration check
 * Called once on page load by ProviderManager.init()
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY or CLAUDE_API_KEY → Claude
 *   BUGGEMINI_API_KEY                   → Gemini
 *   BUGGROQ_API_KEY                     → Groq
 *   AI_PROVIDER (optional)              → force a specific provider
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const hasClaude = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  const hasGemini = !!process.env.BUGGEMINI_API_KEY;
  const hasGroq   = !!process.env.BUGGROQ_API_KEY;

  const preferred = (process.env.AI_PROVIDER || '').toLowerCase();
  const activeProvider = preferred ||
    (hasClaude ? 'claude' : hasGemini ? 'gemini' : hasGroq ? 'groq' : 'none');

  console.log(`[Bug Forge AI] Status: claude=${hasClaude} gemini=${hasGemini} groq=${hasGroq} active=${activeProvider}`);

  return res.json({
    claudeKey:   hasClaude,
    geminiKey:   hasGemini,
    groqKey:     hasGroq,
    aiProvider:  activeProvider,
    hasJira:     !!(process.env.JIRA_URL && process.env.JIRA_TOKEN),
    hasAdo:      !!(process.env.ADO_ORG && process.env.ADO_PAT),
    hasGitHub:   !!(process.env.GITHUB_OWNER && process.env.GITHUB_TOKEN),
  });
}
