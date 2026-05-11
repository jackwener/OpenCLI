import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const GROK_URL = 'https://grok.com/';
const SESSION_HINT = 'Likely login/auth/challenge/session issue in the existing grok.com browser session.';

function normalizeBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * Validate a positive-integer arg without silently flooring/clamping.
 * Throws ArgumentError on `0`, negatives, non-integers, or non-numeric input.
 */
function normalizePositiveInteger(value, defaultValue, label) {
  const raw = value ?? defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ArgumentError(`${label} must be a positive integer`);
  }
  return n;
}

function dedupeBySrc(images) {
  const seen = new Set();
  const out = [];
  for (const img of images) {
    if (!img.src || seen.has(img.src)) continue;
    seen.add(img.src);
    out.push(img);
  }
  return out;
}

function imagesSignature(images) {
  return images.map(i => i.src).sort().join('|');
}

function extFromContentType(ct) {
  if (!ct) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  return 'jpg';
}

function buildFilename(src, ct) {
  const ext = extFromContentType(ct);
  const hash = crypto.createHash('sha1').update(src).digest('hex').slice(0, 12);
  return `grok-${Date.now()}-${hash}.${ext}`;
}

/** Check whether the tab is already on grok.com (any path). */
async function isOnGrok(page) {
  const url = await page.evaluate('window.location.href').catch(() => '');
  if (typeof url !== 'string' || !url) return false;
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'grok.com' || hostname.endsWith('.grok.com');
  } catch {
    return false;
  }
}

async function tryStartFreshChat(page) {
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

async function sendPrompt(page, prompt) {
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
  })()`);
}

/** Read <img> elements from all message bubbles so callers can filter by baseline. */
async function getBubbleImageSets(page) {
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
  })()`);

  const raw = Array.isArray(result) ? result : [];
  return raw.map(dedupeBySrc);
}

function pickLatestImageCandidate(bubbleImageSets, baselineCount) {
  const freshSets = bubbleImageSets.slice(Math.max(0, baselineCount));
  for (let i = freshSets.length - 1; i >= 0; i -= 1) {
    if (freshSets[i].length) return freshSets[i];
  }
  return [];
}

// Download through the browser's fetch so grok.com cookies and referer are
// attached automatically — assets.grok.com is gated by Cloudflare and will
// refuse direct curl/node downloads.
async function fetchImageAsBase64(page, url) {
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
  })()`);
}

async function saveImages(page, images, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const img of images) {
    const fetched = await fetchImageAsBase64(page, img.src);
    if (!fetched || !fetched.ok) {
      // Fail loudly on per-image download failure rather than emit a sentinel
      // row with path = '[DOWNLOAD FAILED] ...' that downstream tools cannot
      // distinguish from a real path. assets.grok.com is Cloudflare-gated, so
      // a single 401/403 typically means the whole batch is unrecoverable.
      const reason = fetched?.error ? `: ${fetched.error}` : '';
      throw new CommandExecutionError(
        `Failed to download grok image ${img.src}${reason}`,
        'assets.grok.com download requires the live grok.com browser session — verify the tab is logged in and try again.',
      );
    }
    const filepath = path.join(outDir, buildFilename(img.src, fetched.contentType));
    fs.writeFileSync(filepath, Buffer.from(fetched.base64 || '', 'base64'));
    results.push({ ...img, path: filepath });
  }
  return results;
}

function toRow(img, savedPath = '') {
  return { url: img.src, width: img.w, height: img.h, path: savedPath };
}

export const imageCommand = cli({
  site: 'grok',
  name: 'image',
  description: 'Generate images on grok.com and return image URLs',
  access: 'write',
  domain: 'grok.com',
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'prompt', positional: true, type: 'string', required: true, help: 'Image generation prompt' },
    { name: 'timeout', type: 'int', default: 240, help: 'Max seconds to wait for the image (default: 240)' },
    { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending (default: false)' },
    { name: 'count', type: 'int', default: 1, help: 'Minimum images to wait for before returning (default: 1)' },
    { name: 'out', type: 'string', default: '', help: 'Directory to save downloaded images (uses browser session to bypass auth)' },
  ],
  columns: ['url', 'width', 'height', 'path'],
  func: async (page, kwargs) => {
    const prompt = kwargs.prompt;
    const timeoutMs = (kwargs.timeout || 240) * 1000;
    const newChat = normalizeBooleanFlag(kwargs.new);
    const minCount = normalizePositiveInteger(kwargs.count, 1, 'count');
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
      throw new CommandExecutionError(
        `Grok composer rejected the prompt: ${JSON.stringify(sendResult)}`,
        SESSION_HINT,
      );
    }

    const startTime = Date.now();
    let lastSignature = '';
    let stableCount = 0;
    let lastImages = [];

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

    // Timeout — keep best-effort partial results if any image bubble showed
    // up, otherwise surface the timeout instead of a sentinel row.
    if (lastImages.length) {
      if (outDir) {
        const saved = await saveImages(page, lastImages, outDir);
        return saved.map(s => toRow(s, s.path));
      }
      return lastImages.map(i => toRow(i));
    }
    throw new TimeoutError('grok image generation', Math.round(timeoutMs / 1000));
  },
});

export const __test__ = {
  normalizeBooleanFlag,
  normalizePositiveInteger,
  isOnGrok,
  dedupeBySrc,
  imagesSignature,
  extFromContentType,
  buildFilename,
  pickLatestImageCandidate,
};
