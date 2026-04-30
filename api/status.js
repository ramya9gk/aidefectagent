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

  const preferred      = (process.env.AI_PROVIDER || '').toLowerCase();
  const activeProvider = preferred ||
    (hasClaude ? 'claude' : hasGemini ? 'gemini' : hasGroq ? 'groq' : 'none');

  // Diagnostic: show exactly which env var names were checked (not values)
  // Helps confirm spelling and scope in Vercel dashboard
  const checkedVars = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    CLAUDE_API_KEY:    !!process.env.CLAUDE_API_KEY,
    BUGGEMINI_API_KEY: !!process.env.BUGGEMINI_API_KEY,
    BUGGROQ_API_KEY:   !!process.env.BUGGROQ_API_KEY,
    AI_PROVIDER:       process.env.AI_PROVIDER || '(not set)',
  };

  console.log('[Bug Forge AI] Status check:');
  console.log('  claude :', hasClaude, '| gemini:', hasGemini, '| groq:', hasGroq);
  console.log('  active :', activeProvider);
  console.log('  vars   :', JSON.stringify(checkedVars));

  return res.json({
    claudeKey:   hasClaude,
    geminiKey:   hasGemini,
    groqKey:     hasGroq,
    aiProvider:  activeProvider,
    // Diagnostic fields — visible in browser Network tab response
    _checkedVars: checkedVars,
    _hint: (!hasGemini && !hasGroq)
      ? 'BUGGEMINI_API_KEY and BUGGROQ_API_KEY not found. Add them in Vercel → Settings → Environment Variables, then Redeploy.'
      : 'OK',
    hasJira:     !!(process.env.JIRA_URL && process.env.JIRA_TOKEN),
    hasAdo:      !!(process.env.ADO_ORG && process.env.ADO_PAT),
    hasGitHub:   !!(process.env.GITHUB_OWNER && process.env.GITHUB_TOKEN),
  });
}
