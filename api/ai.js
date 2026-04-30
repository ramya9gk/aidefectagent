/**
 * api/ai.js — Multi-Provider AI Proxy (Node.js serverless)
 *
 * Providers:
 *   Claude  → ANTHROPIC_API_KEY or CLAUDE_API_KEY
 *   Gemini  → BUGGEMINI_API_KEY
 *   Groq    → BUGGROQ_API_KEY
 *
 * Returns structured errorType so the frontend can show specific messages:
 *   rate_limit  → 429 / Too Many Requests
 *   quota       → free-tier quota exhausted
 *   billing     → account billing issue
 *   auth        → invalid API key
 *   model_error → model not found / unsupported
 *   server      → 5xx
 *   unknown     → anything else
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  const { provider: requestedProvider, ...forwardBody } = body;

  // ── Gemini config: matches user's Google AI Studio account ────
  // This account has Gemini 3.x Preview models ONLY.
  // GA models (gemini-1.5-flash etc.) are NOT available on this account.
  // All preview models use v1beta endpoint — NOT /v1/ (which returns 404 here).
  // Model chain mirrors Shuddhi QA which is confirmed working on same account.
  const GEMINI_MODELS = [
    { model: 'gemini-3.1-pro-preview',        apiVer: 'v1beta' }, // PRIMARY   — Shuddhi QA confirmed
    { model: 'gemini-3.1-flash-lite-preview', apiVer: 'v1beta' }, // FALLBACK  — cost-efficient
    { model: 'gemini-3-flash-preview',        apiVer: 'v1beta' }, // LAST RESORT
  ];

  // ── Detect error type from API response text ───────────────────
  function classifyError(status, msg = '') {
    const m = msg.toLowerCase();
    if (status === 429 || m.includes('too many requests') || m.includes('rate limit'))
      return 'rate_limit';
    if (m.includes('quota') || m.includes('quota_exceeded') || m.includes('resource_exhausted'))
      return 'quota';
    if (m.includes('billing') || m.includes('payment') || m.includes('usage limits') || m.includes('regain access'))
      return 'billing';
    if (status === 401 || status === 403 || m.includes('invalid api key') || m.includes('api_key'))
      return 'auth';
    if (status === 404 || m.includes('not found') || m.includes('does not exist') || m.includes('no longer available'))
      return 'model_error';
    if (status >= 500)
      return 'server';
    return 'unknown';
  }

  // ── Resolve provider + key ─────────────────────────────────────
  function resolveProvider(requested) {
    const preferred = (requested || process.env.AI_PROVIDER || '').toLowerCase();
    const keys = {
      claude: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
      gemini: process.env.BUGGEMINI_API_KEY,
      groq:   process.env.BUGGROQ_API_KEY,
    };
    const order = preferred
      ? [preferred, ...['claude','gemini','groq'].filter(p => p !== preferred)]
      : ['claude','gemini','groq'];
    for (const p of order) {
      if (keys[p]) return { provider: p, key: keys[p] };
    }
    return null;
  }

  const resolved = resolveProvider(requestedProvider);
  if (!resolved) {
    return res.status(500).json({
      error: 'No AI provider configured. Add ANTHROPIC_API_KEY, BUGGEMINI_API_KEY, or BUGGROQ_API_KEY to Vercel Environment Variables.',
      errorType: 'auth',
    });
  }

  const { provider, key } = resolved;
  const { system, messages, max_tokens = 4096, tools } = forwardBody;

  console.log(`[Bug Forge AI] Provider: ${provider}`);

  // ── Tool schema injection for Gemini / Groq ────────────────────
  function buildSystemWithTools(baseSystem, toolDefs) {
    if (!toolDefs || !toolDefs.length) return baseSystem;
    const schemas = toolDefs.map(t =>
      `Tool: "${t.name}"\nDescription: ${t.description || ''}\nInput schema:\n${JSON.stringify(t.input_schema, null, 2)}`
    ).join('\n\n---\n\n');
    return (baseSystem || '') + `

=== TOOL CALL REQUIRED ===
Respond ONLY with this exact JSON — no markdown, no explanation:
{"type":"tool_use","name":"<tool_name>","input":{<fields matching schema>}}

Available tools:
${schemas}
=== END ===`;
  }

  try {

    // ── CLAUDE ────────────────────────────────────────────────────
    if (provider === 'claude') {
      const claudeBody = {
        model:      forwardBody.model || 'claude-haiku-4-5',
        max_tokens, messages,
      };
      if (system) claudeBody.system = system;
      if (tools)  claudeBody.tools  = tools;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(claudeBody),
      });

      const d = await r.json();
      if (!r.ok) {
        const msg      = d.error?.message || `Claude ${r.status}`;
        const errType  = classifyError(r.status, msg);
        const isSwitch = errType === 'rate_limit' || errType === 'quota' || errType === 'billing';
        console.error(`[Bug Forge AI] Claude ${r.status} [${errType}]:`, msg);
        return res.status(isSwitch ? 429 : r.status).json({
          error: msg, errorType: errType, provider: 'claude',
          switchProvider: isSwitch,
        });
      }
      console.log(`[Bug Forge AI] Claude success`);
      return res.json({ ...d, _provider: 'claude' });
    }

    // ── GEMINI ────────────────────────────────────────────────────
    // Uses GEMINI_MODELS chain defined at top of handler.
    // This account has Gemini 3.x preview models ONLY (v1beta endpoint).
    // GA models (gemini-1.5-*) are NOT available on this account.
    if (provider === 'gemini') {
      const contents = (messages || []).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content
                       : Array.isArray(m.content) ? m.content.map(c => c.text || '').join('\n')
                       : JSON.stringify(m.content) }],
      }));

      const sysForGemini = buildSystemWithTools(system, tools);
      const geminiBody = {
        contents,
        generationConfig: { maxOutputTokens: Math.min(max_tokens, 8192), temperature: 0.3 },
      };
      if (sysForGemini) geminiBody.systemInstruction = { parts: [{ text: sysForGemini }] };

      let lastErrMsg = '';

      for (const { model: tryModel, apiVer } of GEMINI_MODELS) {
        const url = `https://generativelanguage.googleapis.com/${apiVer}/models/${tryModel}:generateContent?key=${key}`;
        console.log(`[Bug Forge AI] Gemini trying: ${tryModel} (${apiVer})`);

        let r;
        try {
          r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody),
          });
        } catch (netErr) {
          lastErrMsg = netErr.message;
          console.error(`[Bug Forge AI] Gemini network error (${tryModel}):`, netErr.message);
          continue;
        }

        if (r.ok) {
          const d = await r.json();
          const rawText = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const content = tools ? parseToolUseFromText(rawText) : [{ type: 'text', text: rawText }];
          console.log(`[Bug Forge AI] Gemini success: ${tryModel}`);
          return res.json({ content, stop_reason: 'end_turn', _provider: 'gemini', _model: tryModel });
        }

        const raw = await r.text().catch(() => '');
        let parsed = {}; try { parsed = JSON.parse(raw); } catch(e) {}
        lastErrMsg = parsed?.error?.message || raw.slice(0, 200);
        const errType = classifyError(r.status, lastErrMsg);
        console.error(`[Bug Forge AI] Gemini ${tryModel} HTTP ${r.status} [${errType}]:`, lastErrMsg.slice(0, 150));

        if (r.status === 401 || r.status === 403) {
          return res.status(r.status).json({ error: `BUGGEMINI_API_KEY invalid: ${lastErrMsg}`, provider: 'gemini', errorType: 'auth' });
        }
        if (r.status === 429) {
          return res.status(429).json({ error: `Gemini rate limited: ${lastErrMsg}`, switchProvider: true, provider: 'gemini', errorType: 'rate_limit' });
        }
        // 404 / 400 model unavailable → try next in chain
      }

      return res.status(429).json({
        error: `Gemini unavailable. Last error: ${lastErrMsg}`,
        switchProvider: true, provider: 'gemini', errorType: 'model_error',
      });
    }

    // ── GROQ ──────────────────────────────────────────────────────
    if (provider === 'groq') {
      const sysForGroq = buildSystemWithTools(system, tools);
      const groqMessages = [];
      if (sysForGroq) groqMessages.push({ role: 'system', content: sysForGroq });
      (messages || []).forEach(m => {
        groqMessages.push({
          role: m.role,
          content: typeof m.content === 'string' ? m.content
                 : Array.isArray(m.content) ? m.content.map(c => c.text || '').join('\n')
                 : JSON.stringify(m.content),
        });
      });

      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model:       forwardBody.model || 'llama-3.3-70b-versatile',
          messages:    groqMessages,
          max_tokens:  Math.min(max_tokens, 4096),
          temperature: 0.3,
        }),
      });

      const d = await r.json();
      if (!r.ok) {
        const msg      = d.error?.message || `Groq ${r.status}`;
        const errType  = classifyError(r.status, msg);
        const isSwitch = errType === 'rate_limit' || errType === 'quota' || errType === 'billing';
        console.error(`[Bug Forge AI] Groq ${r.status} [${errType}]:`, msg);
        return res.status(isSwitch ? 429 : r.status).json({
          error: msg, errorType: errType, provider: 'groq',
          switchProvider: isSwitch,
        });
      }

      const rawText = d.choices?.[0]?.message?.content || '';
      const content = tools ? parseToolUseFromText(rawText) : [{ type: 'text', text: rawText }];
      console.log(`[Bug Forge AI] Groq success`);
      return res.json({ content, stop_reason: 'stop', _provider: 'groq' });
    }

    return res.status(400).json({ error: `Unknown provider: "${provider}"`, errorType: 'unknown' });

  } catch (err) {
    console.error(`[Bug Forge AI] Unexpected error (${provider}):`, err.message);
    return res.status(500).json({ error: `Server error: ${err.message}`, errorType: 'server', provider });
  }
}

// ── Parse tool_use JSON from Gemini/Groq plain-text response ──────
function parseToolUseFromText(text) {
  if (!text) return [{ type: 'text', text: '' }];
  const cleaned = text.replace(/^```json\s*/im,'').replace(/^```\s*/im,'').replace(/\s*```$/m,'').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const p = JSON.parse(m[0]);
      if (p.type === 'tool_use' && p.name && p.input)
        return [{ type:'tool_use', id:'tu_'+Date.now(), name:p.name, input:p.input }];
      if (p.name && p.input)
        return [{ type:'tool_use', id:'tu_'+Date.now(), name:p.name, input:p.input }];
      if (p.title || p.summary || p.repro_steps || p.description)
        return [{ type:'tool_use', id:'tu_'+Date.now(), name:inferToolName(p), input:p }];
    } catch(e) {}
  }
  return [{ type:'text', text }];
}
function inferToolName(obj) {
  if (obj.area_path || obj.iteration_path || obj.system_info) return 'create_azure_devops_bug';
  if (obj.body || (Array.isArray(obj.labels) && obj.labels.join('').includes('bug'))) return 'create_github_issue';
  return 'create_jira_bug';
}
