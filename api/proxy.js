// Vercel Serverless Proxy — forwards requests to Jira / ADO / GitHub
// Runs server-side so CORS is never an issue

export default async function handler(req, res) {
  // Allow requests from your Vercel domain only
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Atlassian-Token, Accept');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Security: only allow known API domains
  const allowed = [
    'atlassian.net',
    'dev.azure.com',
    'api.github.com',
    'hooks.slack.com',
    'webhook.office.com'
  ];

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    const hostname = new URL(targetUrl).hostname;
    const isAllowed = allowed.some(domain => hostname.endsWith(domain));
    if (!isAllowed) {
      return res.status(403).json({ error: `Domain not allowed: ${hostname}` });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    // Forward all headers except host
    const forwardHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
        forwardHeaders[key] = value;
      }
    }

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
    };

    // Forward body for POST/PATCH/PUT
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && req.body) {
      fetchOptions.body = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Forward response headers
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    const contentType = response.headers.get('content-type') || '';
    let body;

    if (contentType.includes('application/json')) {
      body = await response.json();
      res.status(response.status).json(body);
    } else if (contentType.includes('text/')) {
      body = await response.text();
      res.status(response.status).send(body);
    } else {
      // Binary (e.g. attachments)
      const buffer = await response.arrayBuffer();
      res.status(response.status).send(Buffer.from(buffer));
    }

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: err.message });
  }
}
