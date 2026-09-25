import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    GEMINI_APP_URL,
    GEMINI_DOMAIN,
    clickGeminiConversationById,
    ensureGeminiPage,
} from './utils.js';

function parseGeminiId(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw, GEMINI_APP_URL);
        const match = url.pathname.match(/^\/app\/([A-Za-z0-9_-]+)/);
        if (match) return match[1];
    } catch {}
    const trimmed = raw.replace(/^.*\/app\//, '').replace(/\/.*$/, '');
    return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : '';
}

function extractGeminiRawDetailScript() {
    return `
    (() => {
      const clean = (value) => String(value || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
      const rectOf = (el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const imageOf = (img) => ({
        src: img.currentSrc || img.src || '',
        alt: img.alt || '',
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        rect: rectOf(img),
        testId: img.getAttribute('data-testid') || img.getAttribute('data-test-id') || '',
        className: String(img.className || ''),
      });
      const buttonsOf = (root) => Array.from(root.querySelectorAll('button, [role="button"]'))
        .map((button) => ({
          label: clean((button.getAttribute('aria-label') || '') + ' ' + (button.textContent || '')),
          testId: button.getAttribute('data-testid') || button.getAttribute('data-test-id') || '',
          rect: rectOf(button),
        }))
        .filter((button) => button.label || button.testId);
      const userText = (root) => {
        const query = root.querySelector('user-query, user-query-content, [class*="query-text"]');
        const text = clean(query?.innerText || query?.textContent || '');
        return text.replace(/^你说\\s*/, '').trim();
      };
      const assistantText = (root) => {
        const response = root.querySelector('model-response, response-container, [class*="response-content"], [class*="model-response"]');
        const text = clean(response?.innerText || response?.textContent || '');
        return text.replace(/^Gemini 说\\s*/, '').trim();
      };
      const containers = Array.from(document.querySelectorAll('.conversation-container, user-query, model-response'));
      const containerRoots = [];
      for (const node of containers) {
        const root = node.closest('.conversation-container') || node;
        if (!containerRoots.includes(root)) containerRoots.push(root);
      }
      const turns = [];
      for (const root of containerRoots) {
        const query = userText(root);
        const answer = assistantText(root);
        const images = Array.from(root.querySelectorAll('img')).map(imageOf).filter((image) => image.src);
        const buttons = buttonsOf(root);
        if (query) {
          turns.push({ role: 'User', text: query, images: images.filter((image) => /uploaded|preview|所上传/i.test(image.alt + ' ' + image.testId + ' ' + image.className)), raw: { rect: rectOf(root), buttons } });
        }
        if (answer || images.length || buttons.some((button) => /下载|download|复制图片|copy image|分享图片|share image/i.test(button.label))) {
          turns.push({ role: 'Assistant', text: answer, images, raw: { rect: rectOf(root), buttons } });
        }
      }
      const turnImages = turns.flatMap((turn) => turn.images || []);
      return {
        url: location.href,
        title: document.title || '',
        turns,
        images: turnImages,
        buttons: buttonsOf(document.body),
      };
    })()
  `;
}

export const rawDetailCommand = cli({
    site: 'gemini',
    name: 'raw-detail',
    access: 'read',
    description: 'Fetch a Gemini conversation DOM raw detail with text turns and image URLs',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Conversation id, /app/<id> path, or Gemini conversation URL' },
    ],
    columns: ['Id', 'Url', 'Title', 'Turns', 'Images', 'Raw'],
    func: async (page, kwargs) => {
        const id = parseGeminiId(kwargs?.id);
        if (!id) {
            throw new ArgumentError('id', 'must be a Gemini conversation id, /app/<id> path, or URL');
        }
        await ensureGeminiPage(page);
        await page.goto(`${GEMINI_APP_URL}/${id}`, { waitUntil: 'load', settleMs: 2500 });
        await page.wait(2);
        let raw = await page.evaluate(extractGeminiRawDetailScript());
        if (!raw?.turns?.length || raw.turns.every((turn) => !turn.text && !turn.images?.length)) {
            await clickGeminiConversationById(page, id);
            raw = await page.evaluate(extractGeminiRawDetailScript());
        }
        if (!raw?.turns?.length) {
            throw new EmptyResultError('gemini raw-detail', `No Gemini turns were found for ${id}.`);
        }
        return [{
            Id: id,
            Url: raw.url || `${GEMINI_APP_URL}/${id}`,
            Title: raw.title || '',
            Turns: raw.turns,
            Images: raw.images || [],
            Raw: raw,
        }];
    },
});
