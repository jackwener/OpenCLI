import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getRegistry } from '@jackwener/opencli/registry';
import './attachment-upload.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

function tmpfile(bytes) {
  const p = path.join(os.tmpdir(), `slock-upload-test-${process.pid}-${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(p, bytes);
  return p;
}

const UUID_CHAN = '11111111-1111-1111-1111-111111111111';

describe('slock attachment-upload', () => {
  const command = getRegistry().get('slock/attachment-upload');
  const files = [];
  afterEach(() => { for (const f of files) try { fs.unlinkSync(f); } catch {} files.length = 0; });

  it('refuses a missing file before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { file: '/no/such/file/here.bin', channel: UUID_CHAN }))
      .rejects.toThrow(/not readable/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('refuses a missing channel before navigation (F4: server returns 400 without channelId)', async () => {
    const f = tmpfile(Buffer.from('x')); files.push(f);
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { file: f })).rejects.toThrow(/channel required/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('refuses an empty file before navigation', async () => {
    const f = tmpfile(Buffer.alloc(0)); files.push(f);
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { file: f, channel: UUID_CHAN })).rejects.toThrow(/empty/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('refuses a file larger than the 50 MiB server cap before navigation', async () => {
    // We don't actually allocate 51 MiB; stub statSync to claim the size.
    const f = tmpfile(Buffer.from('small')); files.push(f);
    const orig = fs.statSync;
    const spy = vi.spyOn(fs, 'statSync').mockImplementation((p) => {
      if (p === path.resolve(f)) return { isFile: () => true, size: 51 * 1024 * 1024 };
      return orig.call(fs, p);
    });
    try {
      const page = makePage({ kind: 'ok', rows: [] });
      await expect(command.func(page, { file: f, channel: UUID_CHAN })).rejects.toThrow(/exceeds server limit/);
      expect(page.goto).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('sends a multipart upload with field name "files" (Bugen contract) and the uploadHeaders invariants', async () => {
    const f = tmpfile(Buffer.from('hello world')); files.push(f);
    const page = makePage({
      kind: 'ok',
      rows: [{ id: '550e8400-e29b-41d4-a716-446655440000', filename: path.basename(f), mimeType: 'application/octet-stream', sizeBytes: 11 }],
    });
    const rows = await command.func(page, { file: f, channel: UUID_CHAN });
    expect(page.evaluate).toHaveBeenCalledOnce();
    const snippet = page.evaluate.mock.calls[0][0];

    // multipart field name MUST be 'files' — multer.array('files', 5). If
    // someone changes it to 'file' the server returns 400; this catches drift
    // before it ships.
    expect(snippet).toContain("fd.append('files'");
    // F4 — channelId multipart text part. qatester live-flagged: without
    // this field server returns 400 "channelId is required". Pin so a
    // future refactor that drops the line is caught pre-network.
    expect(snippet).toContain("fd.append('channelId', channelId)");
    // Endpoint stays put.
    expect(snippet).toContain('/api/attachments/upload');

    // --- The from-scratch `uploadHeaders` invariants (托瓦茲 #1 fix-now). ---
    //
    // The whole point of building uploadHeaders from scratch is: forward auth,
    // drop content-type so the browser sets its own multipart boundary. If a
    // future refactor either (a) drops Bearer / X-Server-Id, or (b) re-adds
    // content-type, multipart auth or the boundary breaks.

    // POSITIVE — Bearer MUST be copied into uploadHeaders. Drift catch: if
    // someone writes `const uploadHeaders = { accept: headers.accept }` and
    // forgets authorization, requests go out unauthenticated → 401 in prod.
    expect(snippet).toMatch(/uploadHeaders\s*=\s*\{[^}]*\bauthorization\s*:\s*headers\.authorization/);

    // POSITIVE — X-Server-Id MUST be conditionally forwarded. Drift catch:
    // dropping this line means server-scoped uploads fall back to no-server
    // selection and 400/403.
    expect(snippet).toMatch(/uploadHeaders\[['"]x-server-id['"]\]\s*=\s*headers\[['"]x-server-id['"]\]/);

    // NEGATIVE — content-type MUST NOT be set on uploadHeaders, in any form
    // (bracket, dot, camelCase, quoted, unquoted). If anyone adds one,
    // the browser stops generating the multipart boundary and the server
    // 400s with "unexpected end of form".
    expect(snippet).not.toMatch(/uploadHeaders\s*[\[\.][^=]*content[-_]?type/i);

    // POSITIVE — fetch's headers field is uploadHeaders (not the raw `headers`
    // which still carries content-type: application/json). Drift catch: a
    // refactor that passes `headers` instead would silently break multipart.
    expect(snippet).toMatch(/fetch\([^)]*?,[\s\S]*?headers:\s*uploadHeaders/);
    expect(snippet).toMatch(/body:\s*fd[\s,]/);

    expect(rows[0]).toMatchObject({
      attachmentId: '550e8400-e29b-41d4-a716-446655440000',
      filename: path.basename(f),
      sizeBytes: 11,
    });
  });

  it('passes server override through authHeadersFragment', async () => {
    const f = tmpfile(Buffer.from('x')); files.push(f);
    const page = makePage({ kind: 'ok', rows: [{ id: '550e8400-e29b-41d4-a716-446655440000' }] });
    await command.func(page, { file: f, channel: UUID_CHAN, server: 'jackyland' });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('"jackyland"');
  });

  it('413 response surfaces as a clean http error mentioning maxBytes', async () => {
    const f = tmpfile(Buffer.from('x')); files.push(f);
    const page = makePage({ kind: 'http', status: 413, where: '/attachments/upload (file too large; maxBytes=52428800)' });
    await expect(command.func(page, { file: f, channel: UUID_CHAN })).rejects.toThrow(/HTTP 413.*maxBytes=52428800/);
  });
});
