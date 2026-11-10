import { createHash } from 'node:crypto';
import type { IPage } from '../types.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const VISUAL_CAPTURE_MAX_AGE_MS = 120_000;

export type VisualCapture = {
  v: 1;
  tab: string;
  takenAt: number;
  urlHash: string;
  pngHash: string;
  imageWidth: number;
  imageHeight: number;
  cssWidth: number;
  cssHeight: number;
  transport?: 'cdp' | 'extension';
};

export type VisualSnapshot = {
  url: string;
  png: Buffer;
  imageWidth: number;
  imageHeight: number;
  cssWidth: number;
  cssHeight: number;
  transport?: 'cdp' | 'extension';
};

export class VisualActionError extends Error {
  constructor(public code: string, message: string, public hint?: string) {
    super(message);
    this.name = 'VisualActionError';
  }
}

function hash(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function pngDimensions(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)
      || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new VisualActionError('invalid_screenshot', 'Browser returned an invalid PNG screenshot.');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!finitePositive(width) || !finitePositive(height)) {
    throw new VisualActionError('invalid_screenshot', 'Browser returned invalid screenshot dimensions.');
  }
  return { width, height };
}

export function isProtectedAttachError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  return value?.code === 'attach_failed'
    && typeof value.message === 'string'
    && value.message.includes('Cannot access a chrome-extension:// URL of different extension');
}

function fromPng(url: string, data: string, cssWidth: number, cssHeight: number, transport: 'cdp' | 'extension'): VisualSnapshot {
  if (!url || !finitePositive(cssWidth) || !finitePositive(cssHeight)) {
    throw new VisualActionError('visual_unsupported', 'Browser did not return a valid target URL and viewport.');
  }
  const png = Buffer.from(data, 'base64');
  const { width: imageWidth, height: imageHeight } = pngDimensions(png);
  return { url, png, imageWidth, imageHeight, cssWidth, cssHeight, transport };
}

export async function captureVisualSnapshot(page: IPage, preferred: 'auto' | 'extension' = 'auto'): Promise<VisualSnapshot> {
  if (preferred === 'extension') {
    if (typeof page.visual !== 'function') throw new VisualActionError('visual_unsupported', 'Browser extension visual capture is unavailable.');
    const shot = await page.visual('capture') as { url?: string; data?: string; cssWidth?: number; cssHeight?: number };
    if (typeof shot?.data !== 'string') throw new VisualActionError('invalid_screenshot', 'Browser returned no PNG screenshot.');
    return fromPng(shot.url ?? '', shot.data, shot.cssWidth ?? 0, shot.cssHeight ?? 0, 'extension');
  }
  if (typeof page.cdp !== 'function') {
    throw new VisualActionError('visual_unsupported', 'This browser backend does not support visual actions.');
  }
  try {
    const tree = await page.cdp('Page.getFrameTree') as { frameTree?: { frame?: { url?: string } } };
    const url = tree?.frameTree?.frame?.url;
    const layout = await page.cdp('Page.getLayoutMetrics') as {
      cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
    };
    const cssWidth = layout?.cssVisualViewport?.clientWidth;
    const cssHeight = layout?.cssVisualViewport?.clientHeight;
    const shot = await page.cdp('Page.captureScreenshot', { format: 'png' }) as { data?: string };
    if (typeof shot?.data !== 'string') {
      throw new VisualActionError('invalid_screenshot', 'Browser did not return PNG screenshot data.');
    }
    return fromPng(url ?? '', shot.data, cssWidth ?? 0, cssHeight ?? 0, 'cdp');
  } catch (error) {
    if (!isProtectedAttachError(error)) throw error;
    return captureVisualSnapshot(page, 'extension');
  }
}

export function encodeVisualCapture(snapshot: VisualSnapshot, tab: string, takenAt = Date.now()): string {
  const capture: VisualCapture = {
    v: 1,
    tab,
    takenAt,
    urlHash: hash(snapshot.url),
    pngHash: hash(snapshot.png),
    imageWidth: snapshot.imageWidth,
    imageHeight: snapshot.imageHeight,
    cssWidth: snapshot.cssWidth,
    cssHeight: snapshot.cssHeight,
    transport: snapshot.transport ?? 'cdp',
  };
  return Buffer.from(JSON.stringify(capture)).toString('base64url');
}

export function decodeVisualCapture(raw: unknown, now = Date.now()): VisualCapture {
  if (typeof raw !== 'string' || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new VisualActionError('invalid_capture', 'Invalid visual capture descriptor.');
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new VisualActionError('invalid_capture', 'Invalid visual capture descriptor.');
  }
  const c = value as Partial<VisualCapture> | null;
  if (!c || c.v !== 1 || typeof c.tab !== 'string' || !c.tab
      || typeof c.urlHash !== 'string' || !/^[a-f0-9]{64}$/.test(c.urlHash)
      || typeof c.pngHash !== 'string' || !/^[a-f0-9]{64}$/.test(c.pngHash)
      || !finitePositive(c.imageWidth) || !finitePositive(c.imageHeight)
      || !finitePositive(c.cssWidth) || !finitePositive(c.cssHeight)
      || (c.transport !== undefined && c.transport !== 'cdp' && c.transport !== 'extension')
      || typeof c.takenAt !== 'number' || !Number.isFinite(c.takenAt)) {
    throw new VisualActionError('invalid_capture', 'Invalid visual capture descriptor.');
  }
  if (c.takenAt > now || now - c.takenAt > VISUAL_CAPTURE_MAX_AGE_MS) {
    throw new VisualActionError('expired_capture', 'Visual capture expired. Take a new screenshot.');
  }
  return c as VisualCapture;
}

export function assertVisualSnapshot(capture: VisualCapture, tab: string, snapshot: VisualSnapshot): void {
  if (capture.tab !== tab) {
    throw new VisualActionError('capture_tab_changed', 'The target tab differs from the screenshot tab.');
  }
  if ((capture.transport ?? 'cdp') !== (snapshot.transport ?? 'cdp')
      || capture.urlHash !== hash(snapshot.url)
      || capture.imageWidth !== snapshot.imageWidth || capture.imageHeight !== snapshot.imageHeight
      || capture.cssWidth !== snapshot.cssWidth || capture.cssHeight !== snapshot.cssHeight
      || capture.pngHash !== hash(snapshot.png)) {
    throw new VisualActionError(
      'capture_stale',
      'The page changed after the screenshot. Take a new screenshot and point.',
    );
  }
}

export function parseVisualPoint(raw: unknown, capture: VisualCapture): { x: number; y: number } {
  const match = typeof raw === 'string' ? /^(\d+),(\d+)$/.exec(raw) : null;
  if (!match) throw new VisualActionError('invalid_point', '--point must be image pixels as X,Y.');
  const imageX = Number(match[1]);
  const imageY = Number(match[2]);
  if (!Number.isSafeInteger(imageX) || !Number.isSafeInteger(imageY)
      || imageX >= capture.imageWidth || imageY >= capture.imageHeight) {
    throw new VisualActionError('invalid_point', 'The point is outside the captured image.');
  }
  return {
    x: (imageX + 0.5) * capture.cssWidth / capture.imageWidth,
    y: (imageY + 0.5) * capture.cssHeight / capture.imageHeight,
  };
}
