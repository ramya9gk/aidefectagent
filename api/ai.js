// api/ai.js — Unified AI provider proxy
// Supports: Claude (Anthropic), Gemini (Google), Groq
// Single source of truth for all AI calls in BugForgeAI.
// /api/claude is kept intact for backward compat — this is the canonical handler.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    provider = 'claude',   // 'claude' | 'gemini' | 'groq'
    model,                 // overrides default model for the provider
    max_tokens = 1000,
    messages,              // OpenAI-style [{ role, content }]
    system,                // system prompt (Claude-style; mapped to first message for others)
    tools,                 // tool-use array (Claude only)
  } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  console.log(`[Bug Forge AI] Active provider: ${provider}`);

  try {
    // ── CLAUDE (Anthropic) ────────────────────────────────────
    if (provider === 'claude') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({
        error: 'ANTHROPIC_API_KEY not set. Add it in Vercel → Settings → Environment Variables.',
        provider: 'claude'
      });

      const body = {
        model: model || 'claude-haiku-4-5',
        max_tokens,
        messages,
      };
      if (system) body.system = system;
      if (tools)  body.tools  = tools;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const d = await r.json();
      if (!r.ok) {
        const msg = d.error?.message || `Anthropic ${r.status}`;
        if (r.status === 429) return res.status(429).json({ error: `Claude rate limit — ${msg}`, provider: 'claude' });
        if (r.status === 404) return res.status(404).json({ error: `Claude model not found: ${body.model}`, provider: 'claude' });
        return res.status(r.status).json({ error: msg, provider: 'claude' });
      }

      // Return Claude-native format (content array) — same shape callers already expect
      return res.json({ ...d, _provider: 'claude' });
    }

    // ── GEMINI (Google) ───────────────────────────────────────
    if (provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({
        error: 'GEMINI_API_KEY not set. Add it in Vercel → Settings → Environment Variables.',
        provider: 'gemini'
      });

      const geminiModel = model || 'gemini-2.0-flash';

      // Map OpenAI-style messages + system to Gemini format
      const contents = [];
      // Prepend system as a user message if present
      if (system) {
        contents.push({ role: 'user', parts: [{ text: `System context: ${system}` }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
      }
      for (const m of messages) {
        const role = m.role === 'assistant' ? 'model' : 'user';
        const text = typeof m.content === 'string' ? m.content
          : Array.isArray(m.content) ? m.content.map(c => c.text || '').join('\n')
          : String(m.content);
        contents.push({ role, parts: [{ text }] });
      }

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: { maxOutputTokens: max_tokens, temperature: 0.3 },
          }),
        }
      );

      const d = await r.json();
      if (!r.ok) {
        const msg = d.error?.message || `Gemini ${r.status}`;
        if (r.status === 429) return res.status(429).json({ error: `Gemini rate limit — ${msg}`, provider: 'gemini' });
        if (r.status === 404) return res.status(404).json({ error: `Gemini model not found: ${geminiModel}`, provider: 'gemini' });
        return res.status(r.status).json({ error: msg, provider: 'gemini' });
      }

      // Normalise to Claude-style content array so callers need zero changes
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.json({
        content: [{ type: 'text', text }],
        _provider: 'gemini',
        _raw: d,
      });
    }

    // ── GROQ ─────────────────────────────────────────────────
    if (provider === 'groq') {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) return res.status(500).json({
        error: 'GROQ_API_KEY not set. Add it in Vercel → Settings → Environment Variables.',
        provider: 'groq'
      });

      const groqModel = model || 'llama-3.3-70b-versatile';

      // Build OpenAI-compatible messages (Groq uses OpenAI API format)
      const groqMessages = [];
      if (system) groqMessages.push({ role: 'system', content: system });
      groqMessages.push(...messages);

      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: groqModel,
          messages: groqMessages,
          max_tokens,
          temperature: 0.3,
        }),
      });

      const d = await r.json();
      if (!r.ok) {
        const msg = d.error?.message || `Groq ${r.status}`;
        if (r.status === 429) return res.status(429).json({ error: `Groq rate limit — ${msg}`, provider: 'groq' });
        if (r.status === 404) return res.status(404).json({ error: `Groq model not found: ${groqModel}`, provider: 'groq' });
        return res.status(r.status).json({ error: msg, provider: 'groq' });
      }

      // Normalise to Claude-style content array
      const text = d.choices?.[0]?.message?.content || '';
      return res.json({
        content: [{ type: 'text', text }],
        _provider: 'groq',
        _raw: d,
      });
    }

    return res.status(400).json({ error: `Unknown provider: "${provider}". Valid: claude, gemini, groq` });

  } catch (err) {
    console.error(`[Bug Forge AI] AI provider error (${provider}):`, err);
    return res.status(500).json({ error: err.message, provider });
  }
}
