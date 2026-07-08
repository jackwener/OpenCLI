import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';

export const YUANBAO_DOMAIN = 'yuanbao.tencent.com';
export const YUANBAO_URL = 'https://yuanbao.tencent.com/';
const SESSION_HINT = 'Likely login/auth/challenge/session issue in the existing yuanbao.tencent.com browser session.';

const AGENT_ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const CONV_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reusable visibility check for injected browser scripts.
 * Embed in page.evaluate strings via `${IS_VISIBLE_JS}`.
 */
export const IS_VISIBLE_JS = `const isVisible = (node) => {
  if (!(node instanceof HTMLElement)) return false;
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  return rect.width > 0
    && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden';
};`;

export function authRequired(message) {
    return new AuthRequiredError(YUANBAO_DOMAIN, `${message} ${SESSION_HINT}`);
}

export function normalizeBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value == null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export async function isOnYuanbao(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string' || !url) return false;
    try {
        const hostname = new URL(url).hostname;
        return hostname === YUANBAO_DOMAIN || hostname.endsWith(`.${YUANBAO_DOMAIN}`);
    } catch {
        return false;
    }
}

export async function ensureYuanbaoPage(page) {
    if (!(await isOnYuanbao(page))) {
        await page.goto(YUANBAO_URL, { waitUntil: 'load', settleMs: 2500 });
        await page.wait(1);
    }
}

export async function hasLoginGate(page) {
    const result = await page.evaluate(`(() => {
    const bodyText = document.body.innerText || '';
    const hasWechatLoginText = bodyText.includes('微信扫码登录');
    const hasWechatIframe = Array.from(document.querySelectorAll('iframe'))
      .some((frame) => (frame.getAttribute('src') || '').includes('open.weixin.qq.com/connect/qrconnect'));

    return hasWechatLoginText || hasWechatIframe;
  })()`);
    return Boolean(result);
}

export async function isLoggedIn(page) {
    return !(await hasLoginGate(page));
}

/**
 * Extract Yuanbao session identity from a raw input.
 *
 * Yuanbao chat URLs are `/chat/<agentId>/<convId>`. Both parts are required
 * to navigate — there is no stable default agentId we can fall back to. So we
 * only accept inputs that resolve a complete `{agentId, convId}` pair:
 *   - full `https://yuanbao.tencent.com/chat/<agentId>/<convId>` URL
 *   - bare slash form `<agentId>/<convId>`
 *
 * A bare convId UUID is rejected with an actionable message — opening the
 * wrong agent silently is a much worse failure mode than throwing.
 *
 * The trailing `(?:[/?#]|$)` boundary in the URL regex prevents over-long
 * suffixes (e.g. `<id>extra`) from silently truncating to a valid-looking ID.
 */
