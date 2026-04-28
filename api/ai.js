/**
 * api/ai.js — Multi-Provider AI Proxy (Node.js serverless)
 *
 * Providers:
 *   Claude  → ANTHROPIC_API_KEY or CLAUDE_API_KEY
 *   Gemini  → BUGGEMINI_API_KEY
 *   Groq    → BUGGROQ_API_KEY
 *
 * Active provider: AI_PROVIDER env var | fallback to whichever key exists
 * Single call per provider — no retry loops, no fallback chains.
 *
 * tool_use translation: Gemini/Groq receive tools as JSON system prompt.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  const { provider: requestedProvider, ...forwardBody } = body;

  // ── Single source of truth: Gemini config ─────────────────────
  // Model: gemini-1.5-flash (GA stable)
  // Endpoint: /v1/ (NOT v1beta — v1beta causes 404 for GA models)
  const GEMINI_CONFIG = {
    model:   'gemini-1.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1',
  };

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
    });
  }

  const { provider, key } = resolved;
  const { system, messages, max_tokens = 4096, tools } = forwardBody;

  console.log(`[Bug Forge AI] Provider: ${provider}`);
  if (provider === 'gemini') {
    console.log(`[Bug Forge AI] Gemini model: ${GEMINI_CONFIG.model}`);
    console.log(`[Bug Forge AI] Gemini endpoint: ${GEMINI_CONFIG.baseUrl}/models/${GEMINI_CONFIG.model}`);
  }

  // ── Tool_use translation for non-Claude providers ──────────────
  // Bug Forge AI sendDefect() uses Claude tool_use format.
  // For Gemini/Groq the tool schemas are injected as a JSON system
  // prompt instruction so the model returns structured JSON we can parse.
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
        max_tokens,
        messages,
      };
      if (system) claudeBody.system = system;
      if (tools)  claudeBody.tools  = tools;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(claudeBody),
      });

      const d = await r.json();
      if (!r.ok) {
        const msg = d.error?.message || `Claude ${r.status}`;
        const isLimit = r.status === 429
          || (r.status === 400 && (msg.includes('usage limits') || msg.includes('regain access')));
        if (isLimit) return res.status(429).json({ error: `Claude rate limited — ${msg}`, switchProvider: true, provider: 'claude' });
        if (r.status === 401) return res.status(401).json({ error: 'ANTHROPIC_API_KEY invalid or expired.', provider: 'claude' });
        return res.status(r.status).json({ error: msg, provider: 'claude' });
      }
      console.log(`[Bug Forge AI] Claude success`);
      return res.json({ ...d, _provider: 'claude' });
    }

    // ── GEMINI ────────────────────────────────────────────────────
    // Single call — no retry loop, no fallback chain.
    // Model: gemini-1.5-flash | Endpoint: /v1/ (GA stable, not v1beta)
    if (provider === 'gemini') {
      const url = `${GEMINI_CONFIG.baseUrl}/models/${GEMINI_CONFIG.model}:generateContent?key=${key}`;

      const contents = (messages || []).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content
                       : Array.isArray(m.content) ? m.content.map(c => c.text || '').join('\n')
                       : JSON.stringify(m.content) }],
      }));

      const systemForGemini = buildSystemWithTools(system, tools);
      const geminiBody = {
        contents,
        generationConfig: { maxOutputTokens: Math.min(max_tokens, 8192), temperature: 0.3 },
      };
      if (systemForGemini) geminiBody.systemInstruction = { parts: [{ text: systemForGemini }] };

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });

      if (!r.ok) {
        const rawBody = await r.text().catch(() => '');
        let parsed = {};
        try { parsed = JSON.parse(rawBody); } catch(e) {}
        const errMsg = parsed?.error?.message || rawBody.slice(0, 200);
        console.error(`[Bug Forge AI] Gemini HTTP ${r.status}:`, errMsg);

        if (r.status === 401 || r.status === 403) {
          return res.status(r.status).json({ error: `BUGGEMINI_API_KEY invalid or missing permission: ${errMsg}`, provider: 'gemini' });
        }
        if (r.status === 429) {
          return res.status(429).json({ error: `Gemini rate limited. Please wait before retrying.`, switchProvider: true, provider: 'gemini' });
        }
        // 400/404 — surface clean message, signal provider switch
        return res.status(429).json({ error: `Gemini error (${r.status}): ${errMsg}`, switchProvider: true, provider: 'gemini' });
      }

      const d = await r.json();
      const rawText = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const content = tools ? parseToolUseFromText(rawText) : [{ type: 'text', text: rawText }];
      console.log(`[Bug Forge AI] Gemini success: ${GEMINI_CONFIG.model}`);
      return res.json({ content, stop_reason: 'end_turn', _provider: 'gemini', _model: GEMINI_CONFIG.model });
    }

    // ── GROQ ──────────────────────────────────────────────────────
    if (provider === 'groq') {
      const systemForGroq = buildSystemWithTools(system, tools);
      const groqMessages = [];
      if (systemForGroq) groqMessages.push({ role: 'system', content: systemForGroq });
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
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model:      forwardBody.model || 'llama-3.3-70b-versatile',
          messages:   groqMessages,
          max_tokens: Math.min(max_tokens, 4096),
          temperature: 0.3,
        }),
      });

      const d = await r.json();
      if (!r.ok) {
        const msg = d.error?.message || `Groq ${r.status}`;
        if (r.status === 429) return res.status(429).json({ error: `Groq rate limited. Please wait before retrying.`, switchProvider: true, provider: 'groq' });
        if (r.status === 401) return res.status(401).json({ error: 'BUGGROQ_API_KEY invalid or expired.', provider: 'groq' });
        return res.status(r.status).json({ error: msg, provider: 'groq' });
      }

      const rawText = d.choices?.[0]?.message?.content || '';
      const content = tools ? parseToolUseFromText(rawText) : [{ type: 'text', text: rawText }];
      console.log(`[Bug Forge AI] Groq success`);
      return res.json({ content, stop_reason: 'stop', _provider: 'groq' });
    }

    return res.status(400).json({ error: `Unknown provider: "${provider}". Valid: claude, gemini, groq` });

  } catch (err) {
    console.error(`[Bug Forge AI] Unexpected error (${provider}):`, err.message);
    return res.status(500).json({ error: `Server error: ${err.message}`, provider });
  }
}

// ── Parse tool_use JSON from plain-text response (Gemini / Groq) ──
function parseToolUseFromText(text) {
  if (!text) return [{ type: 'text', text: '' }];

  const cleaned = text
    .replace(/^```json\s*/im, '').replace(/^```\s*/im, '').replace(/\s*```$/m, '').trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const p = JSON.parse(jsonMatch[0]);
      if (p.type === 'tool_use' && p.name && p.input) {
        return [{ type: 'tool_use', id: 'tu_' + Date.now(), name: p.name, input: p.input }];
      }
      if (p.name && p.input) {
        return [{ type: 'tool_use', id: 'tu_' + Date.now(), name: p.name, input: p.input }];
      }
      if (p.title || p.summary || p.repro_steps || p.description) {
        return [{ type: 'tool_use', id: 'tu_' + Date.now(), name: inferToolName(p), input: p }];
      }
    } catch(e) { /* fall through to text */ }
  }

  return [{ type: 'text', text }];
}

function inferToolName(obj) {
  if (obj.area_path || obj.iteration_path || obj.system_info) return 'create_azure_devops_bug';
  if (obj.body || (Array.isArray(obj.labels) && obj.labels.join('').includes('bug'))) return 'create_github_issue';
  return 'create_jira_bug';
}
