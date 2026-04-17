import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';

const GROK_URL = 'https://grok.com/';
const NO_IMAGE_PREFIX = '[NO IMAGE]';
const BLOCKED_PREFIX = '[BLOCKED]';
const SESSION_HINT = 'Likely login/auth/challenge/session issue in the existing grok.com browser session.';

type SendResult = {
  ok?: boolean;
  msg?: string;
  reason?: string;
  detail?: string;
};

type BubbleImage = {
  src: string;
  w: number;
  h: number;
};

type BubbleImageSet = BubbleImage[];

type FetchResult = {
  ok: boolean;
  base64?: string;
  contentType?: string;
  error?: string;
};

function normalizeBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function dedupeBySrc(images: BubbleImage[]): BubbleImage[] {
  const seen = new Set<string>();
  const out: BubbleImage[] = [];
  for (const img of images) {
    if (!img.src || seen.has(img.src)) continue;
    seen.add(img.src);
    out.push(img);
  }
  return out;
}

function imagesSignature(images: BubbleImage[]): string {
  return images.map(i => i.src).sort().join('|');
}

function extFromContentType(ct?: string): string {
  if (!ct) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  return 'jpg';
}

function buildFilename(src: string, ct?: string): string {
  const ext = extFromContentType(ct);
  const hash = crypto.createHash('sha1').update(src).digest('hex').slice(0, 12);
  return `grok-${Date.now()}-${hash}.${ext}`;
}

/** Check whether the tab is already on grok.com (any path). */
async function isOnGrok(page: IPage): Promise<boolean> {
  const url = await page.evaluate('window.location.href').catch(() => '');
  if (typeof url !== 'string' || !url) return false;
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'grok.com' || hostname.endsWith('.grok.com');
  } catch {
    return false;
  }
}

async function tryStartFreshChat(page: IPage): Promise<void> {
  await page.evaluate(`(() => {
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = Array.from(document.querySelectorAll('a, button')).filter(node => {
      if (!isVisible(node)) return false;
      const text = (node.textContent || '').trim().toLowerCase();
      const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
      const href = node.getAttribute('href') || '';
      return text.includes('new chat')
        || text.includes('new conversation')
        || aria.includes('new chat')
        || aria.includes('new conversation')
        || href === '/';
    });
    const target = candidates[0];
    if (target instanceof HTMLElement) target.click();
  })()`);
}

async function sendPrompt(page: IPage, prompt: string): Promise<SendResult> {
  const promptJson = JSON.stringify(prompt);
  return page.evaluate(`(async () => {
    try {
      const waitFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const composerSelector = '.ProseMirror[contenteditable="true"]';
      const isVisibleEnabledSubmit = (node) => {
        if (!(node instanceof HTMLButtonElement)) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return !node.disabled
          && rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };

      let pm = null;
      let box = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const composer = document.querySelector(composerSelector);
        if (composer instanceof HTMLElement) {
          pm = composer;
          break;
        }

        const textarea = document.querySelector('textarea');
        if (textarea instanceof HTMLTextAreaElement) {
          box = textarea;
          break;
        }

        await waitFor(1000);
      }

      // Prefer the ProseMirror composer when present (current grok.com UI).
      if (pm && pm.editor && pm.editor.commands) {
        try {
          if (pm.editor.commands.clearContent) pm.editor.commands.clearContent();
          pm.editor.commands.focus();
          pm.editor.commands.insertContent(${promptJson});
          for (let attempt = 0; attempt < 6; attempt += 1) {
            const sbtn = Array.from(document.querySelectorAll('button[aria-label="Submit"], button[aria-label="\\u63d0\\u4ea4"]'))
              .find(isVisibleEnabledSubmit);
            if (sbtn) {
              sbtn.click();
              return { ok: true, msg: 'pm-submit' };
            }
            await waitFor(500);
          }
        } catch (e) { /* fall through to textarea */ }
      }

      // Fallback: legacy textarea composer.
      if (!box) return { ok: false, msg: 'no composer (neither ProseMirror nor textarea)' };
      box.focus(); box.value = '';
      document.execCommand('selectAll');
      document.execCommand('insertText', false, ${promptJson});
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const btn = Array.from(document.querySelectorAll('button[aria-label="\\u63d0\\u4ea4"], button[aria-label="Submit"]'))
          .find(isVisibleEnabledSubmit);
        if (btn) {
          btn.click();
          return { ok: true, msg: 'clicked' };
        }

        const sub = Array.from(document.querySelectorAll('button[type="submit"]'))
          .find(isVisibleEnabledSubmit);
        if (sub) {
          sub.click();
          return { ok: true, msg: 'clicked-submit' };
        }

        await waitFor(500);
      }
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      return { ok: true, msg: 'enter' };
    } catch (e) { return { ok: false, msg: e && e.toString ? e.toString() : String(e) }; }
  })()`) as Promise<SendResult>;
}

/** Read <img> elements from all message bubbles so callers can filter by baseline. */
async function getBubbleImageSets(page: IPage): Promise<BubbleImageSet[]> {
  const result = await page.evaluate(`(() => {
    const bubbles = document.querySelectorAll('div.message-bubble, [data-testid="message-bubble"]');
    return Array.from(bubbles).map(bubble => Array.from(bubble.querySelectorAll('img'))
      .map(img => ({
        src: img.currentSrc || img.src || '',
        w: img.naturalWidth || img.width || 0,
        h: img.naturalHeight || img.height || 0,
      }))
      .filter(i => i.src && /^https?:/.test(i.src))
      // Ignore tiny UI/avatar images that may live in the bubble chrome.
      .filter(i => (i.w === 0 || i.w >= 128) && (i.h === 0 || i.h >= 128)));
  })()`) as BubbleImageSet[] | undefined;

  const raw = Array.isArray(result) ? result : [];
  return raw.map(dedupeBySrc);
}