export function parseYuanbaoSessionId(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
        throw new ArgumentError(
            'id',
            'must be a non-empty Yuanbao chat URL or "<agentId>/<convId>" pair',
        );
    }
    const urlMatch = raw.match(/yuanbao\.tencent\.com\/chat\/([A-Za-z0-9_-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i);
    if (urlMatch) {
        const [, agentId, convId] = urlMatch;
        if (!AGENT_ID_RE.test(agentId) || !CONV_ID_RE.test(convId)) {
            throw new ArgumentError(
                'id',
                `not a valid Yuanbao chat URL (got "${input}"); expected https://yuanbao.tencent.com/chat/<agentId>/<convId>`,
            );
        }
        return { agentId, convId: convId.toLowerCase() };
    }
    const slashMatch = raw.match(/^([A-Za-z0-9_-]+)\/([0-9a-f-]{36})$/i);
    if (slashMatch) {
        const [, agentId, convId] = slashMatch;
        if (!AGENT_ID_RE.test(agentId) || !CONV_ID_RE.test(convId)) {
            throw new ArgumentError(
                'id',
                `not a valid Yuanbao "<agentId>/<convId>" pair (got "${input}"); agentId must be 4-40 word chars, convId must be a UUID`,
            );
        }
        return { agentId, convId: convId.toLowerCase() };
    }
    throw new ArgumentError(
        'id',
        `not a valid Yuanbao session reference (got "${input}"); pass either a full https://yuanbao.tencent.com/chat/<agentId>/<convId> URL or a bare "<agentId>/<convId>" pair. A UUID alone is not enough — Yuanbao requires the agentId.`,
    );
}

export async function getCurrentYuanbaoSessionId(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string') return null;
    const match = url.match(/yuanbao\.tencent\.com\/chat\/([A-Za-z0-9_-]+)\/([0-9a-f-]{36})(?:[/?#]|$)/i);
    if (!match) return null;
    const [, agentId, convId] = match;
    if (!AGENT_ID_RE.test(agentId) || !CONV_ID_RE.test(convId)) return null;
    return { agentId, convId: convId.toLowerCase() };
}

export async function getYuanbaoModelLabel(page) {
    const result = await page.evaluate(`(() => {
    const btn = document.querySelector('[dt-button-id="model_switch"]');
    if (!(btn instanceof HTMLElement)) return null;
    const label = (btn.querySelector('.t-button__text')?.textContent || btn.textContent || '').trim();
    const modelId = btn.getAttribute('dt-model-id') || '';
    return { label, modelId };
  })()`);
    if (!result || typeof result !== 'object') return { label: null, modelId: null };
    return {
        label: typeof result.label === 'string' && result.label ? result.label : null,
        modelId: typeof result.modelId === 'string' && result.modelId ? result.modelId : null,
    };
}

/**
 * Read the current conversation transcript as `{id, role, text, html}` rows.
 *
 * Each `.agent-chat__list__item` carries `data-conv-id` (`<convId>_<idx>`),
 * `data-conv-speaker` (`human`/`ai`), and `data-conv-idx`. We use those as the
 * stable per-turn identity so polling/dedup logic in `ask` stays correct after
 * future re-renders.
 *
 * Image-only assistant turns may have empty visible text; we keep them when
 * `html` is non-empty so callers can render images downstream.
 */
export async function getYuanbaoMessageBubbles(page) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const items = Array.from(document.querySelectorAll('.agent-chat__list__item--human, .agent-chat__list__item--ai'))
      .filter((node) => isVisible(node));
    return items.map((node, positional) => {
      const isAi = node.classList.contains('agent-chat__list__item--ai');
      const role = isAi ? 'Assistant' : 'User';
      const id = node.getAttribute('data-conv-id') || ('pos-' + positional + (isAi ? '-ai' : '-human'));
      const idx = Number(node.getAttribute('data-conv-idx') || positional + 1);
      const contentNode = isAi
        ? (node.querySelector('.hyc-content-md-done')
          || node.querySelector('.hyc-content-md')
          || node.querySelector('.agent-chat__speech-text')
          || node.querySelector('.agent-chat__bubble__content'))
        : (node.querySelector('.hyc-component-text .hyc-content-text')
          || node.querySelector('.hyc-content-text')
          || node.querySelector('.agent-chat__bubble__content'));
      const html = contentNode instanceof HTMLElement ? (contentNode.innerHTML || '') : '';
      const rawText = contentNode instanceof HTMLElement
        ? (contentNode.innerText || contentNode.textContent || '')
        : ((node.innerText || node.textContent) || '');
      return {
        id,
        idx,
        role,
        text: String(rawText || '').replace(/\\u00a0/g, ' ').trim(),
        html,
      };
    });
  })()`);
    if (!Array.isArray(result)) return [];
    return result
        .map((item) => ({
            id: String(item?.id || ''),
            idx: Number.isInteger(item?.idx) ? item.idx : 0,
            role: item?.role === 'Assistant' ? 'Assistant' : 'User',
            text: String(item?.text || '').trim(),
            html: String(item?.html || ''),
        }))
        .filter((item) => item.id && (item.text || item.html));
}

/**
 * Enumerate sidebar conversation entries.
 *
 * Each `.yb-recent-conv-list__item` exposes:
 *   - `dt-cid`     — conversation UUID
 *   - `dt-agent-id`— agent slug
 *   - `[data-item-name]` — display title
 *
 * We do NOT trigger sidebar virtual scroll here — Yuanbao loads the visible
 * window only, so callers requesting a higher `limit` than the rendered count
 * get whatever is currently rendered. That matches Yuanbao's own UX.
 */
export async function getYuanbaoSessionList(page, limit) {
    const cap = Number(limit ?? 20);
    if (!Number.isInteger(cap) || cap <= 0) {
        throw new ArgumentError('limit', 'must be a positive integer');
    }
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const nodes = Array.from(document.querySelectorAll('.yb-recent-conv-list__item'))
      .filter((node) => isVisible(node));
    return nodes.map((node) => {
      const cid = node.getAttribute('dt-cid') || '';
      const agentId = node.getAttribute('dt-agent-id') || '';
      const titleEl = node.querySelector('[data-item-name]');
      const title = (titleEl?.getAttribute('data-item-name') || titleEl?.textContent || '').trim();
      return { cid, agentId, title };
    });
  })()`);
    if (!Array.isArray(result)) return [];
    return result
        .map((item) => ({
            cid: String(item?.cid || '').toLowerCase(),
            agentId: String(item?.agentId || ''),
            title: String(item?.title || '').trim(),
        }))
        .filter((item) => CONV_ID_RE.test(item.cid) && AGENT_ID_RE.test(item.agentId))
        .slice(0, cap);
}

