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

describe('slock attachment-upload', () => {
  const command = getRegistry().get('slock/attachment-upload');
  const files = [];
  afterEach(() => { for (const f of files) try { fs.unlinkSync(f); } catch {} files.length = 0; });

  it('refuses a missing file before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { file: '/no/such/file/here.bin' }))
      .rejects.toThrow(/not readable/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('refuses an empty file before navigation', async () => {
    const f = tmpfile(Buffer.alloc(0)); files.push(f);
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { file: f })).rejects.toThrow(/empty/);
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
      await expect(command.func(page, { file: f })).rejects.toThrow(/exceeds server limit/);
      expect(page.goto).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('sends a multipart upload with field name "files" (Bugen contract)', async () => {
    const f = tmpfile(Buffer.from('hello world')); files.push(f);
    const page = makePage({
      kind: 'ok',
      rows: [{ id: '550e8400-e29b-41d4-a716-446655440000', filename: path.basename(f), mimeType: 'application/octet-stream', sizeBytes: 11 }],
    });
    const rows = await command.func(page, { file: f });
    expect(page.evaluate).toHaveBeenCalledOnce();
    const snippet = page.evaluate.mock.calls[0][0];
    // multipart field name MUST be 'files' — multer.array('files', 5). If
    // someone changes it to 'file' the server returns 400; this assertion
    // catches that drift before it ships.
    expect(snippet).toContain("fd.append('files'");
    // We post to the upload endpoint, and we DON'T forward content-type into
    // the form-data fetch so the browser builds its own multipart boundary.
    // (We build `uploadHeaders` from scratch, copying only authorization,
    // accept, and x-server-id — content-type intentionally absent.)
    expect(snippet).toContain('/api/attachments/upload');
    expect(snippet).toContain('uploadHeaders');
    // The form fetch's headers object must be uploadHeaders, not the JSON one.
    expect(snippet).toMatch(/body: fd[\s,]/);
    expect(rows[0]).toMatchObject({
      attachmentId: '550e8400-e29b-41d4-a716-446655440000',
      filename: path.basename(f),
      sizeBytes: 11,
    });
  });

  it('passes server override through authHeadersFragment', async () => {
    const f = tmpfile(Buffer.from('x')); files.push(f);
    const page = makePage({ kind: 'ok', rows: [{ id: '550e8400-e29b-41d4-a716-446655440000' }] });
    await command.func(page, { file: f, server: 'jackyland' });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('"jackyland"');
  });

  it('413 response surfaces as a clean http error mentioning maxBytes', async () => {
    const f = tmpfile(Buffer.from('x')); files.push(f);
    const page = makePage({ kind: 'http', status: 413, where: '/attachments/upload (file too large; maxBytes=52428800)' });
    await expect(command.func(page, { file: f })).rejects.toThrow(/HTTP 413.*maxBytes=52428800/);
  });
});
