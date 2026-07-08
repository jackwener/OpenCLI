// attachment-upload.js
// POST /api/attachments/upload — multipart, field name `files` (max 5 per call,
// 50MB each), server-scoped (requires X-Server-Id). Bugen source-verified the
// shape: multer.array("files", 5) / MAX_ATTACHMENT_FILE_SIZE_BYTES = 50*1024*1024 /
// response = { attachments: [AttachmentResponse, ...] } each with the `id` you
// feed to `message-send --attach`.
//
// Binary bridge:
//   - page.evaluate() can't read local files. So we read on the Node side, encode
//     base64, JSON.stringify it into the in-page snippet (`JSON.stringify` is the
//     same anti-injection rule every other command follows here), then in the
//     page rebuild Uint8Array → Blob → File → FormData → fetch the upload
//     endpoint. Auth runs through the shared `authHeadersFragment`.
//   - We strip `content-type` from the inherited headers before FormData fetch
//     because the browser must set the multipart boundary itself.
//
// The 50MB cap is enforced locally before we touch the page: it saves a
// roundtrip on a 200MB blob and gives a clearer error than the server's 413.

import fs from 'node:fs';
import path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { authHeadersFragment, channelResolveFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';

// Bugen source-verified: 50 MiB = 52428800 bytes; multer hard cap = 51 MiB.
// We refuse anything > 50 MiB locally so the user sees a clean error rather
// than a 413 round-trip.
const MAX_BYTES = 50 * 1024 * 1024;

cli({
  site: SLOCK_SITE,
  name: 'attachment-upload',
  access: 'write',
  description: 'Upload a local file to Slock attachments. Prints the attachmentId for use with `message-send --attach`.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'file', positional: true, required: true, help: 'Local file path to upload (single file; max 50 MB)' },
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name — server requires the attachment be scoped to a channel' },
    { name: 'server', help: 'Override active server slug' },
  ],
  columns: ['attachmentId', 'filename', 'mimeType', 'sizeBytes'],
  func: async (page, kwargs) => {
    const filePath = String(kwargs.file ?? '').trim();
    if (!filePath) throw new ArgumentError('file path required');
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required (UUID or #name); server rejects uploads without channelId');
    const abs = path.resolve(filePath);
    let stat;
    try { stat = fs.statSync(abs); }
    catch (e) { throw new ArgumentError(`file not readable: ${abs} (${e.message})`); }
    if (!stat.isFile()) throw new ArgumentError(`not a regular file: ${abs}`);
    if (stat.size === 0) throw new ArgumentError(`file is empty: ${abs}`);
    if (stat.size > MAX_BYTES) {
      throw new ArgumentError(`file is ${stat.size} bytes, exceeds server limit ${MAX_BYTES} (50 MiB). Split or compress before upload.`);
    }

    const buf = fs.readFileSync(abs);
    const filename = path.basename(abs);
    const b64 = buf.toString('base64');

    await page.goto(SLOCK_HOME_URL);

    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      ${channelResolveFragment(channel)}
      // multipart wants the browser to set its own boundary — strip content-type.
      const uploadHeaders = { authorization: headers.authorization, accept: headers.accept };
      if (headers['x-server-id']) uploadHeaders['x-server-id'] = headers['x-server-id'];
      // Rebuild File from base64 → Uint8Array → Blob → File. The base64 string
      // is the only path across the page boundary; JSON.stringify it (caller did)
      // so injection isn't possible.
      const b64 = ${JSON.stringify(b64)};
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const blob = new Blob([u8]);
      const file = new File([blob], ${JSON.stringify(filename)});
      const fd = new FormData();
      fd.append('files', file);
      // qatester live-verified F4: server returns 400 "channelId is required"
      // without this field. Must travel as a multipart text part.
      fd.append('channelId', channelId);
      const res = await fetch('${SLOCK_API_BASE}/attachments/upload', {
        method: 'POST', credentials: 'include', headers: uploadHeaders, body: fd,
      });
      if (res.status === 401) return { kind: 'auth', detail: '/attachments/upload returned 401' };
      if (res.status === 413) {
        const j = await res.json().catch(() => ({}));
        return { kind: 'http', status: 413, where: '/attachments/upload (file too large; maxBytes=' + (j.maxBytes ?? '?') + ')' };
      }
      if (!res.ok) return { kind: 'http', status: res.status, where: '/attachments/upload' };
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data.attachments) ? data.attachments : [];
      if (!list.length) return { kind: 'http', status: 200, where: '/attachments/upload (no attachments in response)' };
      return { kind: 'ok', rows: list };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((a) => ({
      attachmentId: a.id ?? a.attachmentId ?? null,
      filename: a.filename ?? a.name ?? null,
      mimeType: a.mimeType ?? a.contentType ?? null,
      sizeBytes: typeof a.sizeBytes === 'number' ? a.sizeBytes : (a.size ?? null),
    }));
  },
});
