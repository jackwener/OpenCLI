import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../types.js';
import {
  VisualActionError,
  assertVisualSnapshot,
  captureVisualSnapshot,
  decodeVisualCapture,
  encodeVisualCapture,
  parseVisualPoint,
} from './visual-action.js';

function png(width: number, height: number, variant = 0): Buffer {
  const data = Buffer.alloc(25);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  data[24] = variant;
  return data;
}

const snapshot = {
  url: 'https://example.test/form',
  png: png(200, 100),
  imageWidth: 200,
  imageHeight: 100,
  cssWidth: 100,
  cssHeight: 50,
};

describe('visual action capture', () => {
  it('maps Retina image pixels to CSS coordinates and binds the exact tab', () => {
    const descriptor = encodeVisualCapture(snapshot, 'target-7', 1000);
    const capture = decodeVisualCapture(descriptor, 1001);
    expect(parseVisualPoint('99,49', capture)).toEqual({ x: 49.75, y: 24.75 });
    expect(() => parseVisualPoint('200,0', capture)).toThrowError(VisualActionError);
    expect(() => assertVisualSnapshot(capture, 'target-8', snapshot)).toThrowError(
      expect.objectContaining({ code: 'capture_tab_changed' }),
    );
  });

  it('rejects URL, viewport, and same-size screenshot changes', () => {
    const capture = decodeVisualCapture(encodeVisualCapture(snapshot, 'target-7', 1000), 1001);
    expect(() => assertVisualSnapshot(capture, 'target-7', { ...snapshot, url: 'https://example.test/other' })).toThrowError(
      expect.objectContaining({ code: 'capture_stale' }),
    );
    expect(() => assertVisualSnapshot(capture, 'target-7', { ...snapshot, cssWidth: 101 })).toThrowError(
      expect.objectContaining({ code: 'capture_stale' }),
    );
    expect(() => assertVisualSnapshot(capture, 'target-7', { ...snapshot, png: png(200, 100, 1) })).toThrowError(
      expect.objectContaining({ code: 'capture_stale' }),
    );
  });

  it('rejects malformed and expired descriptors', () => {
    expect(() => decodeVisualCapture('not valid')).toThrowError(expect.objectContaining({ code: 'invalid_capture' }));
    expect(() => decodeVisualCapture(encodeVisualCapture(snapshot, 'target-7', 1000), 121001)).toThrowError(
      expect.objectContaining({ code: 'expired_capture' }),
    );
  });

  it('reads unmodified screenshot bytes, URL, and CSS viewport from CDP', async () => {
    const cdp = vi.fn(async (method: string) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { url: snapshot.url } } };
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 100, clientHeight: 50 } };
      if (method === 'Page.captureScreenshot') return { data: snapshot.png.toString('base64') };
      throw new Error(method);
    });
    const result = await captureVisualSnapshot({ cdp } as unknown as IPage);
    expect(result).toEqual({ ...snapshot, transport: 'cdp' });
    expect(cdp.mock.calls.map(([method]) => method)).toEqual([
      'Page.getFrameTree', 'Page.getLayoutMetrics', 'Page.captureScreenshot',
    ]);
    await expect(captureVisualSnapshot({} as IPage)).rejects.toMatchObject({ code: 'visual_unsupported' });
  });

  it('uses extension capture only for the protected iCloud iframe attach error', async () => {
    const protectedError = Object.assign(new Error('attach failed: Cannot access a chrome-extension:// URL of different extension'), { code: 'attach_failed' });
    const cdp = vi.fn().mockRejectedValue(protectedError);
    const visual = vi.fn().mockResolvedValue({
      url: snapshot.url, data: snapshot.png.toString('base64'), cssWidth: 100, cssHeight: 50,
    });
    const result = await captureVisualSnapshot({ cdp, visual } as unknown as IPage);
    expect(result).toEqual({ ...snapshot, transport: 'extension' });
    expect(visual).toHaveBeenCalledWith('capture');
    const descriptor = decodeVisualCapture(encodeVisualCapture(result, 'target-7', 1000), 1001);
    expect(() => assertVisualSnapshot(descriptor, 'target-7', { ...result, transport: 'cdp' })).toThrowError(
      expect.objectContaining({ code: 'capture_stale' }),
    );
    const otherError = Object.assign(new Error('attach failed: tab closed'), { code: 'attach_failed' });
    await expect(captureVisualSnapshot({ cdp: vi.fn().mockRejectedValue(otherError), visual } as unknown as IPage))
      .rejects.toBe(otherError);
  });
});
