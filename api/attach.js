// api/attach.js — Server-side screenshot attachment
// Handles attaching screenshots to Jira, ADO, GitHub tickets

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, fileName, fileBase64, mimeType, ticketId, rawId, config } = req.body;
  // Credentials come from the UI config (browser-entered) — not from Vercel env.
  const jiraUrl   = config?.jiraUrl   || '';
  const jiraEmail = config?.jiraEmail || '';
  const jiraToken = config?.jiraToken || '';
  const adoOrg    = config?.adoOrg    || '';
  const adoProj   = config?.adoProj   || '';
  const adoPat    = config?.adoPat    || '';
  const ghOwner   = config?.ghOwner   || '';
  const ghRepo    = config?.ghRepo    || '';
  const ghToken   = config?.ghToken   || '';

  if (!fileBase64) return res.status(400).json({ error: 'No file data provided' });

  // Convert base64 to Buffer
  const fileBuffer = Buffer.from(fileBase64, 'base64');

  try {
    // ── JIRA attachment ─────────────────────────────────────────
    if (platform === 'jira') {
      if (!jiraUrl || !jiraEmail || !jiraToken) return res.json({ ok: false, error: 'Jira credentials missing' });

      const auth = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
      const base = jiraUrl.replace(/\/$/, '');

      // Use FormData for multipart upload
      const { FormData, Blob } = await import('node:buffer').catch(() => ({ FormData: null, Blob: null }));

      // Build multipart body manually for Node.js
      const boundary = `----FormBoundary${Date.now()}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
        fileBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);

      const r = await fetch(`${base}/rest/api/2/issue/${ticketId}/attachments`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'X-Atlassian-Token': 'no-check',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        body,
      });

      if (!r.ok) {
        const e = await r.text();
        return res.json({ ok: false, error: `Jira attach ${r.status}: ${e.slice(0, 100)}` });
      }
      return res.json({ ok: true });
    }

    // ── ADO attachment ─────────────────────────────────────────
    if (platform === 'azure_devops') {
      if (!adoOrg || !adoPat) return res.json({ ok: false, error: 'ADO credentials missing' });

      const auth = 'Basic ' + Buffer.from(`:${adoPat}`).toString('base64');
      const proj = encodeURIComponent(adoProj || '');
      const base = `https://dev.azure.com/${adoOrg}`;

      // ── link_only: file already uploaded, just link the existing URL to the work item ──
      if (req.body.action === 'link_only') {
        const existingUrl = req.body.attachUrl;
        if (!existingUrl) return res.json({ ok: false, error: 'attachUrl required for link_only' });
        const wid = rawId || String(ticketId).replace('#', '');
        const r = await fetch(
          `${base}/${proj}/_apis/wit/workitems/${wid}?api-version=6.0`,
          {
            method: 'PATCH',
            headers: { Authorization: auth, 'Content-Type': 'application/json-patch+json' },
            body: JSON.stringify([{
              op: 'add', path: '/relations/-',
              value: { rel: 'AttachedFile', url: existingUrl,
                       attributes: { comment: 'Screenshot attached by Bug Forge AI' } }
            }]),
          }
        );
        if (!r.ok) { const e = await r.text(); return res.json({ ok: false, error: `ADO link ${r.status}: ${e.slice(0,100)}` }); }
        return res.json({ ok: true, url: existingUrl });
      }

      // Step 1: Upload attachment binary
      const uploadR = await fetch(
        `${base}/${proj}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=6.0`,
        {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': mimeType, 'Content-Length': fileBuffer.length },
          body: fileBuffer,
        }
      );

      if (!uploadR.ok) {
        const e = await uploadR.text();
        return res.json({ ok: false, error: `ADO upload ${uploadR.status}: ${e.slice(0, 100)}` });
      }

      const uploadData = await uploadR.json();
      const attachUrl = uploadData.url;

      // If upload_only: return the URL so caller can embed it in ReproSteps HTML
      // The caller will link the attachment after the ticket is created
      if (req.body.action === 'upload_only') {
        return res.json({ ok: true, url: attachUrl });
      }

      const linkUrl = attachUrl;

      // Step 2: Link attachment to work item
      const wid = rawId || String(ticketId).replace('#', '');
      const patchR = await fetch(
        `${base}/${proj}/_apis/wit/workitems/${wid}?api-version=6.0`,
        {
          method: 'PATCH',
          headers: { Authorization: auth, 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([{
            op: 'add',
            path: '/relations/-',
            value: {
              rel: 'AttachedFile',
              url: linkUrl,
              attributes: { comment: 'Screenshot attached by Bug Forge AI' }
            }
          }]),
        }
      );

      if (!patchR.ok) {
        const e = await patchR.text();
        return res.json({ ok: false, error: `ADO link ${patchR.status}: ${e.slice(0, 100)}` });
      }
      return res.json({ ok: true, url: attachUrl });
    }

    // ── GitHub attachment ─────────────────────────────────────
    // GitHub Issues don't support direct API attachment — return info
    if (platform === 'github') {
      return res.json({ ok: false, error: 'GitHub Issues API does not support direct attachments. Upload manually.' });
    }

    return res.json({ ok: false, error: `Unknown platform: ${platform}` });

  } catch (err) {
    console.error('Attach error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
