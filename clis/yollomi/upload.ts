/**
 * Yollomi image upload — POST /api/upload (FormData)
 *
 * Uploads a local file to Yollomi's R2 storage and returns the URL.
 * The URL can then be used as input for image-to-image, face-swap, etc.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { YOLLOMI_DOMAIN, ensureOnYollomi, fmtBytes } from './utils.js';

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};

cli({
  site: 'yollomi',
  name: 'upload',
  description: 'Upload an image or video to Yollomi (returns URL for other commands)',
  domain: YOLLOMI_DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'file', positional: true, required: true, help: 'Local file path to upload' },
  ],
  columns: ['status', 'file', 'size', 'url'],
  func: async (page, kwargs) => {
    const filePath = path.resolve(kwargs.file as string);
    if (!fs.existsSync(filePath)) throw new CliError('FILE_NOT_FOUND', `File not found: ${filePath}`, 'Provide a valid file path');

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_MAP[ext];
    if (!mime) throw new CliError('INVALID_TYPE', `Unsupported file type: ${ext}`, 'Supported: jpg, png, gif, webp, mp4, mov');

    const data = fs.readFileSync(filePath);
    // Note: base64 encoding inflates size ~33%. Video cap is conservative to avoid
    // OOM when the base64 string is injected into the browser JS engine via page.evaluate().
    const maxSize = mime.startsWith('video/') ? 20 * 1024 * 1024 : 10 * 1024 * 1024;
    if (data.length > maxSize) throw new CliError('FILE_TOO_LARGE', `File too large: ${fmtBytes(data.length)}`, `Max ${mime.startsWith('video/') ? '20MB' : '10MB'} (upload larger videos from a URL)`);

    const b64 = data.toString('base64');
    const fileName = path.basename(filePath);

    process.stderr.write(chalk.dim(`Uploading ${fileName} (${fmtBytes(data.length)})...\n`));
    await ensureOnYollomi(page);

    const result = await page.evaluate(`
      (async () => {
        try {
          const raw = atob(${JSON.stringify(b64)});
          const arr = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
          const file = new File([arr], ${JSON.stringify(fileName)}, { type: ${JSON.stringify(mime)} });
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' });
          const json = await res.json();
          return { ok: res.ok, status: res.status, data: json };
        } catch (err) {
          return { ok: false, status: 0, data: { error: err.message } };
        }
      })()
    `);

    if (!result?.ok) {
      throw new CliError('UPLOAD_ERROR', result?.data?.error || 'Upload failed', 'Make sure you are logged in to yollomi.com');
    }

    const url = result.data.url;
    process.stderr.write(chalk.green(`Uploaded! Use this URL as input for other commands.\n`));
    return [{ status: 'uploaded', file: fileName, size: fmtBytes(data.length), url }];
  },
});
