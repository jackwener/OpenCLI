import { htmlToMarkdown } from '@jackwener/opencli/utils';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

export const QIANWEN_DOMAIN = 'www.qianwen.com';
export const QIANWEN_URL = 'https://www.qianwen.com/';
export const QIANWEN_API_DOMAIN = 'chat2-api.qianwen.com';

export const IS_VISIBLE_JS = `
  const isVisible = (node) => {
    if (!(node instanceof Element)) return false;
    const style = window.getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
`;

const POLL_INTERVAL_SECONDS = 2;
const MIN_WAIT_MS = 6_000;
const STABLE_POLLS_REQUIRED = 2;

export function authRequired(detail) {
    return new AuthRequiredError(QIANWEN_DOMAIN, detail || '请在浏览器里用千问 APP 扫码登录 qianwen.com 后再重试。');
}

export function normalizeBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value == null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export async function isOnQianwen(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    return typeof url === 'string' && url.includes('qianwen.com');
}

export async function ensureOnQianwen(page) {
    if (await isOnQianwen(page)) return;
    await page.goto(QIANWEN_URL);
    await page.wait(2);
}

export async function dismissLoginModal(page) {
    return await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const modal = document.querySelector('[role=alert-biz-modal]');
    if (!modal || !isVisible(modal)) return { dismissed: false };
    const close = modal.querySelector('[data-opencli-ref]:last-of-type')
      || modal.querySelector('svg')?.closest('[role=button], button, div[class*="close"]');
    const closeCandidates = Array.from(modal.querySelectorAll('div, button, span'))
      .filter((node) => node instanceof HTMLElement && isVisible(node))
      .filter((node) => {
        const cls = node.className || '';
        if (typeof cls !== 'string') return false;
        return /close|dismiss|cancel/i.test(cls) || node.getAttribute('aria-label') === '关闭';
      });
    const target = closeCandidates[0] || modal.querySelector('svg')?.parentElement;
    if (target instanceof HTMLElement) {
      target.click();
      return { dismissed: true };
    }
    // Last resort: synth ESC key on document
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    return { dismissed: true, method: 'escape' };
  })()`);
}

export async function hasLoginGate(page) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const modal = document.querySelector('[role=alert-biz-modal]');
    if (modal && isVisible(modal)) {
      const iframe = modal.querySelector('iframe');
      const src = iframe?.getAttribute('src') || '';
      if (src.includes('passport.qianwen.com') || src.includes('login')) return true;
    }
    return false;
  })()`);
    return Boolean(result);
}

export async function isLoggedIn(page) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const loginBtn = Array.from(document.querySelectorAll('button'))
      .find((node) => (node.textContent || '').trim() === '登录' && isVisible(node));
    if (loginBtn) return false;
    const hint = Array.from(document.querySelectorAll('p'))
      .find((node) => (node.textContent || '').includes('登录可同步历史对话'));
    if (hint && isVisible(hint)) return false;
    return true;
  })()`);
    return Boolean(result);
}

export async function getCurrentSessionId(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string') return '';
    const match = url.match(/\/chat\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : '';
}

const QIANWEN_SESSION_ID_RE = /^[a-f0-9]{32}$/i;

export function parseQianwenSessionId(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
        throw new ArgumentError('id', 'must be a non-empty session ID or qianwen.com chat URL');
    }
    // Anchor the right-hand side so a 33+ hex URL does not silently truncate
    // to its first 32 chars. Acceptable terminators: end-of-string, path slash,
    // query string, or fragment. Without the boundary,
    // `https://www.qianwen.com/chat/<33 hex>` would parse as a valid 32-char
    // ID instead of being rejected — opening the wrong conversation is a
    // worse failure mode than throwing.
    const urlMatch = raw.match(/qianwen\.com\/chat\/([a-f0-9]{32})(?:[/?#]|$)/i);
    const candidate = urlMatch ? urlMatch[1] : raw;
    if (!QIANWEN_SESSION_ID_RE.test(candidate)) {
        throw new ArgumentError(
            'id',
            `not a valid Qianwen session ID (got "${input}"); expected a 32-char hex ID like "abcd1234ef567890abcd1234ef567890" or a full https://www.qianwen.com/chat/<id> URL`,
        );
    }
    return candidate.toLowerCase();
}

export async function getModelLabel(page) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const trigger = Array.from(document.querySelectorAll('[aria-haspopup=dialog]'))
      .find((node) => isVisible(node) && (node.innerText || '').includes('Qwen'));
    if (!trigger) return '';
    const label = (trigger.innerText || '').split('\\n')[0].trim();
    return label;
  })()`);
    return typeof result === 'string' ? result : '';
}

export async function startNewChat(page) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const button = Array.from(document.querySelectorAll('button'))
      .find((node) => isVisible(node) && (node.innerText || '').trim() === '新建对话');
    if (button instanceof HTMLElement) {
      button.click();
      return { ok: true, method: 'button' };
    }
    return { ok: false };
  })()`);
    if (result?.ok) {
        await page.wait(1.5);
        return true;
    }
    await page.goto(QIANWEN_URL);
    await page.wait(2);
    return true;
}

