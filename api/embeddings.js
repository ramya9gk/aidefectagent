/**
 * api/embeddings.js — Semantic similarity via Gemini text-embedding-004
 *
 * POST /api/embeddings
 * Body: { text: string }           → returns { embedding: number[] }
 * Body: { texts: string[] }        → returns { embeddings: number[][] }
 * Body: { text, candidates: [{id, title, description}] }
 *       → computes cosine similarity, returns ranked matches
 *
 * Uses BUGGEMINI_API_KEY. Falls back gracefully if not configured.
 * Model: text-embedding-004 (768 dimensions, GA, free tier 1500/day)
 */

const EMBED_MODEL = 'text-embedding-004';
const EMBED_URL = `https://generativelanguage.googleapis.com/v1/models/${EMBED_MODEL}:embedContent`;
const BATCH_URL = `https://generativelanguage.googleapis.com/v1/models/${EMBED_MODEL}:batchEmbedContents`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Gemini key comes from the UI (browser-stored) — never from Vercel env.
  const { text, texts, candidates, geminiKey } = req.body || {};
  const key = geminiKey;
  if (!key) {
    // No key entered — caller falls back to keyword + AI scoring only.
    return res.status(200).json({ error: 'Gemini API key not provided', fallback: true });
  }

  try {

    // ── Single text → embedding ──────────────────────────────
    if (text && !candidates) {
      const emb = await embedSingle(text, key);
      return res.json({ embedding: emb });
    }

    // ── Multiple texts → embeddings ──────────────────────────
    if (texts && Array.isArray(texts) && !candidates) {
      const embs = await embedBatch(texts, key);
      return res.json({ embeddings: embs });
    }

    // ── Semantic similarity: new bug vs candidates ───────────
    // This is the main use case: rank existing tickets by semantic closeness
    if (text && candidates && Array.isArray(candidates)) {
      const queryText = text.slice(0, 2000); // cap for embedding
      const candidateTexts = candidates.map(c =>
        `${c.title || ''} ${c.description || ''}`.slice(0, 1000)
      );

      // Embed query + all candidates in one batch call
      const allTexts = [queryText, ...candidateTexts];
      const allEmbeddings = await embedBatch(allTexts, key);

      const queryEmb = allEmbeddings[0];
      const ranked = candidates.map((c, i) => {
        const score = cosineSimilarity(queryEmb, allEmbeddings[i + 1]);
        return { ...c, semanticScore: Math.round(score * 100) };
      }).sort((a, b) => b.semanticScore - a.semanticScore);

      return res.json({ ranked, model: EMBED_MODEL });
    }

    return res.status(400).json({ error: 'Provide text, texts[], or text+candidates[]' });

  } catch (err) {
    console.error('[Embeddings] Error:', err.message);
    // Return graceful fallback so caller can continue without embeddings
    return res.status(200).json({ error: err.message, fallback: true });
  }
}

// ── Embed a single text ─────────────────────────────────────
async function embedSingle(text, key) {
  const r = await fetch(`${EMBED_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: 'SEMANTIC_SIMILARITY',
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Gemini embed ${r.status}: ${err.slice(0, 200)}`);
  }
  const d = await r.json();
  return d.embedding?.values || [];
}

// ── Embed multiple texts in one batch request ───────────────
async function embedBatch(texts, key) {
  const r = await fetch(`${BATCH_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      requests: texts.map(text => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType: 'SEMANTIC_SIMILARITY',
      })),
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Gemini batch embed ${r.status}: ${err.slice(0, 200)}`);
  }
  const d = await r.json();
  return (d.embeddings || []).map(e => e.values || []);
}

// ── Cosine similarity between two vectors ───────────────────
function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : Math.max(0, Math.min(1, dot / denom));
}
