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

// Model picker trigger has stable id="model-select-trigger". Use that as the
// primary selector — aria-label localizes (e.g. "Model select" in English,
// "模型选择" in Chinese, etc.) and is unreliable across browser locales.
const MODEL_TRIGGER_SELECTORS = [
    '#model-select-trigger',
    'button[aria-label="Model select"]',
    'button[aria-label="模型选择"]',
    'button[aria-label="モデル選択"]',
];

export async function getModelLabel(page) {
    const selectorJson = JSON.stringify(MODEL_TRIGGER_SELECTORS);
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const selectors = ${selectorJson};
    let trigger = null;
    for (const sel of selectors) {
      trigger = Array.from(document.querySelectorAll(sel)).find((node) => isVisible(node));
      if (trigger) break;
    }
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

// Open the sidebar conversation context menu (right-click on the /c/<id>
// link), wait for it to appear, click the menu item whose visible text
// matches one of the localized labels. Returns whether the click happened.
//
// Menu items observed on grok.com (2026-05-31):
//   "打开新标签页" / "Open in new tab"
//   "重命名"     / "Rename"
//   "置顶" or "取消置顶" / "Pin" or "Unpin"
//   "删除"       / "Delete"
//
// Grok's delete action takes effect IMMEDIATELY — no confirmation dialog —
// so callers must enforce their own --yes / dry-run gating.
export async function clickConversationMenuItem(page, conversationId, labelOptions) {
    const id = String(conversationId).toLowerCase();
    const idJson = JSON.stringify(id);
    const labelsJson = JSON.stringify(labelOptions.map((l) => l.toLowerCase()));
    return await page.evaluate(`(async () => {
    const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const id = ${idJson};
    const labels = ${labelsJson};
    // Find the sidebar anchor for this conversation.
    let link = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      link = Array.from(document.querySelectorAll('a[href^="/c/"]'))
        .find((a) => a instanceof HTMLElement && a.offsetParent && (a.getAttribute('href') || '').toLowerCase().includes(id));
      if (link) break;
      await waitFor(300);
    }
    if (!link) {
      return { ok: false, reason: 'Conversation not found in sidebar.', detail: 'id=' + id };
    }
    // Trigger the radix context menu — radix listens to PointerEvent +
    // contextmenu, so plain MouseEvent('contextmenu') alone is ignored.
    // Dispatch the full sequence pointerdown/mousedown/contextmenu/pointerup/mouseup
    // with right-button state to mirror a real right-click.
    {
      const rect = link.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: Math.round(rect.left + Math.min(rect.width / 2, 16)),
        clientY: Math.round(rect.top + Math.min(rect.height / 2, 16)),
      };
      link.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
      link.dispatchEvent(new MouseEvent('mousedown', init));
      link.dispatchEvent(new MouseEvent('contextmenu', init));
      link.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
      link.dispatchEvent(new MouseEvent('mouseup', init));
    }
    // Wait for menu items to appear.
    let items = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      items = Array.from(document.querySelectorAll('[role="menuitem"]'))
        .filter((it) => it instanceof HTMLElement && it.offsetParent);
      if (items.length) break;
      await waitFor(150);
    }
    if (!items.length) {
      return { ok: false, reason: 'Context menu did not open for the conversation.' };
    }
    const target = items.find((it) => {
      const text = (it.textContent || '').trim().toLowerCase();
      return labels.some((l) => text === l);
    });
    if (!target) {
      return {
        ok: false,
        reason: 'No menu item matched the requested label.',
        detail: 'available=' + JSON.stringify(items.map((it) => (it.textContent || '').trim())),
      };
    }
    target.click();
    return { ok: true, clicked: (target.textContent || '').trim() };
  })()`);
}

export function getPinStateFromMenuLabels(labels) {
    const normalized = (Array.isArray(labels) ? labels : [])
        .map((label) => String(label || '').trim().toLowerCase())
        .filter(Boolean);
    if (normalized.some((label) => label === '取消置顶' || label === 'unpin')) {
        return 'pinned';
    }
    if (normalized.some((label) => label === '置顶' || label === 'pin')) {
        return 'unpinned';
    }
    return '';
}

export async function isConversationVisibleInSidebar(page, conversationId) {
    const id = String(conversationId).toLowerCase();
    const idJson = JSON.stringify(id);
    const result = await page.evaluate(`(() => {
    const id = ${idJson};
    return Array.from(document.querySelectorAll('a[href^="/c/"]'))
      .some((a) => a instanceof HTMLElement && a.offsetParent && (a.getAttribute('href') || '').toLowerCase().includes(id));
  })()`);
    return Boolean(result);
}

export async function waitForConversationToDisappear(page, conversationId, timeoutMs = 5_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (!(await isConversationVisibleInSidebar(page, conversationId))) return true;
        await page.wait(0.25);
    }
    return !(await isConversationVisibleInSidebar(page, conversationId));
}

