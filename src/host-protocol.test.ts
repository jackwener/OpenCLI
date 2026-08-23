import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CHUNK_TYPE,
  ChunkAssembler,
  FrameReader,
  NATIVE_MAX_FRAME_BYTES,
  PAYLOAD_TOO_LARGE_CODE,
  encodeFrame,
  encodeNativeFrames,
  listLiveHostStates,
  splitNativePayloads,
  splitUtf8ByBytes,
} from './host-protocol.js';

describe('native chunking', () => {
  it('does not chunk payloads that fit in one native frame', () => {
    expect(splitNativePayloads({ ok: true, id: 'x' })).toEqual([{ ok: true, id: 'x' }]);
  });

  it('slices by UTF-8 bytes so envelopes stay under 1MiB', () => {
    const data = 'a'.repeat(2 * 1024 * 1024);
    const json = JSON.stringify({ data });
    expect(Buffer.byteLength(json, 'utf8')).toBeGreaterThan(NATIVE_MAX_FRAME_BYTES);
    const parts = splitNativePayloads({ data });
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(Buffer.byteLength(JSON.stringify(part), 'utf8')).toBeLessThanOrEqual(NATIVE_MAX_FRAME_BYTES);
      expect((part as { type: string }).type).toBe(CHUNK_TYPE);
    }
    const assembler = new ChunkAssembler();
    let assembled: unknown;
    for (const part of parts) assembled = assembler.push(part);
    expect(assembled).toEqual({ data });
  });

  it('does not split mid-codepoint', () => {
    const s = '中'.repeat(1000);
    const parts = splitUtf8ByBytes(s, 10);
    expect(parts.join('')).toBe(s);
    for (const part of parts) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(10);
    }
  });

  it('FrameReader reassembles native frames', () => {
    const payload = { id: 'big', ok: true, data: 'b'.repeat(2 * 1024 * 1024) };
    const frames = encodeNativeFrames(payload);
    expect(frames.length).toBeGreaterThan(1);
    const reader = new FrameReader();
    const out: unknown[] = [];
    for (const frame of frames) out.push(...reader.push(frame));
    expect(out).toEqual([payload]);
  });

  it('rejects a single envelope that still exceeds the cap', () => {
    // A slice that cannot be wrapped without overflowing should throw typed.
    expect(() => splitUtf8ByBytes('x', 0)).toThrow();
    try {
      splitUtf8ByBytes('x', 0);
    } catch (err) {
      expect((err as { code?: string }).code).toBe(PAYLOAD_TOO_LARGE_CODE);
    }
  });

  it('encodeFrame of a small value is a 4-byte LE length prefix', () => {
    const buf = encodeFrame({ a: 1 });
    expect(buf.readUInt32LE(0)).toBe(buf.length - 4);
  });
});

describe('listLiveHostStates', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('drops state whose pid is dead and unlinks the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-live-'));
    dirs.push(dir);
    const file = path.join(dir, 'host-dead.json');
    fs.writeFileSync(file, JSON.stringify({
      pid: 2 ** 22,
      sock: path.join(dir, 'missing.sock'),
      contextId: 'dead',
      hostVersion: '2.0.0',
      extensionVersion: null,
      extensionCompatRange: null,
      startedAt: Date.now(),
    }));
    expect(listLiveHostStates(dir)).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('keeps a live pid with an existing socket', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-live-'));
    dirs.push(dir);
    const sock = path.join(dir, 'host-live.sock');
    fs.writeFileSync(sock, '');
    const file = path.join(dir, 'host-live.json');
    fs.writeFileSync(file, JSON.stringify({
      pid: process.pid,
      sock,
      contextId: 'live',
      hostVersion: '2.0.0',
      extensionVersion: '1.0.24',
      extensionCompatRange: '>=2.0.0',
      startedAt: Date.now(),
    }));
    const live = listLiveHostStates(dir);
    expect(live).toHaveLength(1);
    expect(live[0].contextId).toBe('live');
  });
});
