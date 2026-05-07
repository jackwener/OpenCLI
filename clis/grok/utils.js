import { htmlToMarkdown } from '@jackwener/opencli/utils';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';

export const GROK_DOMAIN = 'grok.com';
export const GROK_URL = 'https://grok.com/';

export const IS_VISIBLE_JS = `
  const isVisible = (node) => {
    if (!(node instanceof Element)) return false;
    const style = window.getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
`;

export function authRequired(detail) {
    return new AuthRequiredError(
        GROK_DOMAIN,
        detail || 'Sign in to grok.com in your browser, then retry.',
    );
}

export function normalizeBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value == null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

// UUID v4-shape: 8-4-4-4-12 hex with dashes (the format Grok uses for /c/<id>)
const GROK_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseGrokSessionId(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
        throw new ArgumentError('id', 'must be a non-empty session ID or grok.com chat URL');
    }
    let candidate = raw;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        let parsed;
        try {
            parsed = new URL(raw);
        } catch {
            throw new ArgumentError('id', `not a valid Grok URL (got "${input}")`);
        }
        const host = parsed.hostname.toLowerCase();
        const pathMatch = parsed.pathname.match(
            /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i,
        );
        if (parsed.protocol !== 'https:' || (host !== 'grok.com' && !host.endsWith('.grok.com')) || !pathMatch) {
            throw new ArgumentError(
                'id',
                `not a valid Grok conversation URL (got "${input}"); expected https://grok.com/c/<id>`,
            );
        }
        candidate = pathMatch[1];
    }
    if (!GROK_SESSION_ID_RE.test(candidate)) {
        throw new ArgumentError(
            'id',
            `not a valid Grok session ID (got "${input}"); expected a UUID like "7c4197f2-10a1-4ebb-a84a-fea89f4f1d06" or a full https://grok.com/c/<id> URL`,
        );
    }
    return candidate.toLowerCase();
}

export async function isOnGrok(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string' || !url) return false;
    try {
        const hostname = new URL(url).hostname;
        return hostname === 'grok.com' || hostname.endsWith('.grok.com');
    } catch {
        return false;
    }
}

export async function ensureOnGrok(page) {
    if (await isOnGrok(page)) return;
    await page.goto(GROK_URL);
    await page.wait(2);
}

export async function isLoggedIn(page) {
    // Composer presence is the most reliable signed-in marker — when the user
    // is signed out, grok.com renders a sign-in CTA in place of the chat
    // composer rather than the TipTap editor.
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const composer = document.querySelector('.ProseMirror[contenteditable="true"]');
    if (composer && isVisible(composer)) {
      const signInCta = Array.from(document.querySelectorAll('button, a'))
        .some((node) => isVisible(node) && /^(sign in|log in)$/i.test((node.textContent || '').trim()));
      return !signInCta;
    }
    return false;
  })()`);
    return Boolean(result);
}

export async function getCurrentSessionId(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string') return '';
    const match = url.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1].toLowerCase() : '';
}

export async function getModelLabel(page) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const trigger = Array.from(document.querySelectorAll('button[aria-label="Model select"]'))
      .find((node) => isVisible(node));
    if (!trigger) return '';
    return (trigger.innerText || trigger.textContent || '').trim().split('\\n')[0].trim();
  })()`);
    return typeof result === 'string' ? result : '';
}

export async function getMessageBubbles(page) {
    // Grok marks each turn with `[data-testid="user-message"]` or
    // `[data-testid="assistant-message"]`. Their nearest ancestor with an
    // `id="response-<uuid>"` is a stable per-turn ID we can use for polling
    // dedupe. The older `div.message-bubble` selector still matches but does
    // not distinguish role on its own.
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const findResponseId = (node) => {
      let parent = node.parentElement;
      while (parent && parent !== document.body) {
        const id = parent.getAttribute('id') || '';
        if (id.startsWith('response-')) return id.slice('response-'.length);
        parent = parent.parentElement;
      }
      return '';
    };
    const bubbles = Array.from(document.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]'))
      .filter((node) => node instanceof HTMLElement && isVisible(node));
    const out = [];
    let positional = 0;
    for (const node of bubbles) {
      const isAssistant = node.getAttribute('data-testid') === 'assistant-message';
      const responseId = findResponseId(node);
      const baseId = responseId || ('pos-' + positional);
      const id = baseId + (isAssistant ? '-assistant' : '-user');
      positional += 1;
      const html = node.innerHTML || '';
      const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      out.push({ id, role: isAssistant ? 'Assistant' : 'User', text, html });
    }
    return out;
  })()`);
    if (!Array.isArray(result)) return [];
    return result
        .map((item) => ({
            id: String(item?.id || ''),
            role: item?.role === 'Assistant' ? 'Assistant' : 'User',
            text: String(item?.text || '').trim(),
            html: String(item?.html || ''),
        }))
        // User turns are always non-empty; an Assistant turn may legitimately
        // hold only an image / non-text widget (text empty, html populated).
        // Keep entries with either text OR html so image-only turns are not
        // silently dropped from `read` / `detail`.
        .filter((item) => item.id && (item.text || item.html));
}

export function bubbleHtmlToMarkdown(html) {
    try {
        return htmlToMarkdown(html).trim();
    } catch {
        return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
}

export async function getHistoryFromSidebar(page, limit) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const re = /^\\/c\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
    const seen = new Set();
    const out = [];
    const anchors = Array.from(document.querySelectorAll('a[href^="/c/"]'));
    for (const a of anchors) {
      if (!(a instanceof HTMLElement) || !isVisible(a)) continue;
      const href = a.getAttribute('href') || '';
      const m = href.match(re);
      if (!m) continue;
      const id = m[1].toLowerCase();
      if (seen.has(id)) continue;
      const title = (a.innerText || a.textContent || '').trim();
      // Sidebar renders the conversation title in one anchor and a separate
      // icon-only anchor for hover affordances. Keep the first occurrence with
      // a non-empty title; if the icon anchor wins the DOM order, fall back to
      // the second pass below.
      seen.add(id);
      out.push({ id, title });
    }
    // Second pass: backfill empty titles from later anchors with the same id.
    const titleById = new Map(out.map((entry) => [entry.id, entry.title]));
    for (const a of anchors) {
      if (!(a instanceof HTMLElement) || !isVisible(a)) continue;
      const href = a.getAttribute('href') || '';
      const m = href.match(re);
      if (!m) continue;
      const id = m[1].toLowerCase();
      const title = (a.innerText || a.textContent || '').trim();
      if (title && !titleById.get(id)) {
        titleById.set(id, title);
      }
    }
    return out.map((entry) => ({ id: entry.id, title: titleById.get(entry.id) || entry.title }));
  })()`);
    if (!Array.isArray(result)) return [];
    const sliced = result.slice(0, limit);
    return sliced.map((item) => ({
        id: String(item?.id || ''),
        title: String(item?.title || ''),
    }));
}