export async function readConversationMenuLabels(page, conversationId) {
    const id = String(conversationId).toLowerCase();
    const idJson = JSON.stringify(id);
    const result = await page.evaluate(`(async () => {
    const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const id = ${idJson};
    let link = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      link = Array.from(document.querySelectorAll('a[href^="/c/"]'))
        .find((a) => a instanceof HTMLElement && a.offsetParent && (a.getAttribute('href') || '').toLowerCase().includes(id));
      if (link) break;
      await waitFor(300);
    }
    if (!link) {
      return { ok: false, reason: 'Conversation not found in sidebar.', detail: 'id=' + id, labels: [] };
    }
    const rect = link.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, button: 2, buttons: 2,
      clientX: Math.round(rect.left + Math.min(rect.width / 2, 16)),
      clientY: Math.round(rect.top + Math.min(rect.height / 2, 16)),
    };
    link.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    link.dispatchEvent(new MouseEvent('mousedown', init));
    link.dispatchEvent(new MouseEvent('contextmenu', init));
    link.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    link.dispatchEvent(new MouseEvent('mouseup', init));

    let items = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      items = Array.from(document.querySelectorAll('[role="menuitem"]'))
        .filter((it) => it instanceof HTMLElement && it.offsetParent);
      if (items.length) break;
      await waitFor(150);
    }
    const labels = items.map((it) => (it.textContent || '').trim()).filter(Boolean);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return items.length
      ? { ok: true, labels }
      : { ok: false, reason: 'Context menu did not open for the conversation.', labels: [] };
  })()`);
    try {
        await page.keys('Escape');
    } catch {
        // Best-effort cleanup; some fake pages and browser adapters do not expose keys().
    }
    if (!result || typeof result !== 'object') {
        return { ok: false, reason: 'Malformed context-menu result.', labels: [] };
    }
    return {
        ok: Boolean(result.ok),
        reason: String(result.reason || ''),
        detail: String(result.detail || ''),
        labels: Array.isArray(result.labels) ? result.labels.map((label) => String(label || '')) : [],
    };
}

export async function waitForConversationPinState(page, conversationId, expectedState, timeoutMs = 5_000) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
        last = await readConversationMenuLabels(page, conversationId);
        if (last.ok && getPinStateFromMenuLabels(last.labels) === expectedState) {
            return { ok: true, state: expectedState, labels: last.labels };
        }
        await page.wait(0.25);
    }
    last = await readConversationMenuLabels(page, conversationId);
    const state = last.ok ? getPinStateFromMenuLabels(last.labels) : '';
    return {
        ok: last.ok && state === expectedState,
        state,
        labels: last.labels || [],
        reason: last.reason || `Conversation did not reach ${expectedState} state.`,
        detail: last.detail || '',
    };
}

// After clickConversationMenuItem opens an inline rename input, fill it and
// commit by pressing Enter. Returns the new title we set (best-effort).
export async function fillRenameInputAndSubmit(page, newTitle) {
    const titleJson = JSON.stringify(newTitle);
    return await page.evaluate(`(async () => {
    const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let input = null;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      // The inline rename UI surfaces as a single visible <input> or a
      // contenteditable inside the sidebar row.
      input = Array.from(document.querySelectorAll('input[type="text"], [contenteditable="true"]:not(.ProseMirror)'))
        .find((el) => el instanceof HTMLElement && el.offsetParent && el.getBoundingClientRect().left < 260);
      if (input) break;
      await waitFor(200);
    }
    if (!input) {
      return { ok: false, reason: 'Inline rename input did not appear.' };
    }
    input.focus();
    if (input instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${titleJson});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // contenteditable path
      input.innerText = '';
      document.execCommand('insertText', false, ${titleJson});
    }
    // Commit by Enter (Grok accepts Enter to confirm, Escape to cancel).
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { ok: true, value: ${titleJson} };
  })()`);
}

