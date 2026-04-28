/**
 * api/ai.js — Multi-Provider AI Proxy (Node.js serverless)
 * Adapted from Shuddhi QA's production api/claude.js
 *
 * Providers: Claude (ANTHROPIC_API_KEY), Gemini (GEMINI_API_KEY), Groq (GROQ_API_KEY)
 * Active provider: AI_PROVIDER env var | auto-fallback to whichever key exists
 *
 * KEY FEATURE: tool_use translation for Gemini/Groq
 * Bug Forge AI's sendDefect() uses Claude tool_use. For other providers,
 * tools are injected as JSON instructions in the system prompt, and the
 * response is normalised back to Claude's content format.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  const { provider: requestedProvider, ...forwardBody } = body;

  // ── Resolve provider + key ────────────────────────────────────
  function resolveProvider(requested) {
    const preferred = (requested || process.env.AI_PROVIDER || '').toLowerCase();
    const keys = {
      claude: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      groq:   process.env.GROQ_API_KEY,
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
      error: 'No AI provider configured. Add ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY to Vercel Environment Variables.'
    });
  }

  const { provider, key } = resolved;
  const { system, messages, max_tokens = 4096, tools } = forwardBody;

  console.log(`[Bug Forge AI] Provider: ${provider} | tools: ${tools ? tools.length : 0}`);

  // ── Tool_use translation for non-Claude providers ─────────────
  function buildSystemWithTools(baseSystem, toolDefs) {
    if (!toolDefs || !toolDefs.length) return baseSystem;
    const schemas = toolDefs.map(t =>
      `Tool: "${t.name}"\nDescription: ${t.description || ''}\nSchema: ${JSON.stringify(t.input_schema, null, 2)}`
    ).join('\n\n---\n\n');
    return `${baseSystem || ''}

=== TOOL CALL REQUIRED ===
Respond ONLY with this exact JSON (no markdown, no explanation):
{"type":"tool_use","name":"<tool_name>","input":{<fields per schema>}}

Available tools:
${schemas}
=== END ===`;
  }

  try {

    // ── CLAUDE ──────────────────────────────────────────────────
    if (provider === 'claude') {
      const claudeBody = {
        model: forwardBody.model || 'claude-haiku-4-5',
        max_tokens,
        messages,
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
        const msg = d.error?.message || `Claude ${r.status}`;
        const isLimit = r.status === 429
          || (r.status === 400 && (msg.includes('usage limits') || msg.includes('regain access')));
        if (isLimit) return res.status(429).json({ error: `Claude rate limited — ${msg}`, switchProvider: true, provider: 'claude' });
        if (r.status === 401) return res.status(401).json({ error: 'ANTHROPIC_API_KEY invalid or expired', provider: 'claude' });
        return res.status(r.status).json({ error: msg, provider: 'claude' });
      }
      return res.json({ ...d, _provider: 'claude' });
    }

    // ── GEMINI ──────────────────────────────────────────────────
    if (provider === 'gemini') {
      // Model chain — tried in order on any 4xx error.
      // All use v1beta endpoint. Ordered by capability → availability.
      const MODEL_CHAIN = [
        { model: 'gemini-3.0-flash',     apiVer: 'v1beta' },  // PRIMARY — Gemini 3.0 Flash
        { model: 'gemini-2.0-flash',     apiVer: 'v1beta' },  // Fallback
        { model: 'gemini-1.5-flash',     apiVer: 'v1beta' },  // Universal fallback
      ];
      const firstModel = forwardBody.model || MODEL_CHAIN[0].model;

      const contents = (messages || []).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content
                      : Array.isArray(m.content) ? m.content.map(c => c.text||'').join('\n')
                      : JSON.stringify(m.content) }],
      }));

      const systemForGemini = buildSystemWithTools(system, tools);
      const geminiBody = {
        contents,
        generationConfig: { maxOutputTokens: Math.min(max_tokens, 8192), temperature: 0.3 },
      };
      if (systemForGemini) geminiBody.systemInstruction = { parts: [{ text: systemForGemini }] };

      for (let mi = 0; mi < MODEL_CHAIN.length; mi++) {
        const { model: tryModel, apiVer } = mi === 0
          ? { model: firstModel, apiVer: MODEL_CHAIN[0].apiVer }
          : MODEL_CHAIN[mi];
        const url = `https://generativelanguage.googleapis.com/${apiVer}/models/${tryModel}:generateContent?key=${key}`;
        console.log(`[Bug Forge AI] Gemini trying: ${tryModel} (${apiVer})`);
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
        });

        if (r.ok) {
          const d = await r.json();
          const rawText = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const content = tools ? parseToolUseFromText(rawText) : [{ type: 'text', text: rawText }];
          console.log(`[Bug Forge AI] Gemini success: ${tryModel}`);
          return res.json({ content, stop_reason: 'end_turn', _provider: 'gemini', _model: tryModel });
        }

        const errText = await r.text().catch(() => '');
        console.warn(`[Bug Forge AI] Gemini ${tryModel} → HTTP ${r.status}: ${errText.slice(0,120)}`);

        if (r.status === 401 || r.status === 403) {
          return res.status(r.status).json({ error: `GEMINI_API_KEY invalid or missing permission (${r.status})`, provider: 'gemini' });
        }
        if (mi === MODEL_CHAIN.length - 1) {
          return res.status(429).json({
            error: `Gemini: all models failed — ${errText.slice(0,120)}`,
            switchProvider: true,
            provider: 'gemini',
          });
        }
        // Continue to next model in chain
      }
    }

    // ── GROQ ─────────────────────────────────────────────────────
    if (provider === 'groq') {
      const systemForGroq = buildSystemWithTools(system, tools);
      const groqMessages = [];
      if (systemForGroq) groqMessages.push({ role: 'system', content: systemForGroq });
      (messages || []).forEach(m => {
        groqMessages.push({
          role: m.role,
          content: typeof m.content === 'string' ? m.content
                 : Array.isArray(m.content) ? m.content.map(c => c.text||'').join('\n')
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
          model: forwardBody.model || 'llama-3.3-70b-versatile',
          messages: groqMessages,
          max_tokens: Math.min(max_tokens, 4096),
          temperature: 0.3,
        }),
      });

      const d = await r.json();
      if (!r.ok) {
        const msg = d.error?.message || `Groq ${r.status}`;
        if (r.status === 429) return res.status(429).json({ error: `Groq rate limited — ${msg}`, switchProvider: true, provider: 'groq' });
        if (r.status === 401) return res.status(401).json({ error: 'GROQ_API_KEY invalid or expired', provider: 'groq' });
        return res.status(r.status).json({ error: msg, provider: 'groq' });
      }

      const rawText = d.choices?.[0]?.message?.content || '';
      const content = tools ? parseToolUseFromText(rawText) : [{ type: 'text', text: rawText }];
      return res.json({ content, stop_reason: 'stop', _provider: 'groq' });
    }

    return res.status(400).json({ error: `Unknown provider: "${provider}". Valid: claude, gemini, groq` });

  } catch (err) {
    console.error(`[Bug Forge AI] Provider error (${provider}):`, err.message);
    return res.status(500).json({ error: `Proxy error: ${err.message}`, provider });
  }
}

// ── Normalise tool_use JSON from plain-text (Gemini/Groq) ─────────
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
      // Direct ticket fields without wrapper
      if (p.title || p.summary || p.repro_steps || p.description) {
        return [{ type: 'tool_use', id: 'tu_' + Date.now(), name: inferToolName(p), input: p }];
      }
    } catch(e) { /* fall through */ }
  }

  return [{ type: 'text', text }];
}

function inferToolName(obj) {
  if (obj.area_path || obj.iteration_path || obj.system_info) return 'create_azure_devops_bug';
  if (obj.body || (Array.isArray(obj.labels) && obj.labels.join('').includes('bug'))) return 'create_github_issue';
  return 'create_jira_bug';
}