export async function startNewChat(page) {
    // Grok's "new chat" path is just a navigation back to the homepage —
    // there is no dedicated button in the current UI.
    await page.goto(GROK_URL);
    await page.wait(2);
}

export async function sendMessage(page, prompt) {
    const promptJson = JSON.stringify(prompt);
    return await page.evaluate(`(async () => {
    const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const composerSelector = '.ProseMirror[contenteditable="true"]';
    let composer = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = document.querySelector(composerSelector);
      if (candidate instanceof HTMLElement) { composer = candidate; break; }
      await waitFor(500);
    }
    if (!(composer instanceof HTMLElement)) {
      return { ok: false, reason: 'Grok composer (.ProseMirror) was not found on grok.com.' };
    }
    const editor = composer.editor;
    if (!editor || !editor.commands || typeof editor.commands.focus !== 'function' || typeof editor.commands.insertContent !== 'function') {
      return { ok: false, reason: 'Grok composer editor API was unavailable (page may still be loading).' };
    }
    try {
      if (typeof editor.commands.clearContent === 'function') editor.commands.clearContent();
      editor.commands.focus();
      editor.commands.insertContent(${promptJson});
    } catch (error) {
      return {
        ok: false,
        reason: 'Failed to insert the prompt into the Grok composer.',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    const isClickableSubmit = (node) => {
      if (!(node instanceof HTMLButtonElement)) return false;
      if (node.disabled) return false;
      const style = window.getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    let submit = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = Array.from(document.querySelectorAll('button[aria-label="Submit"]')).find(isClickableSubmit);
      if (candidate instanceof HTMLButtonElement) { submit = candidate; break; }
      await waitFor(500);
    }
    if (!(submit instanceof HTMLButtonElement)) {
      return { ok: false, reason: 'Grok submit button did not reach a clickable state after prompt insertion.' };
    }
    submit.click();
    return { ok: true };
  })()`);
}

const POLL_INTERVAL_SECONDS = 2;
const MIN_WAIT_MS = 6_000;
const STABLE_POLLS_REQUIRED = 2;

function stripNoise(text) {
    return (text || '')
        .replace(/\u00a0/g, ' ')
        .trim();
}

export async function waitForAnswer(page, prompt, timeoutSeconds, baselineLastAssistantId) {
    const startTime = Date.now();
    let previousText = '';
    let stableCount = 0;
    let lastCandidate = '';
    while (Date.now() - startTime < timeoutSeconds * 1000) {
        await page.wait(POLL_INTERVAL_SECONDS);
        const bubbles = await getMessageBubbles(page);
        const lastAssistant = [...bubbles].reverse().find((b) => b.role === 'Assistant');
        if (!lastAssistant) continue;
        // Skip stale assistant turns from before our send: if the latest
        // assistant ID matches the baseline, the new reply hasn't arrived yet.
        if (baselineLastAssistantId && lastAssistant.id === baselineLastAssistantId) continue;
        const text = stripNoise(lastAssistant.text);
        if (!text || text === prompt.trim()) continue;
        lastCandidate = text;
        const waitedLongEnough = Date.now() - startTime >= MIN_WAIT_MS;
        if (text === previousText) {
            stableCount += 1;
            if (waitedLongEnough && stableCount >= STABLE_POLLS_REQUIRED) {
                return { status: 'ok', assistant: lastAssistant };
            }
        } else {
            previousText = text;
            stableCount = 0;
        }
    }
    if (lastCandidate) {
        const bubbles = await getMessageBubbles(page);
        const lastAssistant = [...bubbles].reverse().find((b) => b.role === 'Assistant');
        return { status: 'partial', assistant: lastAssistant };
    }
    return { status: 'timeout' };
}

export const __test__ = {
    GROK_SESSION_ID_RE,
};