export async function getComposer(page) {
    return await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const editor = Array.from(document.querySelectorAll('[role=textbox][contenteditable=true]'))
      .find((node) => isVisible(node));
    return { found: !!editor, text: editor?.textContent || '' };
  })()`);
}

export async function sendMessage(page, prompt) {
    return await page.evaluate(`(async () => {
    ${IS_VISIBLE_JS}
    const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const editor = Array.from(document.querySelectorAll('[role=textbox][contenteditable=true]'))
      .find((node) => isVisible(node));
    if (!(editor instanceof HTMLElement)) {
      return { ok: false, reason: 'Qianwen composer (contenteditable) not found.' };
    }

    editor.focus();
    // Clear existing content first
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('delete', false);
    await waitFor(100);

    // Slate editor accepts content via beforeinput InputEvent
    editor.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: ${JSON.stringify(prompt)},
      bubbles: true,
      cancelable: true,
    }));
    await waitFor(400);

    const sendBtn = document.querySelector('button[aria-label="发送消息"]');
    if (sendBtn instanceof HTMLElement && !sendBtn.disabled) {
      sendBtn.click();
      return { ok: true, action: 'click' };
    }

    // Fallback: dispatch Enter key
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return { ok: true, action: 'enter-fallback' };
  })()`);
}

export async function getMessageBubbles(page) {
    // Qianwen's chat DOM marks each turn with two siblings:
    //   [data-chat-question-wrap]  - user message
    //   [data-chat-answers-wrap]   - assistant message
    // The earlier `[data-msgid]` selector matched citation cards inside
    // assistant responses (which use `data-message-id`), so it would silently
    // miss the actual chat turns after Qianwen reshipped its frontend.
    //
    // We walk both wrap selectors in DOM order to interleave Q/A correctly,
    // and use the nearest sibling `data-req-id` (anchored on
    // `.chat-msg-bottom-anchor`) as the stable per-turn identifier so polling
    // dedupe + waitForAnswer's seenAssistantId tracking still work.
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    const wraps = Array.from(document.querySelectorAll('[data-chat-question-wrap], [data-chat-answers-wrap]'))
      .filter((node) => node instanceof HTMLElement && isVisible(node));

    const findTurnReqId = (node) => {
      let parent = node.parentElement;
      while (parent && parent !== document.body) {
        const reqEl = parent.querySelector('[data-req-id]');
        if (reqEl && reqEl.getAttribute('data-req-id')) {
          return reqEl.getAttribute('data-req-id');
        }
        parent = parent.parentElement;
      }
      return '';
    };

    const out = [];
    let positional = 0;
    for (const node of wraps) {
      const isAnswer = node.hasAttribute('data-chat-answers-wrap');
      const reqId = findTurnReqId(node);
      const baseId = reqId || ('pos-' + positional);
      const id = baseId + (isAnswer ? '-answer' : '-question');
      positional += 1;

      const contentNode = isAnswer
        ? (node.querySelector('#qk-markdown-react') || node.querySelector('[class*="markdown"]') || node)
        : node;
      const html = (contentNode instanceof HTMLElement) ? (contentNode.innerHTML || '') : '';
      const text = (contentNode instanceof HTMLElement) ? (contentNode.innerText || contentNode.textContent || '') : '';
      const role = isAnswer ? 'Assistant' : 'User';
      out.push({ id, role, text: (text || '').replace(/\\s+/g, ' ').trim(), html });
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
        .filter((item) => item.id && item.text);
}

export function bubbleHtmlToMarkdown(html) {
    try {
        return htmlToMarkdown(html).trim();
    } catch {
        return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
}

function stripNoise(text) {
    return (text || '')
        .replace(/\u00a0/g, ' ')
        .replace(/复制\s*$/g, '')
        .replace(/重新生成\s*$/g, '')
        .trim();
}

export async function waitForAnswer(page, prompt, timeoutSeconds) {
    const startTime = Date.now();
    let previousText = '';
    let stableCount = 0;
    let lastCandidate = '';
    let seenAssistantId = '';

    while (Date.now() - startTime < timeoutSeconds * 1000) {
        await page.wait(POLL_INTERVAL_SECONDS);

        if (await hasLoginGate(page)) {
            return { status: 'auth_required' };
        }

        const bubbles = await getMessageBubbles(page);
        const lastAssistant = [...bubbles].reverse().find((b) => b.role === 'Assistant');
        if (!lastAssistant) continue;

        const text = stripNoise(lastAssistant.text);
        if (!text || text === prompt) continue;

        if (!seenAssistantId) seenAssistantId = lastAssistant.id;
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

const FEATURE_LABELS = {
    think: '深度思考',
    research: '深度研究',
    task: '任务助理',
    image: 'AI生图',
    ppt: 'PPT创作',
};

export async function setFeatureToggle(page, feature, enabled) {
    const label = FEATURE_LABELS[feature];
    if (!label) return false;
    const result = await page.evaluate(`(async () => {
    ${IS_VISIBLE_JS}
    const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const label = ${JSON.stringify(label)};
    const button = Array.from(document.querySelectorAll('button[aria-label]'))
      .find((node) => isVisible(node) && node.getAttribute('aria-label') === label);
    if (!(button instanceof HTMLElement)) return { found: false };
    const selected = button.getAttribute('aria-pressed') === 'true'
      || /active|selected|bg-primary/.test(button.className || '');
    if (selected === ${Boolean(enabled)}) return { found: true, changed: false, selected };
    button.click();
    await waitFor(300);
    return { found: true, changed: true };
  })()`);
    return Boolean(result?.found);
}

export async function getSessionListFromApi(page, limit = 30) {
    const pageSize = Number(limit ?? 30);
    if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 100) {
        throw new CommandExecutionError('Qianwen history page_size must be an integer between 1 and 100');
    }
    const result = await page.evaluate(`(async () => {
    try {
      const utdid = (document.cookie.match(/(?:^|;\\s*)b-user-id=([^;]+)/)?.[1])
        || (document.cookie.match(/(?:^|;\\s*)utdid=([^;]+)/)?.[1])
        || '';
      const query = new URLSearchParams({
        biz_id: 'ai_qwen',
        chat_client: 'h5',
        device: 'pc',
        fr: 'pc',
        pr: 'qwen',
        ut: utdid,
        la: 'zh-CN',
        tz: 'Asia/Shanghai',
        ve: '2.4.9',
      }).toString();
      const res = await fetch('https://${QIANWEN_API_DOMAIN}/api/v2/session/page/list?' + query, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_num: 1, page_size: ${pageSize}, page_no: 1 }),
      });
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      return { ok: res.ok, status: res.status, body, utdid };
    } catch (error) {
      return { ok: false, status: 0, error: String(error?.message || error) };
    }
  })()`);
    if (!result || !result.ok) {
        return { ok: false, status: result?.status || 0, error: result?.error || '', sessions: [] };
    }
    const data = result.body?.data || result.body?.result || {};
    const rawList = Array.isArray(data?.list) ? data.list
        : Array.isArray(data?.items) ? data.items
            : Array.isArray(data?.page_list) ? data.page_list
                : Array.isArray(result.body?.list) ? result.body.list
                    : [];
    const sessions = rawList.map((item) => ({
        id: String(item?.session_id || item?.sessionId || item?.id || ''),
        title: String(item?.title || item?.name || item?.summary || '').trim(),
        updated_at: Number(item?.updated_at || item?.last_req_timestamp || item?.updatedAt || item?.gmt_modified || item?.update_time || 0),
    })).filter((item) => item.id);
    return { ok: true, status: result.status, sessions };
}