function pickLatestImageCandidate(
  bubbleImageSets: BubbleImageSet[],
  baselineCount: number,
): BubbleImage[] {
  const freshSets = bubbleImageSets.slice(Math.max(0, baselineCount));
  for (let i = freshSets.length - 1; i >= 0; i -= 1) {
    if (freshSets[i].length) return freshSets[i];
  }
  return [];
}

// Download through the browser's fetch so grok.com cookies and referer are
// attached automatically — assets.grok.com is gated by Cloudflare and will
// refuse direct curl/node downloads.
async function fetchImageAsBase64(page: IPage, url: string): Promise<FetchResult> {
  const urlJson = JSON.stringify(url);
  return page.evaluate(`(async () => {
    try {
      const res = await fetch(${urlJson}, { credentials: 'include', referrer: 'https://grok.com/' });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const blob = await res.blob();
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return { ok: true, base64: btoa(binary), contentType: blob.type || 'image/jpeg' };
    } catch (e) { return { ok: false, error: e && e.message || String(e) }; }
  })()`) as Promise<FetchResult>;
}

async function saveImages(
  page: IPage,
  images: BubbleImage[],
  outDir: string,
): Promise<Array<BubbleImage & { path: string }>> {
  fs.mkdirSync(outDir, { recursive: true });
  const results: Array<BubbleImage & { path: string }> = [];
  for (const img of images) {
    const fetched = await fetchImageAsBase64(page, img.src);
    if (!fetched || !fetched.ok) {
      results.push({ ...img, path: `[DOWNLOAD FAILED] ${fetched?.error || 'unknown'}` });
      continue;
    }
    const filepath = path.join(outDir, buildFilename(img.src, fetched.contentType));
    fs.writeFileSync(filepath, Buffer.from(fetched.base64 || '', 'base64'));
    results.push({ ...img, path: filepath });
  }
  return results;
}

function toRow(img: BubbleImage, savedPath = '') {
  return { url: img.src, width: img.w, height: img.h, path: savedPath };
}

export const imageCommand = cli({
  site: 'grok',
  name: 'image',
  description: 'Generate images on grok.com and return image URLs',
  domain: 'grok.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'prompt', positional: true, type: 'string', required: true, help: 'Image generation prompt' },
    { name: 'timeout', type: 'int', default: 240, help: 'Max seconds to wait for the image (default: 240)' },
    { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending (default: false)' },
    { name: 'count', type: 'int', default: 1, help: 'Minimum images to wait for before returning (default: 1)' },
    { name: 'out', type: 'string', default: '', help: 'Directory to save downloaded images (uses browser session to bypass auth)' },
  ],
  columns: ['url', 'width', 'height', 'path'],
  func: async (page: IPage, kwargs: Record<string, any>) => {
    const prompt = kwargs.prompt as string;
    const timeoutMs = ((kwargs.timeout as number) || 240) * 1000;
    const newChat = normalizeBooleanFlag(kwargs.new);
    const minCount = Math.max(1, Number(kwargs.count || 1));
    const outDir = (kwargs.out || '').toString().trim();

    if (newChat) {
      await page.goto(GROK_URL);
      await page.wait(2);
      await tryStartFreshChat(page);
      await page.wait(2);
    } else if (!(await isOnGrok(page))) {
      await page.goto(GROK_URL);
      await page.wait(3);
    }

    const baselineBubbleCount = (await getBubbleImageSets(page)).length;
    const sendResult = await sendPrompt(page, prompt);
    if (!sendResult || !sendResult.ok) {
      return [{
        url: `${BLOCKED_PREFIX} send failed: ${JSON.stringify(sendResult)}. ${SESSION_HINT}`,
        width: 0,
        height: 0,
        path: '',
      }];
    }

    const startTime = Date.now();
    let lastSignature = '';
    let stableCount = 0;
    let lastImages: BubbleImage[] = [];

    while (Date.now() - startTime < timeoutMs) {
      await page.wait(3);
      const bubbleImageSets = await getBubbleImageSets(page);
      const images = pickLatestImageCandidate(bubbleImageSets, baselineBubbleCount);

      if (images.length >= minCount) {
        const signature = imagesSignature(images);
        if (signature === lastSignature) {
          stableCount += 1;
          // Require two consecutive stable reads (~6s) before declaring done.
          if (stableCount >= 2) {
            if (outDir) {
              const saved = await saveImages(page, images, outDir);
              return saved.map(s => toRow(s, s.path));
            }
            return images.map(i => toRow(i));
          }
        } else {
          stableCount = 0;
          lastSignature = signature;
          lastImages = images;
        }
      }
    }

    if (lastImages.length) {
      if (outDir) {
        const saved = await saveImages(page, lastImages, outDir);
        return saved.map(s => toRow(s, s.path));
      }
      return lastImages.map(i => toRow(i));
    }
    return [{
      url: `${NO_IMAGE_PREFIX} No image appeared within ${Math.round(timeoutMs / 1000)}s.`,
      width: 0,
      height: 0,
      path: '',
    }];
  },
});

export const __test__ = {
  normalizeBooleanFlag,
  isOnGrok,
  dedupeBySrc,
  imagesSignature,
  extFromContentType,
  buildFilename,
  pickLatestImageCandidate,
};
