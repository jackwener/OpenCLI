import type { IPage } from '../../types.js';

export const GEMINI_DOMAIN = 'gemini.google.com';
export const GEMINI_APP_URL = 'https://gemini.google.com/app';

export interface GeminiPageState {
  url: string;
  title: string;
  isSignedIn: boolean | null;
  composerLabel: string;
  canSend: boolean;
}

export interface GeminiTurn {
  Role: 'User' | 'Assistant' | 'System';
  Text: string;
}

const GEMINI_RESPONSE_NOISE_PATTERNS = [
  /Gemini can make mistakes\.?/gi,
  /Google Terms/gi,
  /Google Privacy Policy/gi,
  /Opens in a new window/gi,
];

export function sanitizeGeminiResponseText(value: string, promptText: string): string {
  let sanitized = value;
  for (const pattern of GEMINI_RESPONSE_NOISE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  sanitized = sanitized.trim();

  const prompt = promptText.trim();
  if (!prompt) return sanitized;
  if (sanitized === prompt) return '';

  for (const separator of ['\n\n', '\n', '\r\n\r\n', '\r\n']) {
    const prefix = `${prompt}${separator}`;
    if (sanitized.startsWith(prefix)) {
      return sanitized.slice(prefix.length).trim();
    }
  }

  return sanitized;
}

export function collectGeminiTranscriptAdditions(
  beforeLines: string[],
  currentLines: string[],
  promptText: string,
): string {
  const beforeSet = new Set(beforeLines);
  const additions = currentLines
    .filter((line) => !beforeSet.has(line))
    .map((line) => sanitizeGeminiResponseText(line, promptText))
    .filter((line) => line && line !== promptText);

  return additions.join('\n').trim();
}

function getStateScript(): string {
  return `
    (() => {
      const signInNode = Array.from(document.querySelectorAll('a, button')).find((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
        const href = node.getAttribute('href') || '';
        return text === 'sign in'
          || aria === 'sign in'
          || href.includes('accounts.google.com/ServiceLogin');
      });

      const composer = document.querySelector('[aria-label="Enter a prompt for Gemini"], [aria-label*="prompt for Gemini"], .ql-editor[aria-label*="Gemini"], [contenteditable="true"][aria-label*="Gemini"]');
      const sendButton = document.querySelector('button[aria-label="Send message"]');

      return {
        url: window.location.href,
        title: document.title || '',
        isSignedIn: signInNode ? false : (composer ? true : null),
        composerLabel: composer?.getAttribute('aria-label') || '',
        canSend: !!(sendButton && !sendButton.disabled),
      };
    })()
  `;
}

function getTranscriptLinesScript(): string {
  return `
    (() => {
      const clean = (value) => (value || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();

      const main = document.querySelector('main') || document.body;
      const root = main.cloneNode(true);

      const removableSelectors = [
        'button',
        'nav',
        'header',
        'footer',
        '[aria-label="Enter a prompt for Gemini"]',
        '[aria-label*="prompt for Gemini"]',
        '.input-area-container',
        '.input-wrapper',
        '.textbox-container',
        '.ql-toolbar',
        '.send-button',
        '.main-menu-button',
        '.sign-in-button',
      ];

      for (const selector of removableSelectors) {
        root.querySelectorAll(selector).forEach((node) => node.remove());
      }
      root.querySelectorAll('script, style, noscript').forEach((node) => node.remove());

      const stopLines = new Set([
        'Gemini',
        'Google Terms',
        'Google Privacy Policy',
        'Meet Gemini, your personal AI assistant',
        'Conversation with Gemini',
        'Ask Gemini 3',
        'Write',
        'Plan',
        'Research',
        'Learn',
        'Fast',
        'send',
        'Microphone',
        'Main menu',
        'New chat',
        'Sign in',
        'Google Terms Opens in a new window',
        'Google Privacy Policy Opens in a new window',
      ]);

      const noisyPatterns = [
        /^Google Terms$/,
        /^Google Privacy Policy$/,
        /^Gemini is AI and can make mistakes\.?$/,
        /^and the$/,
        /^apply\.$/,
        /^Opens in a new window$/,
        /^Open mode picker$/,
        /^Open upload file menu$/,
        /^Tools$/,
      ];

      return clean(root.innerText || root.textContent || '')
        .split('\\n')
        .map((line) => clean(line))
        .filter((line) => line
          && line.length <= 4000
          && !stopLines.has(line)
          && !noisyPatterns.some((pattern) => pattern.test(line)));
    })()
  `;
}

function getTurnsScript(): string {
  return `
    (() => {
      const clean = (value) => (value || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const selectors = [
        '[data-testid*="message"]',
        '[data-test-id*="message"]',
        '[class*="message"]',
        '[class*="conversation-turn"]',
        '[class*="query-text"]',
        '[class*="response-text"]',
      ];

      const roots = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
      const unique = roots.filter((el, index, all) => all.indexOf(el) === index).filter(isVisible);

      const turns = unique.map((el) => {
        const text = clean(el.innerText || el.textContent || '');
        if (!text) return null;

        const roleAttr = [
          el.getAttribute('data-message-author-role'),
          el.getAttribute('data-role'),
          el.getAttribute('aria-label'),
          el.getAttribute('class'),
        ].filter(Boolean).join(' ').toLowerCase();

        let role = '';
        if (roleAttr.includes('user') || roleAttr.includes('query')) role = 'User';
        else if (roleAttr.includes('assistant') || roleAttr.includes('model') || roleAttr.includes('response') || roleAttr.includes('gemini')) role = 'Assistant';

        return role ? { Role: role, Text: text } : null;
      }).filter(Boolean);

      const deduped = [];
      const seen = new Set();
      for (const turn of turns) {
        const key = turn.Role + '::' + turn.Text;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(turn);
      }
      return deduped;
    })()
  `;
}

function fillAndSubmitComposerScript(text: string): string {
  return `
    ((inputText) => {
      const cleanInsert = (el) => {
        if (!(el instanceof HTMLElement)) throw new Error('Composer is not editable');
        el.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
        el.textContent = '';
        document.execCommand('insertText', false, inputText);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: inputText, inputType: 'insertText' }));
      };

      const composer = document.querySelector('[aria-label="Enter a prompt for Gemini"], [aria-label*="prompt for Gemini"], .ql-editor[aria-label*="Gemini"], [contenteditable="true"][aria-label*="Gemini"]');
      if (!(composer instanceof HTMLElement)) {
        throw new Error('Could not find Gemini composer');
      }

      cleanInsert(composer);

      const sendButton = document.querySelector('button[aria-label="Send message"]');
      if (sendButton instanceof HTMLButtonElement && !sendButton.disabled) {
        sendButton.click();
        return 'button';
      }

      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      return 'enter';
    })(${JSON.stringify(text)})
  `;
}

function clickNewChatScript(): string {
  return `
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const candidates = Array.from(document.querySelectorAll('button, a')).filter((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
        return isVisible(node) && (text === 'new chat' || aria === 'new chat');
      });

      const target = candidates.find((node) => !node.hasAttribute('disabled')) || candidates[0];
      if (target instanceof HTMLElement) {
        target.click();
        return 'clicked';
      }
      return 'navigate';
    })()
  `;
}

function currentUrlScript(): string {
  return 'window.location.href';
}

export async function isOnGemini(page: IPage): Promise<boolean> {
  const url = await page.evaluate(currentUrlScript()).catch(() => '');
  if (typeof url !== 'string' || !url) return false;
  try {
    const hostname = new URL(url).hostname;
    return hostname === GEMINI_DOMAIN || hostname.endsWith(`.${GEMINI_DOMAIN}`);
  } catch {
    return false;
  }
}

export async function ensureGeminiPage(page: IPage): Promise<void> {
  if (!(await isOnGemini(page))) {
    await page.goto(GEMINI_APP_URL, { waitUntil: 'load', settleMs: 2500 });
    await page.wait(1);
  }
}

export async function getGeminiPageState(page: IPage): Promise<GeminiPageState> {
  await ensureGeminiPage(page);
  return await page.evaluate(getStateScript()) as GeminiPageState;
}

export async function startNewGeminiChat(page: IPage): Promise<'clicked' | 'navigate'> {
  await ensureGeminiPage(page);
  const action = await page.evaluate(clickNewChatScript()) as 'clicked' | 'navigate';
  if (action === 'navigate') {
    await page.goto(GEMINI_APP_URL, { waitUntil: 'load', settleMs: 2500 });
  }
  await page.wait(1);
  return action;
}

export async function getGeminiVisibleTurns(page: IPage): Promise<GeminiTurn[]> {
  await ensureGeminiPage(page);
  const turns = await page.evaluate(getTurnsScript()) as GeminiTurn[];
  if (Array.isArray(turns) && turns.length > 0) return turns;

  const lines = await getGeminiTranscriptLines(page);
  return lines.map((line) => ({ Role: 'System', Text: line }));
}

export async function getGeminiTranscriptLines(page: IPage): Promise<string[]> {
  await ensureGeminiPage(page);
  return await page.evaluate(getTranscriptLinesScript()) as string[];
}

export async function sendGeminiMessage(page: IPage, text: string): Promise<'button' | 'enter'> {
  await ensureGeminiPage(page);
  const submittedBy = await page.evaluate(fillAndSubmitComposerScript(text)) as 'button' | 'enter';
  await page.wait(1);
  return submittedBy;
}



export async function getGeminiVisibleImageUrls(page: IPage): Promise<string[]> {
  await ensureGeminiPage(page);
  return await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 32 && rect.height > 32;
      };

      const imgs = Array.from(document.querySelectorAll('main img')).filter((img) => img instanceof HTMLImageElement && isVisible(img));
      const urls = [];
      const seen = new Set();

      for (const img of imgs) {
        const src = img.currentSrc || img.src || '';
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (!src) continue;
        if (alt.includes('avatar') || alt.includes('logo') || alt.includes('icon')) continue;
        if (width < 128 && height < 128) continue;
        if (seen.has(src)) continue;
        seen.add(src);
        urls.push(src);
      }
      return urls;
    })()
  `) as string[];
}

export async function waitForGeminiImages(
  page: IPage,
  beforeUrls: string[],
  timeoutSeconds: number,
): Promise<string[]> {
  const beforeSet = new Set(beforeUrls);
  const pollIntervalSeconds = 3;
  const maxPolls = Math.max(1, Math.ceil(timeoutSeconds / pollIntervalSeconds));
  let lastUrls: string[] = [];
  let stableCount = 0;

  for (let index = 0; index < maxPolls; index += 1) {
    await page.wait(index === 0 ? 2 : pollIntervalSeconds);
    const urls = (await getGeminiVisibleImageUrls(page)).filter((url) => !beforeSet.has(url));
    if (urls.length === 0) continue;

    const key = urls.join('\n');
    const prevKey = lastUrls.join('\n');
    if (key == prevKey) stableCount += 1;
    else {
      lastUrls = urls;
      stableCount = 1;
    }

    if (stableCount >= 2 || index === maxPolls - 1) return lastUrls;
  }

  return lastUrls;
}

export interface GeminiImageAsset {
  url: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

export async function exportGeminiImages(page: IPage, urls: string[]): Promise<GeminiImageAsset[]> {
  await ensureGeminiPage(page);
  const urlsJson = JSON.stringify(urls);
  return await page.evaluate(`
    (async (targetUrls) => {
      const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
      });

      const inferMime = (value, fallbackUrl) => {
        if (value) return value;
        const lower = String(fallbackUrl || '').toLowerCase();
        if (lower.includes('.png')) return 'image/png';
        if (lower.includes('.webp')) return 'image/webp';
        if (lower.includes('.gif')) return 'image/gif';
        return 'image/jpeg';
      };

      const images = Array.from(document.querySelectorAll('main img'));
      const results = [];

      for (const targetUrl of targetUrls) {
        const img = images.find((node) => (node.currentSrc || node.src || '') === targetUrl);
        let dataUrl = '';
        let mimeType = 'image/jpeg';
        const width = img?.naturalWidth || img?.width || 0;
        const height = img?.naturalHeight || img?.height || 0;

        try {
          if (String(targetUrl).startsWith('data:')) {
            dataUrl = String(targetUrl);
            mimeType = (String(targetUrl).match(/^data:([^;]+);/i) || [])[1] || 'image/png';
          } else {
            const res = await fetch(String(targetUrl), { credentials: 'include' });
            if (res.ok) {
              const blob = await res.blob();
              mimeType = inferMime(blob.type, targetUrl);
              dataUrl = await blobToDataUrl(blob);
            }
          }
        } catch {}

        if (!dataUrl && img instanceof HTMLImageElement) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0);
              dataUrl = canvas.toDataURL('image/png');
              mimeType = 'image/png';
            }
          } catch {}
        }

        if (dataUrl) {
          results.push({ url: String(targetUrl), dataUrl, mimeType, width, height });
        }
      }

      return results;
    })(${urlsJson})
  `) as GeminiImageAsset[];
}
export async function waitForGeminiResponse(
  page: IPage,
  beforeLines: string[],
  promptText: string,
  timeoutSeconds: number,
): Promise<string> {
  const getCandidate = async (): Promise<string> => {
    const turns = await getGeminiVisibleTurns(page);
    const assistantCandidate = [...turns].reverse().find((turn) => turn.Role === 'Assistant');
    const visibleCandidate = assistantCandidate
      ? sanitizeGeminiResponseText(assistantCandidate.Text, promptText)
      : '';
    if (visibleCandidate && visibleCandidate !== promptText) return visibleCandidate;

    const lines = await getGeminiTranscriptLines(page);
    return collectGeminiTranscriptAdditions(beforeLines, lines, promptText);
  };

  const pollIntervalSeconds = 2;
  const maxPolls = Math.max(1, Math.ceil(timeoutSeconds / pollIntervalSeconds));
  let lastCandidate = '';
  let stableCount = 0;

  for (let index = 0; index < maxPolls; index += 1) {
    await page.wait(index === 0 ? 1.5 : pollIntervalSeconds);
    const candidate = await getCandidate();
    if (!candidate) continue;

    if (candidate === lastCandidate) stableCount += 1;
    else {
      lastCandidate = candidate;
      stableCount = 1;
    }

    if (stableCount >= 2 || index === maxPolls - 1) return candidate;
  }

  return lastCandidate;
}
