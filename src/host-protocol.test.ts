import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  CHUNK_TYPE,
  FrameReader,
  encodeFrame,
  encodeNativeFrames,
  isChunkEnvelope,
  NATIVE_MAX_FRAME_BYTES,
  sanitizeContextId,
} from './host-protocol.js';

describe('native framing', () => {
  it('round-trips a JSON object through length-prefixed frames', () => {
    const reader = new FrameReader();
    const frame = encodeFrame({ type: 'hello', contextId: 'abc' });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    expect(reader.push(frame)).toEqual([{ type: 'hello', contextId: 'abc' }]);
  });

  it('assembles messages split across TCP/stdio chunks', () => {
    const reader = new FrameReader();
    const frame = encodeFrame({ id: 'cmd_1', ok: true });
    expect(reader.push(frame.subarray(0, 3))).toEqual([]);
    expect(reader.push(frame.subarray(3))).toEqual([{ id: 'cmd_1', ok: true }]);
  });

  it('reassembles chunked payloads that exceed the Chrome 1MiB native cap', () => {
    const payload = { blob: 'x'.repeat(NATIVE_MAX_FRAME_BYTES + 100) };
    const frames = encodeNativeFrames(payload);
    expect(frames.length).toBeGreaterThan(1);
    const first = JSON.parse(frames[0].subarray(4).toString('utf8'));
    expect(isChunkEnvelope(first)).toBe(true);
    expect(first.type).toBe(CHUNK_TYPE);
    const reader = new FrameReader();
    const assembled: unknown[] = [];
    for (const frame of frames) assembled.push(...reader.push(frame));
    expect(assembled).toEqual([payload]);
  });

  it('sanitizes context ids used in socket filenames', () => {
    expect(sanitizeContextId('../etc/passwd')).toBe('.._etc_passwd');
    expect(sanitizeContextId('')).toBe('default');
  });
});