export async function startNewYuanbaoChat(page) {
    await ensureYuanbaoPage(page);
    if (await hasLoginGate(page)) return 'blocked';
    const beforeUrl = await page.evaluate('window.location.href').catch(() => '');
    const action = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const trigger = Array.from(document.querySelectorAll('.yb-common-nav__trigger[data-desc="new-chat"], [dt-button-id="new_temp_chat"]'))
      .find((node) => isVisible(node));
    if (trigger instanceof HTMLElement) {
      trigger.click();
      return 'clicked';
    }
    return 'navigate';
  })()`);
    if (action === 'navigate') {
        await page.goto(YUANBAO_URL, { waitUntil: 'load', settleMs: 2500 });
        await page.wait(1);
        return (await hasLoginGate(page)) ? 'blocked' : 'navigate';
    }
    await page.wait(1);
    if (await hasLoginGate(page)) return 'blocked';
    const afterUrl = await page.evaluate('window.location.href').catch(() => '');
    if (typeof afterUrl === 'string' && typeof beforeUrl === 'string' && afterUrl !== beforeUrl) {
        return 'clicked';
    }
    // Click had no observable effect — fall back to homepage navigation.
    await page.goto(YUANBAO_URL, { waitUntil: 'load', settleMs: 2500 });
    await page.wait(1);
    return 'navigate';
}

/**
 * Drive the Quill composer to insert `prompt` and click the send button.
 *
 * Yuanbao toggles the send button between `style__send-btn___*` (enabled) and
 * `style__send-btn--disabled___*` based on a debounced React re-render after
 * the composer's input event. A naive 200ms wait races that re-render — the
 * button is still `--disabled` at click time, the click is a no-op, and
 * Enter-key fallback in Quill does not always submit. We poll the
 * disabled-state for up to ~3s and only fall back to Enter when the React
 * update never arrives.
 *
 * Returns `{ok: true, action}` or `{ok: false, reason, detail?}`.
 */
export async function sendYuanbaoMessage(page, prompt) {
    return await page.evaluate(`(async () => {
    const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    ${IS_VISIBLE_JS}

    const composer = Array.from(document.querySelectorAll('.ql-editor[contenteditable="true"], .ql-editor, [contenteditable="true"]'))
      .find(isVisible);

    if (!(composer instanceof HTMLElement)) {
      return {
        ok: false,
        reason: 'Yuanbao composer was not found.',
      };
    }

    try {
      composer.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      composer.textContent = '';
      document.execCommand('insertText', false, ${JSON.stringify(prompt)});
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(prompt)}, inputType: 'insertText' }));
    } catch (error) {
      return {
        ok: false,
        reason: 'Failed to insert the prompt into the Yuanbao composer.',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const findEnabledSubmit = () => Array.from(document.querySelectorAll('a[class*="send-btn"], button[class*="send-btn"]'))
      .find((node) => {
        if (!(node instanceof HTMLElement) || !isVisible(node)) return false;
        const className = typeof node.className === 'string' ? node.className : '';
        return !className.includes('send-btn--disabled') && !className.includes('disabled');
      });

    let submit = null;
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      submit = findEnabledSubmit();
      if (submit) break;
      await waitFor(150);
    }

    if (submit instanceof HTMLElement) {
      submit.click();
      return { ok: true, action: 'click' };
    }

    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return { ok: true, action: 'enter' };
  })()`);
}
