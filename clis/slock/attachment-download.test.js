import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getRegistry } from '@jackwener/opencli/registry';
import './attachment-download.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

const ID = '550e8400-e29b-41d4-a716-446655440000';

describe('slock attachment-download', () => {
  const command = getRegistry().get('slock/attachment-download');
  const outs = [];
  afterEach(() => {
    for (const f of outs) try { fs.unlinkSync(f); } catch {}
    outs.length = 0;
    vi.restoreAllMocks();
  });

  it('rejects a non-UUID attachmentId before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: {} });
    await expect(command.func(page, { attachmentId: 'short8x' }))
      .rejects.toThrow(/not a UUID/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('asks the page for /url then fetches the signed URL node-side (CORS-safe path)', async () => {
    const out = path.join(os.tmpdir(), `dl-${process.pid}-${Math.random().toString(36).slice(2)}.bin`);
    outs.push(out);
    const SIGNED = 'https://cdn.slock.ai/signed?id=' + ID;
    const page = makePage({ kind: 'ok', rows: { url: SIGNED, expiresAt: '2026-06-07T13:00:00Z' } });

    // Stub global fetch so the Node-side step doesn't actually touch the network.
    const bytes = Buffer.from('hello signed cdn payload');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });

    const rows = await command.func(page, { attachmentId: ID, out });
    // The in-page snippet hits the /url endpoint (not the 302 one) — that's
    // how we sidestep CORS on the CDN host. If a future refactor went back to
    // /:id 302-following, this assertion would catch it.
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain(`/api/attachments/${encodeURIComponent(ID)}/url`);
    // Node fetched the signed URL exactly once, no auth header.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(SIGNED);
    // And we wrote the bytes verbatim.
    expect(fs.readFileSync(out).toString()).toBe('hello signed cdn payload');
    expect(rows[0]).toMatchObject({ attachmentId: ID, out, sizeBytes: bytes.length });
  });

  it('surfaces a missing url from the /url response as a clear error', async () => {
    const page = makePage({ kind: 'ok', rows: { expiresAt: '2026-06-07T13:00:00Z' /* no url */ } });
    await expect(command.func(page, { attachmentId: ID }))
      .rejects.toThrow(/no signed url/);
  });

  it('surfaces an HTTP error from the signed CDN fetch', async () => {
    const page = makePage({ kind: 'ok', rows: { url: 'https://cdn.example.invalid/x' } });
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403 });
    await expect(command.func(page, { attachmentId: ID }))
      .rejects.toThrow(/HTTP 403 from signed CDN URL/);
  });

  // Drift canary (Bugen contract): signed CDN URLs carry their authorization
  // in the query string and expire (`expiresAt`). They MUST NOT be cached
  // across invocations — a future refactor that adds `let urlCache = new Map()`
  // would hand out a stale URL on the second call and the CDN would 403 (not
  // 401). So each invocation must re-hit `/url` in-page AND re-fetch node-side.
  it('does NOT cache the signed URL across invocations (re-fetches /url every call)', async () => {
    const out1 = path.join(os.tmpdir(), `dl1-${process.pid}-${Math.random().toString(36).slice(2)}.bin`);
    const out2 = path.join(os.tmpdir(), `dl2-${process.pid}-${Math.random().toString(36).slice(2)}.bin`);
    outs.push(out1, out2);
    const SIGNED_A = 'https://cdn.slock.ai/signed?id=' + ID + '&t=1';
    const SIGNED_B = 'https://cdn.slock.ai/signed?id=' + ID + '&t=2';
    const pageA = makePage({ kind: 'ok', rows: { url: SIGNED_A, expiresAt: '2026-06-07T13:00:00Z' } });
    const pageB = makePage({ kind: 'ok', rows: { url: SIGNED_B, expiresAt: '2026-06-07T14:00:00Z' } });
    const bytes = Buffer.from('payload');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });

    await command.func(pageA, { attachmentId: ID, out: out1 });
    await command.func(pageB, { attachmentId: ID, out: out2 });

    // Both calls must hit /url in-page (no in-memory shortcut).
    expect(pageA.evaluate).toHaveBeenCalledTimes(1);
    expect(pageB.evaluate).toHaveBeenCalledTimes(1);
    // Both calls must Node-side fetch the freshly resolved URL — and the
    // second call MUST receive the SECOND signed URL, not the first cached.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(SIGNED_A);
    expect(fetchSpy.mock.calls[1][0]).toBe(SIGNED_B);
  });
});