export async function sendMessage(page, prompt) {
    const promptJson = JSON.stringify(prompt);
    return await page.evaluate(`(async () => {
    const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const composerSelector = '.ProseMirror[contenteditable="true"]';
    const isVisible = (node) => {
      if (!(node instanceof Element)) return false;
      const style = window.getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const responseIdFor = (node) => {
      let parent = node.parentElement;
      while (parent && parent !== document.body) {
        const id = parent.getAttribute('id') || '';
        if (id.startsWith('response-')) return id.slice('response-'.length);
        parent = parent.parentElement;
      }
      return '';
    };
    const userTurns = () => Array.from(document.querySelectorAll('[data-testid="user-message"]'))
      .filter((node) => node instanceof HTMLElement && isVisible(node))
      .map((node, index) => ({
        id: responseIdFor(node) || ('pos-' + index),
        text: normalize(node.innerText || node.textContent || ''),
      }))
      .filter((turn) => turn.text);
    const promptText = normalize(${promptJson});
    const beforeTurns = userTurns();
    const beforeKeys = new Set(beforeTurns.map((turn) => turn.id + '\\n' + turn.text));
    const waitForSubmittedUserTurn = async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const turns = userTurns();
        const latest = turns[turns.length - 1];
        const hasNewMatchingTurn = turns.some((turn) => turn.text === promptText && !beforeKeys.has(turn.id + '\\n' + turn.text));
        const appendedMatchingTurn = turns.length > beforeTurns.length && latest?.text === promptText;
        if (hasNewMatchingTurn || appendedMatchingTurn) return true;
        await waitFor(250);
      }
      return false;
    };
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
      return isVisible(node);
    };
    // Prefer data-testid (locale-independent); fall back to aria-label per
    // language. As of 2026-05-31 Grok renders button[data-testid="chat-submit"]
    // once the composer has content. The aria-label varies: "Submit" (en),
    // "提交" (zh-CN), and presumably other locales.
    const submitSelectors = [
      'button[data-testid="chat-submit"]',
      'button[aria-label="Submit"]',
      'button[aria-label="提交"]',
      'button[aria-label="送信"]',
    ];
    let submit = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      for (const sel of submitSelectors) {
        const candidate = Array.from(document.querySelectorAll(sel)).find(isClickableSubmit);
        if (candidate instanceof HTMLButtonElement) { submit = candidate; break; }
      }
      if (submit) break;
      await waitFor(500);
    }
    if (submit instanceof HTMLButtonElement) {
      submit.click();
      if (!(await waitForSubmittedUserTurn())) {
        return { ok: false, reason: 'Grok submit button was clicked but no new user turn appeared.' };
      }
      return { ok: true, submittedVia: 'submit-button' };
    }
    // Fallback: some Grok deployments / locales never surface a
    // submit-labelled button (see #1782); the composer commits on Enter
    // when there is no Shift modifier, and Tiptap honours the synthetic
    // keypress because the editor is focused. Dispatch a full keydown +
    // keypress + keyup chain so any modifier / IME listener stays
    // consistent with a real user pressing Enter.
    const dispatchEnter = (target) => {
      const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent('keydown', opts));
      target.dispatchEvent(new KeyboardEvent('keypress', opts));
      target.dispatchEvent(new KeyboardEvent('keyup', opts));
    };
    try {
      // Re-focus first; insertContent above may have moved focus elsewhere.
      editor.commands.focus();
      const focusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : composer;
      dispatchEnter(focusTarget);
      if (!(await waitForSubmittedUserTurn())) {
        return { ok: false, reason: 'Grok Enter-key fallback fired but no new user turn appeared.' };
      }
      return { ok: true, submittedVia: 'enter-key' };
    } catch (error) {
      return {
        ok: false,
        reason: 'Grok submit button never appeared and Enter-key fallback failed.',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
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
    getPinStateFromMenuLabels,
};
