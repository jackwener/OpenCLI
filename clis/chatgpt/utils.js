/**
 * ChatGPT web browser automation helpers.
 * Cross-platform: works on Linux/macOS/Windows via OpenCLI's CDP browser automation.
 */

import { htmlToMarkdown } from '@jackwener/opencli/utils';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

export const CHATGPT_DOMAIN = 'chatgpt.com';
export const CHATGPT_URL = 'https://chatgpt.com';

const CHATGPT_MODEL_TARGETS = {
    fast: {
        label: 'Fast',
        labels: ['Fast', 'Speed', 'Instant', '极速', '即时'],
        optionLabels: ['Fast', 'Speed', 'Instant', '极速', '即时'],
        testIds: ['model-switcher-gpt-5-5'],
        intelligenceOrder: 0,
        aliases: ['speed', 'instant', '极速'],
    },
    balanced: {
        label: 'Balanced',
        labels: ['Balanced', 'Balance', 'Medium', '均衡'],
        optionLabels: ['Balanced', 'Balance', 'Medium', '均衡'],
        testIds: [],
        intelligenceOrder: 1,
        aliases: ['balance', 'medium', '均衡'],
    },
    advanced: {
        label: 'Advanced',
        labels: ['Advanced', 'High', 'Thinking', '高级', '思考'],
        optionLabels: ['Advanced', 'High', 'Thinking', '高级', '思考'],
        testIds: ['model-switcher-gpt-5-5-thinking'],
        intelligenceOrder: 2,
        aliases: ['high', 'thinking', '高级'],
        modelConfig: { modelSlug: 'gpt-5-5-thinking', effort: 'extended' },
    },
    'very-high': {
        label: 'Very High',
        labels: ['Very High', 'Extra High', 'Ultra', 'XHigh', 'X-High', '超高'],
        optionLabels: ['Very High', 'Extra High', 'Ultra', 'XHigh', 'X-High', '超高'],
        testIds: [],
        intelligenceOrder: 3,
        aliases: ['ultra', 'xhigh', 'x-high', 'extra-high', '超高'],
    },
    pro: {
        label: 'Pro',
        labels: ['Pro', 'Professional', '进阶专业', '专业'],
        optionLabels: ['专业', 'Pro', 'Professional', '进阶专业'],
        testIds: ['model-switcher-gpt-5-5-pro'],
        intelligenceOrder: 4,
        aliases: ['professional', '专业'],
        modelConfig: { modelSlug: 'gpt-5-5-pro', effort: 'standard' },
    },
};
const CHATGPT_MODEL_ALIASES = Object.fromEntries(Object.entries(CHATGPT_MODEL_TARGETS).flatMap(([key, target]) => [
    [key, key],
    ...(target.aliases || []).map((alias) => [String(alias).toLowerCase(), key]),
]));
export const CHATGPT_MODEL_CHOICES = Object.keys(CHATGPT_MODEL_ALIASES);

function debugChatGPTModel(message) {
    if (process?.env?.OPENCLI_CHATGPT_MODEL_DEBUG) {
        console.error(`[chatgpt/model] ${message}`);
    }
}

const CHATGPT_TOOL_OPTIONS = {
    'deep-research': { label: 'Deep Research', labels: ['深度研究', 'Deep Research'] },
    'web-search': { label: 'Web Search', labels: ['网页搜索', '搜索', 'Web Search', 'Search'] },
};
export const CHATGPT_TOOL_CHOICES = Object.keys(CHATGPT_TOOL_OPTIONS);

// Selectors
const COMPOSER_SELECTORS = [
    '[contenteditable="true"][role="textbox"]',
    '#prompt-textarea[contenteditable="true"]',
    '[aria-label="Chat with ChatGPT"]',
    '[aria-label="与 ChatGPT 聊天"]',
    '[placeholder="Ask anything"]',
    '[placeholder="有问题，尽管问"]',
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
];
const SEND_BUTTON_SELECTOR = 'button[data-testid="send-button"]:not([disabled])';
const SEND_BUTTON_FALLBACK_SELECTORS = [
    '#composer-submit-button:not([disabled])',
];
const SEND_BUTTON_LABELS = [
    'Send prompt',
    'Send message',
    'Send',
    '发送',
    '发送消息',
    '发送提示',
];
const CLOSE_SIDEBAR_LABELS = [
    'Close sidebar',
    '关闭边栏',
];

function isSameChatGPTConversation(currentUrl, expectedUrl) {
    if (!currentUrl || !expectedUrl) return false;
    return currentUrl === expectedUrl
        || currentUrl.startsWith(`${expectedUrl}?`)
        || currentUrl.startsWith(`${expectedUrl}#`);
}

function buildComposerLocatorScript() {
    const markerAttr = 'data-opencli-chatgpt-composer';
    return `
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const markerAttr = ${JSON.stringify(markerAttr)};
      const clearMarkers = (active) => {
        document.querySelectorAll('[' + markerAttr + ']').forEach(node => {
          if (node !== active) node.removeAttribute(markerAttr);
        });
      };

      const findComposer = () => {
        for (const selector of ${JSON.stringify(COMPOSER_SELECTORS)}) {
          const candidates = Array.from(document.querySelectorAll(selector)).filter(c => c instanceof HTMLElement && isVisible(c));
          const node = candidates.find(c => c.isContentEditable) || candidates[0];
          if (node instanceof HTMLElement) {
            clearMarkers(node);
            node.setAttribute(markerAttr, '1');
            return node;
          }
        }
        return null;
      };

      findComposer.toString = () => 'findComposer';
    `;
}

export function normalizeBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value == null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export function requireNonEmptyPrompt(prompt, commandName) {
    const text = String(prompt ?? '').trim();
    if (!text) {
        throw new ArgumentError(
            `${commandName} prompt cannot be empty`,
            `Example: opencli ${commandName} "hello"`,
        );
    }
    return text;
}

export function requirePositiveInt(value, flagLabel, hint) {
    if (!Number.isInteger(value) || value < 1) {
        throw new ArgumentError(`${flagLabel} must be a positive integer`, hint);
    }
    return value;
}

export function requireNonNegativeInt(value, flagLabel, hint) {
    if (!Number.isInteger(value) || value < 0) {
        throw new ArgumentError(`${flagLabel} must be a non-negative integer`, hint);
    }
    return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// page.evaluate envelope helpers.
//
// The browser bridge wraps every `page.evaluate(...)` return value in a
// `{ session, data }` envelope. Adapters that read `.length` or
// `Array.isArray(payload)` directly on the envelope silently see "no data" —
// this matches the failure mode fixed for xiaohongshu/rednote (#1561) and
// weibo (#1568).
//
// `unwrapEvaluateResult` is a defensive ternary: it unwraps when the payload
// looks like an envelope, otherwise passes the value through unchanged so
// older bridge versions and primitive return values still work.
// ─────────────────────────────────────────────────────────────────────────────
export function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

export function requireArrayEvaluateResult(payload, label) {
    if (!Array.isArray(payload)) {
        if (payload && typeof payload === 'object' && 'error' in payload) {
            throw new CommandExecutionError(`${label}: ${String(payload.error)}`);
        }
        throw new CommandExecutionError(`${label} returned malformed extraction payload`);
    }
    return payload;
}

export function requireObjectEvaluateResult(payload, label) {
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
        throw new CommandExecutionError(`${label} returned malformed extraction payload`);
    }
    return payload;
}

export function requireBooleanEvaluateResult(payload, label) {
    if (typeof payload !== 'boolean') {
        throw new CommandExecutionError(`${label} returned malformed extraction payload`);
    }
    return payload;
}

function isTrustedChatGPTHost(hostname) {
    return hostname === CHATGPT_DOMAIN || hostname.endsWith(`.${CHATGPT_DOMAIN}`);
}

function projectIdFromPathname(pathname) {
    const match = String(pathname || '').match(/^\/g\/g-p-([a-f0-9]{8,})(?:[-/]|$)/i);
    return match ? match[1].toLowerCase() : '';
}

function projectIdFromUrl(value) {
    try {
        const url = new URL(String(value || ''), CHATGPT_URL);
        if (url.protocol !== 'https:' || !isTrustedChatGPTHost(url.hostname)) return '';
        return projectIdFromPathname(url.pathname);
    } catch {
        return '';
    }
}

export function parseChatGPTConversationId(value) {
    const raw = String(value ?? '').trim();
    if (/^https?:\/\//i.test(raw)) {
        try {
            const parsed = new URL(raw);
            if (parsed.protocol !== 'https:' || (parsed.hostname !== CHATGPT_DOMAIN && !parsed.hostname.endsWith(`.${CHATGPT_DOMAIN}`))) {
                throw new Error('off-domain');
            }
            const match = parsed.pathname.match(/^\/(?:g\/g-p-[^/]+\/)?c\/([A-Za-z0-9_-]{8,})$/);
            if (match) return match[1];
        } catch {
            // Fall through to the shared typed ArgumentError below.
        }
        throw new ArgumentError(
            'chatgpt detail requires a conversation id or chatgpt.com /c/<id> URL',
            'Example: opencli chatgpt detail https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000',
        );
    }
    const pathMatch = raw.match(/^\/(?:g\/g-p-[^/]+\/)?c\/([A-Za-z0-9_-]{8,})(?:[?#].*)?$/);
    if (pathMatch) return pathMatch[1];
    if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) return raw;
    throw new ArgumentError(
        'chatgpt detail requires a conversation id or chatgpt.com /c/<id> URL',
        'Example: opencli chatgpt detail 123e4567-e89b-12d3-a456-426614174000',
    );
}

export async function currentChatGPTUrl(page) {
    const url = unwrapEvaluateResult(await page.evaluate('window.location.href').catch(() => ''));
    return typeof url === 'string' ? url : '';
}

export async function isOnChatGPT(page) {
    const url = await currentChatGPTUrl(page);
    if (!url) return false;
    try {
        const host = new URL(url).hostname;
        return host === CHATGPT_DOMAIN || host.endsWith(`.${CHATGPT_DOMAIN}`);
    } catch {
        return false;
    }
}

// Comma-joined CSS selector list passed to page.wait({ selector }) so the
// wait succeeds as soon as any composer flavour mounts (querySelectorAll
// matches all of them). Tracks the most stable subset of COMPOSER_SELECTORS;
// we only need to know "the composer is ready", not which variant rendered.
const COMPOSER_WAIT_SELECTOR = '#prompt-textarea, [data-testid="prompt-textarea"]';
const CONVERSATION_LINK_SELECTOR = 'a[href*="/c/"]';
const PROJECT_LINK_SELECTOR = 'a[href*="/g/g-p-"]';
// Selector used by detail.js to wait for at least one rendered message bubble
// after navigating to /c/<id>; mirrors the markup queried by getVisibleMessages.
export const CONVERSATION_MESSAGE_SELECTOR = '[data-message-author-role], article[data-testid*="conversation-turn"]';

export async function ensureOnChatGPT(page) {
    if (await isOnChatGPT(page)) return false;
    await page.goto(CHATGPT_URL, { settleMs: 2000 });
    try {
        await page.wait({ selector: COMPOSER_WAIT_SELECTOR, timeout: 8 });
    } catch {
        // Composer didn't mount; downstream ensureChatGPTLogin / ensureChatGPTComposer surfaces a typed error.
    }
    return true;
}

export async function startNewChat(page) {
    await page.goto(`${CHATGPT_URL}/new`, { settleMs: 2000 });
    try {
        await page.wait({ selector: COMPOSER_WAIT_SELECTOR, timeout: 8 });
    } catch {
        // Composer didn't mount; downstream ensureChatGPTComposer surfaces a typed error.
    }
}

export async function openChatGPTConversation(page, value) {
    const id = parseChatGPTConversationId(value);
    await page.goto(`${CHATGPT_URL}/c/${id}`, { settleMs: 2000 });
    try {
        await page.wait({ selector: COMPOSER_WAIT_SELECTOR, timeout: 8 });
    } catch {
        // Composer didn't mount; downstream ensureChatGPTLogin / ensureChatGPTComposer surfaces a typed error.
    }
    return id;
}

export async function getPageState(page) {
    return requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const composerSelectors = ${JSON.stringify(COMPOSER_SELECTORS)};
        const hasComposer = composerSelectors.some((selector) =>
            Array.from(document.querySelectorAll(selector)).some((node) => isVisible(node))
        );
        const text = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
        const loginLink = Array.from(document.querySelectorAll('a, button')).find((node) => {
            const label = ((node.innerText || node.textContent || '') + ' ' + (node.getAttribute('aria-label') || '')).trim().toLowerCase();
            return isVisible(node) && /^(log in|login|sign up|sign in)$/.test(label);
        });
        const userMenu = document.querySelector('[data-testid="profile-button"], [aria-label*="Profile"], [aria-label*="Account"], button[id*="headlessui-menu-button"]');
        const hasLoginGate = !!loginLink || /log in to chatgpt|sign up to chatgpt|welcome to chatgpt/i.test(text);
        return {
            url: window.location.href,
            title: document.title,
            hasComposer,
            isLoggedIn: hasComposer || !!userMenu || !hasLoginGate,
            hasLoginGate,
        };
    })()`)), 'chatgpt page state');
}

export async function ensureChatGPTLogin(page, message = 'ChatGPT requires a logged-in browser session.') {
    const state = await getPageState(page);
    if (!state.isLoggedIn || state.hasLoginGate) {
        throw new AuthRequiredError(CHATGPT_DOMAIN, message);
    }
    return state;
}

export async function ensureChatGPTComposer(page, message = 'ChatGPT composer is not available on the current page.') {
    const state = await ensureChatGPTLogin(page, message);
    if (!state.hasComposer) {
        throw new CommandExecutionError(message);
    }
    return state;
}

function requireKnownChatGPTModel(model) {
    const key = String(model ?? '').trim().toLowerCase();
    const targetKey = CHATGPT_MODEL_ALIASES[key] || key;
    const option = CHATGPT_MODEL_TARGETS[targetKey];
    if (!option) {
        throw new ArgumentError(
            `Unknown ChatGPT model "${model}"`,
            `Choose one of: ${CHATGPT_MODEL_CHOICES.join(', ')}`,
        );
    }
    return { key: targetKey, alias: key !== targetKey ? key : null, ...option };
}

function requireKnownChatGPTTool(tool) {
    const key = String(tool ?? '').trim().toLowerCase();
    const option = CHATGPT_TOOL_OPTIONS[key];
    if (!option) {
        throw new ArgumentError(
            `Unknown ChatGPT tool "${tool}"`,
            `Choose one of: ${CHATGPT_TOOL_CHOICES.join(', ')}`,
        );
    }
    return { key, ...option };
}

export async function getCurrentChatGPTModel(page) {
    return requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const escapeRegExp = (value) => String(value).replace(/[|\\\\{}()[\\]^$+*?.]/g, '\\\\$&');
        const textMatchesLabel = (text, label) => {
            const normalizedText = normalize(text);
            const normalizedLabel = normalize(label);
            if (!normalizedText || !normalizedLabel) return false;
            if (normalizedText === normalizedLabel) return true;
            if (/^[\\x00-\\x7F]+$/.test(normalizedLabel)) {
                return new RegExp('(^|\\\\b)' + escapeRegExp(normalizedLabel) + '(\\\\b|$)', 'i').test(normalizedText);
            }
            return normalizedText.replace(/\\s+/g, '').includes(normalizedLabel.replace(/\\s+/g, ''));
        };
        const labels = ${JSON.stringify(CHATGPT_MODEL_TARGETS)};
        const findEntryForText = (text) => {
            const matches = [];
            for (const [key, value] of Object.entries(labels)) {
                for (const item of value.labels || []) {
                    if (textMatchesLabel(text, item)) {
                        matches.push({ key, value, length: normalize(item).length });
                    }
                }
            }
            matches.sort((a, b) => b.length - a.length);
            return matches[0] || null;
        };
        const form = Array.from(document.querySelectorAll('form')).find((node) => node instanceof HTMLElement && isVisible(node));
        const testIdNode = form
            ? Array.from(form.querySelectorAll('[data-testid]')).find((node) => {
                if (!(node instanceof HTMLElement) || !isVisible(node)) return false;
                const testId = node.getAttribute('data-testid');
                return Object.values(labels).some((entry) => (entry.testIds || []).includes(testId));
            })
            : null;
        const testId = testIdNode?.getAttribute('data-testid') || '';
        const testIdEntry = Object.entries(labels).find(([, value]) => (value.testIds || []).includes(testId));
        if (testIdEntry) {
            return {
                model: testIdEntry[0],
                label: testIdEntry[1].label,
            };
        }
        const button = Array.from((form || document).querySelectorAll('button')).find((node) => {
            if (!isVisible(node)) return false;
            const text = normalize(node.textContent);
            return Object.values(labels).some((entry) => entry.labels.some((label) => textMatchesLabel(text, label)));
        });
        const label = normalize(button?.textContent || '');
        const entry = findEntryForText(label);
        return {
            model: entry?.key ?? null,
            label: entry?.value?.label ?? null,
        };
    })()`)), 'chatgpt current model');
}

async function buildChatGPTBackendHeaders(page, { includeAuthorization = false } = {}) {
    if (typeof page.getCookies !== 'function') {
        return { ok: false, status: 0, reason: 'missing-cookie-api' };
    }
    const cookieLists = await Promise.all([
        page.getCookies({ url: CHATGPT_URL }).catch(() => []),
        page.getCookies({ url: `${CHATGPT_URL}/api/auth/session` }).catch(() => []),
        page.getCookies({ domain: CHATGPT_DOMAIN }).catch(() => []),
        page.getCookies({ domain: `.${CHATGPT_DOMAIN}` }).catch(() => []),
        page.getCookies().catch(() => []),
    ]);
    const cookiesByName = new Map();
    for (const cookie of cookieLists.flat()) {
        if (!cookie?.name || typeof cookie.value !== 'string') continue;
        if (!cookiesByName.has(cookie.name) || cookie.domain === CHATGPT_DOMAIN || cookie.domain === `.${CHATGPT_DOMAIN}`) {
            cookiesByName.set(cookie.name, cookie);
        }
    }
    const cookieHeader = Array.from(cookiesByName.values())
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
    if (!cookieHeader) return { ok: false, status: 0, reason: 'missing-cookies' };
    const headers = {
        accept: 'application/json',
        cookie: cookieHeader,
        origin: CHATGPT_URL,
        referer: `${CHATGPT_URL}/`,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    };
    if (!includeAuthorization) return { ok: true, status: 200, headers };

    const sessionResponse = await fetch(`${CHATGPT_URL}/api/auth/session`, {
        headers,
        signal: AbortSignal.timeout(10000),
    });
    if (!sessionResponse.ok) {
        return { ok: false, status: sessionResponse.status, reason: 'session' };
    }
    let session = null;
    try {
        session = await sessionResponse.json();
    } catch {
        return { ok: false, status: sessionResponse.status, reason: 'session-json' };
    }
    const accessToken = session?.accessToken;
    if (!accessToken) return { ok: false, status: 0, reason: 'missing-access-token' };
    return {
        ok: true,
        status: 200,
        headers: {
            ...headers,
            authorization: `Bearer ${accessToken}`,
        },
    };
}

async function setChatGPTModelConfig(page, target) {
    if (!target.modelConfig) return null;
    const auth = await buildChatGPTBackendHeaders(page, { includeAuthorization: true });
    if (!auth.ok) return auth;

    const modelSlug = target.modelConfig.modelSlug;
    const effort = target.modelConfig.effort;
    const patchUrl = `${CHATGPT_URL}/backend-api/settings/user_last_used_model_config`
        + `?model_slug=${encodeURIComponent(modelSlug)}`
        + `&thinking_effort=${encodeURIComponent(effort)}`;
    const response = await fetch(patchUrl, {
        method: 'PATCH',
        headers: auth.headers,
        signal: AbortSignal.timeout(10000),
    });
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok || body?.success !== true) {
        return { ok: false, status: response.status, reason: 'patch', body };
    }
    await page.evaluate(`(() => {
        const value = encodeURIComponent(JSON.stringify({ model: ${JSON.stringify(modelSlug)}, effort: ${JSON.stringify(effort)} }));
        for (const domain of ['; domain=.chatgpt.com', '; domain=chatgpt.com', '']) {
            document.cookie = 'oai-last-model-config=; path=/' + domain + '; max-age=0; SameSite=Lax';
        }
        document.cookie = 'oai-last-model-config=' + value + '; path=/; domain=.chatgpt.com; max-age=31536000; SameSite=Lax';
        document.cookie = 'oai-last-model-config=' + value + '; path=/; max-age=31536000; SameSite=Lax';
        if (window.location.pathname === '/new') window.location.reload();
        else window.location.assign('/new');
        return true;
    })()`).catch(() => true);
    return { ok: true, status: response.status, modelSlug, effort };
}

export async function selectChatGPTModel(page, model) {
    const target = requireKnownChatGPTModel(model);
    debugChatGPTModel(`target=${target.key}`);
    if (typeof page.nativeClick !== 'function') {
        throw new CommandExecutionError('ChatGPT model selection requires native browser click support.');
    }
    await ensureOnChatGPT(page);
    debugChatGPTModel('ensured chatgpt');
    const currentUrl = await currentChatGPTUrl(page).catch(() => '');
    debugChatGPTModel(`url=${currentUrl}`);
    if (!currentUrl.startsWith(`${CHATGPT_URL}/new`)) {
        await page.goto(`${CHATGPT_URL}/new`, { waitUntil: 'none' });
        await page.wait(2);
    }
    await ensureChatGPTComposer(page, 'ChatGPT model selection requires a logged-in ChatGPT session with a visible composer.');
    debugChatGPTModel('composer ok');

    const before = await getCurrentChatGPTModel(page);
    debugChatGPTModel(`before=${before.model || 'none'}`);
    if (before.model === target.key) {
        return { Status: 'Already selected', Model: target.label };
    }
    const apiResult = await setChatGPTModelConfig(page, target);
    debugChatGPTModel(`api=${apiResult ? JSON.stringify({ ok: apiResult.ok, status: apiResult.status, reason: apiResult.reason }) : 'none'}`);
    if (apiResult) {
        if (!apiResult.ok) {
            if (apiResult.status === 401 || apiResult.status === 403) {
                throw new AuthRequiredError(CHATGPT_DOMAIN, `ChatGPT model preference API rejected the current session while selecting ${target.label}.`);
            }
            debugChatGPTModel(`falling back to picker after api failure: ${apiResult.reason || 'unknown'}`);
        } else {
            debugChatGPTModel('config cookie set and reload scheduled');
            await page.wait(2);
            await ensureChatGPTComposer(page, 'ChatGPT model selection requires a logged-in ChatGPT session with a visible composer.');
            const afterApi = await getCurrentChatGPTModel(page);
            debugChatGPTModel(`after-api=${afterApi.model || 'none'}`);
            if (afterApi.model === target.key) {
                return { Status: 'Success', Model: target.label };
            }
            debugChatGPTModel('api did not prove selection; falling back to visible picker');
        }
    }
    await page.wait(2);

    const menuButton = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const escapeRegExp = (value) => String(value).replace(/[|\\\\{}()[\\]^$+*?.]/g, '\\\\$&');
        const textMatchesLabel = (text, label) => {
            const normalizedText = normalize(text);
            const normalizedLabel = normalize(label);
            if (!normalizedText || !normalizedLabel) return false;
            if (normalizedText === normalizedLabel) return true;
            if (/^[\\x00-\\x7F]+$/.test(normalizedLabel)) {
                return new RegExp('(^|\\\\b)' + escapeRegExp(normalizedLabel) + '(\\\\b|$)', 'i').test(normalizedText);
            }
            return normalizedText.replace(/\\s+/g, '').includes(normalizedLabel.replace(/\\s+/g, ''));
        };
        const labels = ${JSON.stringify(Object.values(CHATGPT_MODEL_TARGETS).flatMap((entry) => entry.labels))};
        const menuButtonSelectors = [
            'button[data-testid="model-switcher-dropdown-button"]',
            'button[aria-label*="model" i]',
            'button[aria-label*="模型"]',
            'button[aria-label*="智能"]',
        ];
        let button = Array.from(document.querySelectorAll('form button')).find((node) =>
            isVisible(node) && labels.some((label) => textMatchesLabel(node.textContent, label))
        );
        if (!button) {
            button = menuButtonSelectors
                .map((selector) => document.querySelector(selector))
                .find((node) => node instanceof HTMLElement && isVisible(node));
        }
        if (!button) return { found: false };
        button.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = button.getBoundingClientRect();
        return {
            found: true,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
        };
    })()`)), 'chatgpt model menu button');
    if (!menuButton.found) {
        throw new CommandExecutionError('Could not find the ChatGPT model selector in the composer.');
    }
    await page.nativeClick(Number(menuButton.x), Number(menuButton.y));
    await page.wait(0.5);

    let optionCenter = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
        optionCenter = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
            const isVisible = (el) => {
                if (!(el instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };
            const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
            const escapeRegExp = (value) => String(value).replace(/[|\\\\{}()[\\]^$+*?.]/g, '\\\\$&');
            const textMatchesLabel = (text, label) => {
                const normalizedText = normalize(text);
                const normalizedLabel = normalize(label);
                if (!normalizedText || !normalizedLabel) return false;
                if (normalizedText === normalizedLabel) return true;
                if (/^[\\x00-\\x7F]+$/.test(normalizedLabel)) {
                    return new RegExp('(^|\\\\b)' + escapeRegExp(normalizedLabel) + '(\\\\b|$)', 'i').test(normalizedText);
                }
                return normalizedText.replace(/\\s+/g, '').includes(normalizedLabel.replace(/\\s+/g, ''));
            };
            const target = ${JSON.stringify(target)};
            const clickableSelector = '[role="menuitemradio"], [role="menuitem"], [role="option"], button, [data-testid^="model-switcher"]';
            const intelligenceContent = document.querySelector('[data-testid="composer-intelligence-picker-content"]');
            const intelligenceOptions = intelligenceContent
                ? Array.from(intelligenceContent.querySelectorAll('[role="menuitemradio"]')).filter(isVisible)
                : [];
            let option = null;
            for (const testId of target.testIds || []) {
                option = Array.from(document.querySelectorAll('[data-testid]')).find((candidate) =>
                    candidate instanceof HTMLElement && candidate.getAttribute('data-testid') === testId
                ) || null;
                if (option instanceof HTMLElement && isVisible(option)) break;
                option = null;
            }
            const clickables = intelligenceOptions.length ? intelligenceOptions : Array.from(document.querySelectorAll(clickableSelector));
            for (const label of target.optionLabels || target.labels || []) {
                option = clickables.find((candidate) =>
                    candidate instanceof HTMLElement
                    && isVisible(candidate)
                    && textMatchesLabel(candidate.textContent, label)
                ) || null;
                if (option) break;

                const labelRoot = intelligenceContent || document;
                const labelNode = Array.from(labelRoot.querySelectorAll('span, div, p')).find((candidate) =>
                    candidate instanceof HTMLElement
                    && isVisible(candidate)
                    && textMatchesLabel(candidate.textContent, label)
                );
                option = labelNode?.closest(clickableSelector) || null;
                if (option instanceof HTMLElement && isVisible(option)) break;
                option = null;
            }
            if (!option && Number.isInteger(target.intelligenceOrder)) {
                if (intelligenceOptions.length === 5) {
                    option = intelligenceOptions[target.intelligenceOrder] || null;
                }
            }
            if (!(option instanceof HTMLElement) || !isVisible(option)) return { found: false };
            option.scrollIntoView({ block: 'center', inline: 'center' });
            const rect = option.getBoundingClientRect();
            return {
                found: true,
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
            };
        })()`)), 'chatgpt model option click');
        if (optionCenter.found) break;
        await page.wait(0.5);
    }
    if (!optionCenter?.found) {
        throw new CommandExecutionError(`Could not click the ChatGPT ${target.label} model option.`);
    }
    await page.nativeClick(Number(optionCenter.x), Number(optionCenter.y));

    await page.wait(0.5);
    const after = await getCurrentChatGPTModel(page);
    if (after.model !== target.key) {
        await page.nativeClick(Number(menuButton.x), Number(menuButton.y));
        await page.wait(0.5);
        const checked = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
            const isVisible = (el) => {
                if (!(el instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };
            const target = ${JSON.stringify(target)};
            const intelligenceContent = document.querySelector('[data-testid="composer-intelligence-picker-content"]');
            const options = intelligenceContent
                ? Array.from(intelligenceContent.querySelectorAll('[role="menuitemradio"]')).filter(isVisible)
                : [];
            const checkedIndex = options.findIndex((node) => node.getAttribute('aria-checked') === 'true');
            return {
                recognized: options.length === 5 && Number.isInteger(target.intelligenceOrder),
                checkedIndex,
            };
        })()`)), 'chatgpt model checked intelligence option');
        if (checked.recognized && checked.checkedIndex === target.intelligenceOrder) {
            await page.nativeClick(Number(menuButton.x), Number(menuButton.y));
            return { Status: 'Success', Model: target.label };
        }
        await page.nativeClick(Number(menuButton.x), Number(menuButton.y));
        throw new CommandExecutionError(`ChatGPT model did not switch to ${target.label}.`);
    }
    return { Status: 'Success', Model: target.label };
}

export async function getCurrentChatGPTTool(page) {
    return requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const labels = ${JSON.stringify(CHATGPT_TOOL_OPTIONS)};
        const form = Array.from(document.querySelectorAll('form')).find((node) => node instanceof HTMLElement && isVisible(node));
        const root = form || document.body;
        const nodes = Array.from(root.querySelectorAll('button, [role="button"], [role="menuitemradio"], span, div'));
        const node = nodes.find((candidate) => {
            if (!isVisible(candidate)) return false;
            const text = normalize(candidate.textContent);
            return Object.values(labels).some((entry) => entry.labels.includes(text));
        });
        const label = normalize(node?.textContent || '');
        const entry = Object.entries(labels).find(([, value]) => value.labels.includes(label));
        return {
            tool: entry?.[0] ?? null,
            label: entry?.[1]?.label ?? null,
        };
    })()`)), 'chatgpt current tool');
}

export async function selectChatGPTTool(page, tool) {
    const target = requireKnownChatGPTTool(tool);
    if (typeof page.nativeClick !== 'function') {
        throw new CommandExecutionError('ChatGPT tool selection requires native browser click support.');
    }
    await ensureOnChatGPT(page);
    await ensureChatGPTComposer(page, 'ChatGPT tool selection requires a logged-in ChatGPT session with a visible composer.');

    const before = await getCurrentChatGPTTool(page);
    if (before.tool === target.key) {
        return { Status: 'Already selected', Tool: target.label };
    }

    const menuButton = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const button = document.querySelector('button[data-testid="composer-plus-btn"]');
        if (!(button instanceof HTMLElement) || !isVisible(button)) return { found: false };
        button.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = button.getBoundingClientRect();
        return {
            found: true,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
        };
    })()`)), 'chatgpt tools menu button');
    if (!menuButton.found) {
        throw new CommandExecutionError('Could not find the ChatGPT tools menu button in the composer.');
    }
    await page.nativeClick(Number(menuButton.x), Number(menuButton.y));
    await page.wait(0.5);

    let optionCenter = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
        optionCenter = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
            const isVisible = (el) => {
                if (!(el instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };
            const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
            const labels = ${JSON.stringify(target.labels)};
            const options = Array.from(document.querySelectorAll('[role="menuitemradio"]'));
            const option = options.find((node) => node instanceof HTMLElement && isVisible(node) && labels.includes(normalize(node.textContent)));
            if (!(option instanceof HTMLElement)) return { found: false };
            const checked = option.getAttribute('aria-checked') === 'true';
            option.scrollIntoView({ block: 'center', inline: 'center' });
            const rect = option.getBoundingClientRect();
            return {
                found: true,
                checked,
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
            };
        })()`)), 'chatgpt tool option click');
        if (optionCenter.found) break;
        await page.wait(0.5);
    }
    if (!optionCenter?.found) {
        throw new CommandExecutionError(`Could not find the ChatGPT ${target.label} tool option.`);
    }
    if (!optionCenter.checked) {
        await page.nativeClick(Number(optionCenter.x), Number(optionCenter.y));
    }

    await page.wait(0.5);
    const after = await getCurrentChatGPTTool(page);
    if (after.tool !== target.key) {
        throw new CommandExecutionError(`ChatGPT tool did not switch to ${target.label}.`);
    }
    return { Status: optionCenter.checked ? 'Already selected' : 'Success', Tool: target.label };
}

export async function clearChatGPTDraft(page) {
    await page.evaluate(`
        (() => {
            const removeLabels = [/^remove file/i, /^移除文件/];
            for (let pass = 0; pass < 10; pass += 1) {
                const button = Array.from(document.querySelectorAll('button')).find((node) => {
                    const label = node.getAttribute('aria-label') || '';
                    return removeLabels.some((pattern) => pattern.test(label));
                });
                if (!button) break;
                button.click();
            }

            const selectors = ${JSON.stringify(COMPOSER_SELECTORS)};
            for (const selector of selectors) {
                for (const node of document.querySelectorAll(selector)) {
                    if (!(node instanceof HTMLElement)) continue;
                    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
                        node.value = '';
                    } else if (node.isContentEditable) {
                        node.textContent = '';
                        node.innerHTML = '<p><br></p>';
                    } else {
                        node.textContent = '';
                    }
                    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
                    node.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        })()
    `);
    await page.wait(0.5);
}

export function parseChatGPTProjectId(value) {
    const raw = String(value ?? '').trim();
    if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
        const id = projectIdFromUrl(raw);
        if (id) return id;
        throw new ArgumentError(
            'chatgpt project commands require a chatgpt.com project id or /g/g-p-<id> URL',
            'Example: opencli chatgpt project-file-add report.pdf --id 12345678',
        );
    }
    // Accept project slug pattern: g-p-{hex_id}-{slug} or just hex id
    const slugMatch = raw.match(/^g-p-([a-f0-9]{8,})/i);
    if (slugMatch) return slugMatch[1].toLowerCase();
    if (/^[a-f0-9]{8,}$/i.test(raw)) return raw.toLowerCase();
    throw new ArgumentError(
        'chatgpt project commands require a project id or /g/g-p-<id> URL',
        'Example: opencli chatgpt project-file-add report.pdf --id 12345678',
    );
}

/**
 * Send a message to the ChatGPT composer and submit it.
 * Returns true if the message was sent successfully.
 */
export async function sendChatGPTMessage(page, text) {
    // Close sidebar if open (it can cover the chat composer)
    await page.evaluate(`
        (() => {
            const labels = ${JSON.stringify(CLOSE_SIDEBAR_LABELS)};
            const closeBtn = Array.from(document.querySelectorAll('button')).find(b => labels.includes(b.getAttribute('aria-label') || ''));
            if (closeBtn) closeBtn.click();
        })()
    `);
    // The previous 0.5 s + 1.5 s pre-composer settles are dropped: the next
    // page.evaluate roundtrip flushes the close-sidebar React update and
    // findComposer() retries inside a single CDP call, so no fixed sleep is
    // needed before reading the composer.

    const typeResult = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
        (() => {
            ${buildComposerLocatorScript()}
            const composer = findComposer();
            if (!composer) return { ready: false };
            composer.focus();
            if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
                composer.value = '';
            } else if (composer.isContentEditable) {
                composer.textContent = '';
                composer.innerHTML = '<p><br></p>';
            } else {
                composer.textContent = '';
            }
            composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
            composer.dispatchEvent(new Event('change', { bubbles: true }));
            composer.scrollIntoView({ block: 'center', inline: 'center' });
            const rect = composer.getBoundingClientRect();
            return {
                ready: true,
                x: Math.round(rect.left + Math.max(8, Math.min(rect.width / 2, rect.width - 8))),
                y: Math.round(rect.top + Math.max(8, Math.min(rect.height / 2, rect.height - 8))),
            };
        })()
    `)), 'chatgpt composer readiness');

    if (!typeResult.ready) return false;

    // Use page.type() which is Playwright's native method
    try {
        if (page.nativeType) {
            if (typeof page.nativeClick === 'function') {
                await page.nativeClick(Number(typeResult.x), Number(typeResult.y));
                await page.wait(0.2);
            }
            await page.nativeType(text);
        } else {
            throw new Error('nativeType unavailable');
        }
    } catch (e) {
        // Fallback: use execCommand
        await page.evaluate(`
            (() => {
                var composer = null;
                var sels = ${JSON.stringify(COMPOSER_SELECTORS)};
                for (var si = 0; si < sels.length; si++) { composer = document.querySelector(sels[si]); if (composer) break; }
                if (!composer) return;
                composer.focus();
                document.execCommand('insertText', false, ${JSON.stringify(text)});
            })()
        `);
    }

    let sent = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        await page.wait(0.5);
        sent = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
            (() => {
                const isVisible = (el) => {
                    if (!(el instanceof HTMLElement)) return false;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };
                const isUsable = (button) => button
                    && isVisible(button)
                    && !button.disabled
                    && button.getAttribute('aria-disabled') !== 'true';
                const form = Array.from(document.querySelectorAll('form')).find((node) => node instanceof HTMLElement && isVisible(node));
                const root = form || document.body;
                const primary = root.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)})
                    || ${JSON.stringify(SEND_BUTTON_FALLBACK_SELECTORS)}.map(selector => root.querySelector(selector)).find(Boolean);
                const btns = Array.from(root.querySelectorAll('button'));
                const labels = ${JSON.stringify(SEND_BUTTON_LABELS)};
                const looksLikeSend = (button) => {
                    const label = button.getAttribute('aria-label') || '';
                    const text = (button.innerText || button.textContent || '').replace(/\\s+/g, ' ').trim();
                    return labels.includes(label) || labels.includes(text) || /send|发送/i.test(label) || /send|发送/i.test(text);
                };
                const sendBtn = isUsable(primary)
                    ? primary
                    : btns.find(b => looksLikeSend(b) && isUsable(b));
                return { sendBtnFound: !!sendBtn };
            })()
        `)), 'chatgpt send button readiness');
        if (sent?.sendBtnFound) break;
    }

    if (!sent?.sendBtnFound) {
        return false;
    }

    await page.evaluate(`
        (() => {
            const isVisible = (el) => {
                if (!(el instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };
            const isUsable = (button) => button
                && isVisible(button)
                && !button.disabled
                && button.getAttribute('aria-disabled') !== 'true';
            const form = Array.from(document.querySelectorAll('form')).find((node) => node instanceof HTMLElement && isVisible(node));
            const root = form || document.body;
            const primary = root.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)})
                || ${JSON.stringify(SEND_BUTTON_FALLBACK_SELECTORS)}.map(selector => root.querySelector(selector)).find(Boolean);
            const labels = ${JSON.stringify(SEND_BUTTON_LABELS)};
            const looksLikeSend = (button) => {
                const label = button.getAttribute('aria-label') || '';
                const text = (button.innerText || button.textContent || '').replace(/\\s+/g, ' ').trim();
                return labels.includes(label) || labels.includes(text) || /send|发送/i.test(label) || /send|发送/i.test(text);
            };
            const sendBtn = isUsable(primary)
                ? primary
                : Array.from(root.querySelectorAll('button')).find(b => looksLikeSend(b) && isUsable(b));
            if (sendBtn) sendBtn.click();
        })()
    `);
    return true;
}

export async function getVisibleMessages(page) {
    const result = requireArrayEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const normalize = (value) => String(value || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
        const roleOf = (node) => {
            const attr = node.getAttribute('data-message-author-role') || node.getAttribute('data-author') || '';
            if (/assistant/i.test(attr)) return 'Assistant';
            if (/user/i.test(attr)) return 'User';
            const testid = node.getAttribute('data-testid') || '';
            if (/assistant/i.test(testid)) return 'Assistant';
            if (/user/i.test(testid)) return 'User';
            const label = node.getAttribute('aria-label') || '';
            if (/assistant|chatgpt/i.test(label)) return 'Assistant';
            if (/you|user/i.test(label)) return 'User';
            return '';
        };

        let nodes = Array.from(document.querySelectorAll('[data-message-author-role], article[data-testid*="conversation-turn"]'));
        nodes = nodes.filter((node) => node instanceof HTMLElement && isVisible(node));

        const rows = [];
        const seen = new Set();
        for (const node of nodes) {
            let role = roleOf(node);
            const roleNode = node.querySelector('[data-message-author-role], [data-author]');
            if (!role && roleNode) role = roleOf(roleNode);
            if (!role) continue;

            const contentNode = node.querySelector('[data-message-author-role] .markdown')
                || node.querySelector('.markdown')
                || node.querySelector('[data-message-author-role]')
                || node;
            const html = contentNode instanceof HTMLElement ? (contentNode.innerHTML || '') : '';
            const text = normalize(contentNode instanceof HTMLElement ? (contentNode.innerText || contentNode.textContent || '') : '');
            if (!text) continue;
            const key = role + '\\n' + text;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({ role, text, html });
        }
        return rows;
    })()`)), 'chatgpt visible messages');
    return result.map((item, index) => ({
        Index: index + 1,
        Role: item?.role === 'Assistant' ? 'Assistant' : 'User',
        Text: String(item?.text || '').trim(),
        Html: String(item?.html || ''),
    })).filter((item) => item.Text);
}

function formatChatGPTDetailMessages(messages, { wantMarkdown, generating, stableSeconds }) {
    return messages.map((message) => ({
        Index: message.Index,
        Role: message.Role,
        Text: wantMarkdown && message.Role === 'Assistant' && message.Html
            ? (messageHtmlToMarkdown(message.Html) || message.Text)
            : message.Text,
        Generating: generating,
        StableSeconds: stableSeconds,
    }));
}

export async function getChatGPTDetailRows(page, { wantMarkdown = false, stableSeconds = 0 } = {}) {
    const generating = await isGenerating(page);
    const messages = await getVisibleMessages(page);
    return {
        messages,
        rows: formatChatGPTDetailMessages(messages, { wantMarkdown, generating, stableSeconds }),
        generating,
    };
}

export async function waitForChatGPTDetailRows(page, { wantMarkdown = false, timeoutSeconds = 120, stableSeconds = 6 } = {}) {
    const startTime = Date.now();
    let lastKey = '';
    let stableStartedAt = 0;

    while (Date.now() - startTime < timeoutSeconds * 1000) {
        const generating = await isGenerating(page);
        const messages = await getVisibleMessages(page);
        const key = JSON.stringify(messages.map((message) => [message.Role, message.Text]));
        if (!generating && messages.length && messages[messages.length - 1]?.Role === 'Assistant') {
            if (key === lastKey) {
                if (!stableStartedAt) stableStartedAt = Date.now();
                const elapsedSeconds = Math.floor((Date.now() - stableStartedAt) / 1000);
                if (elapsedSeconds >= stableSeconds) {
                    return {
                        messages,
                        rows: formatChatGPTDetailMessages(messages, {
                            wantMarkdown,
                            generating: false,
                            stableSeconds: elapsedSeconds,
                        }),
                        generating: false,
                    };
                }
            } else {
                lastKey = key;
                stableStartedAt = Date.now();
            }
        } else {
            lastKey = key;
            stableStartedAt = 0;
        }
        await page.wait(3);
    }

    throw new TimeoutError(
        'chatgpt detail',
        timeoutSeconds,
        'Conversation did not finish or stabilize before timeout. Re-run with a higher --timeout if it is still generating.',
    );
}

function normalizeDeepResearchText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function looksLikeDeepResearchReport(text) {
    const normalized = normalizeDeepResearchText(text);
    if (normalized.length < 500) return false;
    return /(^|\n)\s*#{1,3}\s+\S|Sources|References|参考|来源|结论|建议|Executive Summary|摘要/i.test(normalized);
}

function parseJsonMaybe(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function extractDeepResearchSourcesFromReportMessage(reportMessage) {
    const metadata = reportMessage?.metadata && typeof reportMessage.metadata === 'object'
        ? reportMessage.metadata
        : {};
    const references = Array.isArray(metadata.content_references) ? metadata.content_references : [];
    const safeUrls = Array.isArray(metadata.safe_urls) ? metadata.safe_urls : [];
    const groups = Array.isArray(metadata.search_result_groups) ? metadata.search_result_groups : [];
    const byUrl = new Map();

    const addSource = (source = {}, label = 'source') => {
        if (!source || typeof source !== 'object') {
            throw new CommandExecutionError(`Malformed ChatGPT Deep Research ${label}: expected object source row.`);
        }
        const rawUrl = String(source.url || source.href || source.safe_url || '').trim();
        const title = String(source.title || source.name || source.text || '').trim();
        if (!rawUrl) {
            if (title || source.matched_text || source.metadata) {
                throw new CommandExecutionError(`Malformed ChatGPT Deep Research ${label}: missing source URL.`);
            }
            return;
        }
        if (!/^https?:\/\//i.test(rawUrl)) {
            throw new CommandExecutionError(`Malformed ChatGPT Deep Research ${label}: invalid source URL.`);
        }
        if (!byUrl.has(rawUrl)) {
            byUrl.set(rawUrl, { title, url: rawUrl });
        } else if (title && !byUrl.get(rawUrl).title) {
            byUrl.get(rawUrl).title = title;
        }
    };

    for (const reference of references) {
        const hasDirectSource = reference && typeof reference === 'object'
            && (reference.url || reference.href || reference.safe_url || reference.title || reference.name || reference.text || reference.matched_text);
        if (hasDirectSource) addSource(reference, 'content reference');
        if (reference?.matched_text) addSource({ title: reference.matched_text, url: reference.url }, 'matched content reference');
        if (reference?.metadata) addSource(reference.metadata, 'content reference metadata');
    }
    for (const url of safeUrls) addSource(typeof url === 'string' ? { url } : url, 'safe URL');
    for (const group of groups) {
        for (const entry of [
            ...(Array.isArray(group?.entries) ? group.entries : []),
            ...(Array.isArray(group?.results) ? group.results : []),
            ...(Array.isArray(group?.items) ? group.items : []),
        ]) {
            addSource(entry, 'search result');
        }
    }
    return [...byUrl.values()].slice(0, 200);
}

function extractDeepResearchFromWidgetState(widgetState, source = 'conversation-widget-state') {
    const state = parseJsonMaybe(widgetState);
    if (!state || typeof state !== 'object') return null;
    const reportMessage = state.report_message || state.reportMessage || null;
    const parts = Array.isArray(reportMessage?.content?.parts) ? reportMessage.content.parts : [];
    const report = normalizeDeepResearchText(parts.filter((part) => typeof part === 'string').join('\n\n'));
    if (!looksLikeDeepResearchReport(report)) return null;
    return {
        status: 'completed',
        report,
        html: '',
        method: source,
        sources: extractDeepResearchSourcesFromReportMessage(reportMessage),
        widgetStatus: String(state.status || ''),
        reportMessageId: String(reportMessage?.id || ''),
        reportLength: report.length,
    };
}

function extractDeepResearchFromConversationPayload(payload, { expectedConversationId = '' } = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CommandExecutionError('Malformed ChatGPT conversation payload for Deep Research extraction.');
    }
    const payloadConversationId = String(payload.conversation_id || payload.conversationId || payload.id || '').trim();
    if (expectedConversationId && payloadConversationId && payloadConversationId !== expectedConversationId) {
        throw new CommandExecutionError(
            `ChatGPT conversation payload id mismatch: expected ${expectedConversationId}, got ${payloadConversationId}.`,
        );
    }
    const mapping = payload?.mapping && typeof payload.mapping === 'object' ? payload.mapping : {};
    if (!payload.mapping || typeof payload.mapping !== 'object' || Array.isArray(payload.mapping)) {
        throw new CommandExecutionError('Malformed ChatGPT conversation payload for Deep Research extraction: missing mapping.');
    }
    const candidates = [];
    for (const [messageId, node] of Object.entries(mapping)) {
        const message = node?.message || {};
        const sdk = message?.metadata?.chatgpt_sdk;
        for (const widgetState of [
            sdk?.widget_state,
            sdk?.widgetState,
            message?.metadata?.widget_state,
            message?.metadata?.widgetState,
        ]) {
            const extracted = extractDeepResearchFromWidgetState(widgetState);
            if (extracted) {
                candidates.push({
                    ...extracted,
                    conversationMessageId: messageId,
                });
            }
        }
    }
    candidates.sort((a, b) => b.report.length - a.report.length);
    return candidates[0] || null;
}

function conversationIdFromBackendConversationUrl(url) {
    const match = String(url || '').match(/\/backend-api\/conversation\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function extractDeepResearchFromNetworkEntries(entries, { expectedConversationId = '' } = {}) {
    const candidates = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        const url = String(entry?.url || '');
        if (!/\/backend-api\/conversation\//.test(url)) continue;
        const entryConversationId = conversationIdFromBackendConversationUrl(url);
        if (expectedConversationId && entryConversationId !== expectedConversationId) continue;
        const body = parseJsonMaybe(entry?.responsePreview) || parseJsonMaybe(entry?.body) || null;
        if (!body) {
            throw new CommandExecutionError(`Malformed ChatGPT conversation network payload for ${entryConversationId || 'unknown conversation'}.`);
        }
        const extracted = extractDeepResearchFromConversationPayload(body, { expectedConversationId });
        if (extracted) {
            candidates.push({
                ...extracted,
                method: 'network-conversation-widget-state',
                networkUrl: url,
            });
        }
    }
    candidates.sort((a, b) => b.report.length - a.report.length);
    return candidates[0] || null;
}

function conversationIdFromUrl(url) {
    const match = String(url || '').match(/\/c\/([a-zA-Z0-9_-]+)/);
    return match?.[1] || '';
}

async function buildChatGPTConversationHeaders(page, { includeAuthorization = false } = {}) {
    if (typeof page.getCookies !== 'function') {
        return { ok: false, status: 0, reason: 'missing-cookie-api' };
    }
    const cookieLists = await Promise.all([
        page.getCookies({ url: CHATGPT_URL }).catch(() => []),
        page.getCookies({ url: `${CHATGPT_URL}/api/auth/session` }).catch(() => []),
        page.getCookies({ domain: CHATGPT_DOMAIN }).catch(() => []),
        page.getCookies({ domain: `.${CHATGPT_DOMAIN}` }).catch(() => []),
        page.getCookies().catch(() => []),
    ]);
    const cookiesByName = new Map();
    for (const cookie of cookieLists.flat()) {
        if (!cookie?.name || typeof cookie.value !== 'string') continue;
        if (!cookiesByName.has(cookie.name) || cookie.domain === CHATGPT_DOMAIN || cookie.domain === `.${CHATGPT_DOMAIN}`) {
            cookiesByName.set(cookie.name, cookie);
        }
    }
    const cookieHeader = Array.from(cookiesByName.values())
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
    if (!cookieHeader) return { ok: false, status: 0, reason: 'missing-cookies' };
    const headers = {
        accept: 'application/json',
        cookie: cookieHeader,
        origin: CHATGPT_URL,
        referer: `${CHATGPT_URL}/`,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    };
    if (!includeAuthorization) return { ok: true, status: 200, headers };

    const sessionResponse = await fetch(`${CHATGPT_URL}/api/auth/session`, {
        headers,
        signal: AbortSignal.timeout(10000),
    });
    if (!sessionResponse.ok) {
        return { ok: false, status: sessionResponse.status, reason: 'session' };
    }
    const session = await sessionResponse.json();
    const accessToken = session?.accessToken;
    if (!accessToken) return { ok: false, status: 0, reason: 'missing-access-token' };
    return {
        ok: true,
        status: 200,
        headers: {
            ...headers,
            authorization: `Bearer ${accessToken}`,
        },
    };
}

async function fetchChatGPTConversationPayload(page, conversationId) {
    if (!conversationId) return null;
    const errors = [];
    try {
        const cookieAuth = await buildChatGPTConversationHeaders(page, { includeAuthorization: false });
        if (cookieAuth.ok) {
            const response = await fetch(`${CHATGPT_URL}/backend-api/conversation/${conversationId}`, {
                headers: {
                    ...cookieAuth.headers,
                    referer: `${CHATGPT_URL}/c/${conversationId}`,
                },
                signal: AbortSignal.timeout(8000),
            });
            const text = await response.text();
            if (response.ok) {
                const payload = parseJsonMaybe(text);
                if (payload) {
                    return {
                        payload,
                        status: response.status,
                        contentType: response.headers.get('content-type') || '',
                        transport: 'node-fetch-cookie',
                    };
                }
                errors.push('node fetch returned non-json');
            } else if (response.status === 401 || response.status === 403) {
                errors.push(`node cookie fetch status ${response.status}`);
                const bearerAuth = await buildChatGPTConversationHeaders(page, { includeAuthorization: true });
                if (bearerAuth.ok) {
                    const bearerResponse = await fetch(`${CHATGPT_URL}/backend-api/conversation/${conversationId}`, {
                        headers: {
                            ...bearerAuth.headers,
                            referer: `${CHATGPT_URL}/c/${conversationId}`,
                        },
                        signal: AbortSignal.timeout(8000),
                    });
                    const bearerText = await bearerResponse.text();
                    if (bearerResponse.ok) {
                        const payload = parseJsonMaybe(bearerText);
                        if (payload) {
                            return {
                                payload,
                                status: bearerResponse.status,
                                contentType: bearerResponse.headers.get('content-type') || '',
                                transport: 'node-fetch-bearer',
                            };
                        }
                        errors.push('node bearer fetch returned non-json');
                    } else {
                        errors.push(`node bearer fetch status ${bearerResponse.status}`);
                    }
                } else {
                    errors.push(`node bearer auth ${bearerAuth.reason || bearerAuth.status || 'failed'}`);
                }
            } else {
                errors.push(`node fetch status ${response.status}`);
            }
        } else {
            errors.push(`node cookie auth ${cookieAuth.reason || cookieAuth.status || 'failed'}`);
        }
    } catch (error) {
        errors.push(`node fetch ${String(error?.message || error)}`);
    }

    const result = unwrapEvaluateResult(await withTimeout(page.evaluate(`(async () => {
        const response = await fetch('/backend-api/conversation/${conversationId}', {
            credentials: 'include',
            headers: { accept: 'application/json' },
        });
        const text = await response.text();
        return {
            ok: response.ok,
            status: response.status,
            contentType: response.headers.get('content-type') || '',
            text,
        };
    })()`), 8000, 'conversation fetch'));
    if (!result?.ok) {
        return { error: [...errors, `page fetch status ${result?.status || 0}`].join('; ') };
    }
    const payload = parseJsonMaybe(result.text);
    if (!payload) return { error: [...errors, 'page fetch returned non-json'].join('; ') };
    return { payload, status: result.status, contentType: result.contentType, transport: 'page-fetch' };
}

function collectAxText(tree) {
    const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    const pieces = [];
    for (const node of nodes) {
        const role = String(node?.role?.value || node?.role || '');
        if (/StaticText|InlineTextBox|heading|paragraph|link|button|text/i.test(role)) {
            const value = String(node?.name?.value || node?.name || '').trim();
            if (value) pieces.push(value);
        }
    }
    return normalizeDeepResearchText(pieces.join('\n'));
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
}

export async function getChatGPTDeepResearchResult(page, { conversationId = '', useBridgeProbes = false } = {}) {
    const iframeState = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const iframes = Array.from(document.querySelectorAll('iframe')).map((frame, index) => {
            const rect = frame.getBoundingClientRect();
            const title = frame.getAttribute('title') || '';
            const src = frame.getAttribute('src') || frame.src || '';
            const deepResearch = /deep-research|connector_openai_deep_research/i.test(title + ' ' + src);
            let accessible = false;
            let text = '';
            let html = '';
            let accessError = '';
            try {
                const doc = frame.contentDocument || frame.contentWindow?.document;
                accessible = !!doc;
                text = normalize(doc?.body?.innerText || doc?.body?.textContent || '');
                html = String(doc?.body?.innerHTML || '');
            } catch (error) {
                accessError = String(error?.name || error);
            }
            return {
                index,
                title,
                src,
                visible: isVisible(frame),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                deepResearch,
                accessible,
                accessError,
                text,
                html,
            };
        });
        const matched = iframes.find((frame) => frame.deepResearch) || null;
        return {
            url: window.location.href,
            title: document.title,
            iframes,
            deepResearchIframe: matched,
        };
    })()`)), 'chatgpt deep research iframe state');

    const generating = await isGenerating(page).catch(() => false);
    const iframe = iframeState.deepResearchIframe;
    const currentConversationId = conversationIdFromUrl(iframeState.url);
    if (conversationId) {
        if (!currentConversationId) {
            throw new CommandExecutionError(
                `ChatGPT deep-research-result did not stay on requested conversation ${conversationId}.`,
            );
        }
        if (currentConversationId !== conversationId) {
            throw new CommandExecutionError(
                `ChatGPT deep-research-result conversation mismatch: expected ${conversationId}, current page is ${currentConversationId}.`,
            );
        }
    }
    const diagnostics = {
        iframeCount: Array.isArray(iframeState.iframes) ? iframeState.iframes.length : 0,
        iframe: iframe ? {
            index: iframe.index,
            title: iframe.title,
            src: iframe.src,
            visible: iframe.visible,
            width: iframe.width,
            height: iframe.height,
            accessible: iframe.accessible,
            accessError: iframe.accessError || '',
        } : null,
        methodsTried: ['main-document-iframe'],
        methodsSkipped: useBridgeProbes ? [] : ['browser-frames', 'cdp-accessibility', 'network-capture'],
    };

    if (useBridgeProbes && typeof page.readNetworkCapture === 'function') {
        diagnostics.methodsTried.push('network-conversation-widget-state');
        try {
            const entries = await withTimeout(page.readNetworkCapture(), 5000, 'network capture read');
            const relevantEntries = (Array.isArray(entries) ? entries : [])
                .filter((entry) => /\/backend-api\/conversation\/|deep|research|oaiusercontent|ecosystem|widget/i.test(String(entry?.url || '')));
            diagnostics.networkEntries = relevantEntries
                .slice(-20)
                .map((entry) => ({
                    url: entry.url,
                    status: entry.responseStatus ?? entry.status ?? 0,
                    contentType: entry.responseContentType ?? '',
                    preview: String(entry.responsePreview || '').slice(0, 500),
                    bodySize: Number(entry.responseBodyFullSize || 0) || undefined,
                    bodyTruncated: entry.responseBodyTruncated === true || undefined,
                }));
            const extracted = extractDeepResearchFromNetworkEntries(relevantEntries, { expectedConversationId: conversationId });
            if (extracted) {
                diagnostics.networkConversation = {
                    foundReport: true,
                    reportLength: extracted.reportLength || extracted.report.length,
                    sourceCount: Array.isArray(extracted.sources) ? extracted.sources.length : 0,
                };
                return {
                    status: 'completed',
                    report: extracted.report,
                    html: '',
                    url: iframeState.url,
                    method: extracted.method,
                    sources: extracted.sources || [],
                    diagnostics,
                };
            }
        } catch (error) {
            if (error instanceof CommandExecutionError) throw error;
            diagnostics.networkConversationError = String(error?.message || error);
        }
    }

    const fetchConversationId = conversationId || currentConversationId;
    if (fetchConversationId) {
        diagnostics.methodsTried.push('conversation-widget-state');
        try {
            const conversation = await fetchChatGPTConversationPayload(page, fetchConversationId);
            if (conversation?.error) {
                diagnostics.conversationError = conversation.error;
            } else {
                const extracted = extractDeepResearchFromConversationPayload(conversation?.payload, {
                    expectedConversationId: fetchConversationId,
                });
                diagnostics.conversation = {
                    status: conversation?.status || 0,
                    contentType: conversation?.contentType || '',
                    transport: conversation?.transport || '',
                    foundReport: !!extracted,
                    reportLength: extracted?.reportLength || 0,
                    widgetStatus: extracted?.widgetStatus || '',
                    sourceCount: Array.isArray(extracted?.sources) ? extracted.sources.length : 0,
                };
                if (extracted) {
                    return {
                        status: 'completed',
                        report: extracted.report,
                        html: '',
                        url: iframeState.url,
                        method: extracted.method,
                        sources: extracted.sources || [],
                        diagnostics,
                    };
                }
            }
        } catch (error) {
            if (error instanceof CommandExecutionError) throw error;
            diagnostics.conversationError = String(error?.message || error);
        }
    }

    if (iframe?.text && looksLikeDeepResearchReport(iframe.text)) {
        return {
            status: 'completed',
            report: normalizeDeepResearchText(iframe.text),
            html: iframe.html || '',
            url: iframeState.url,
            method: 'same-origin-iframe-dom',
            sources: [],
            diagnostics,
        };
    }

    if (!iframe) {
        return {
            status: generating ? 'running' : 'not_found',
            report: '',
            html: '',
            url: iframeState.url,
            method: 'main-document-dom',
            sources: [],
            diagnostics,
        };
    }

    if (useBridgeProbes && typeof page.frames === 'function' && typeof page.evaluateInFrame === 'function') {
        try {
            const frames = await withTimeout(page.frames(), 3000, 'browser frames');
            diagnostics.frames = Array.isArray(frames) ? frames : [];
            for (let index = 0; index < diagnostics.frames.length; index += 1) {
                const frameInfo = diagnostics.frames[index];
                const frameText = unwrapEvaluateResult(await withTimeout(
                    page.evaluateInFrame('document.body?.innerText || document.body?.textContent || ""', index),
                    3000,
                    'frame eval',
                ));
                const text = normalizeDeepResearchText(frameText);
                if ((/deep-research|connector_openai_deep_research/i.test(String(frameInfo?.url || '')) || looksLikeDeepResearchReport(text))
                    && looksLikeDeepResearchReport(text)) {
                    return {
                        status: 'completed',
                        report: text,
                        html: '',
                        url: iframeState.url,
                        method: 'browser-frame-dom',
                        sources: [],
                        diagnostics,
                    };
                }
            }
        } catch (error) {
            diagnostics.frameError = String(error?.message || error);
        }
    }

    if (useBridgeProbes && typeof page.cdp === 'function') {
        try {
            const frameTree = await withTimeout(page.cdp('Page.getFrameTree', {}), 5000, 'Page.getFrameTree');
            diagnostics.frameTree = frameTree;
            const stack = [frameTree?.frameTree].filter(Boolean);
            const frames = [];
            while (stack.length) {
                const node = stack.shift();
                const frame = node?.frame;
                const url = String(frame?.url || frame?.unreachableUrl || '');
                if (frame?.id && /deep-research|connector_openai_deep_research|oaiusercontent/i.test(url)) {
                    frames.push({ frameId: frame.id, url });
                }
                for (const child of node?.childFrames || []) stack.push(child);
            }
            diagnostics.cdpFrames = frames;
            for (const frame of frames) {
                const tree = await withTimeout(page.cdp('Accessibility.getFullAXTree', {
                    frameId: frame.frameId,
                    sessionId: 'target',
                    targetUrl: frame.url,
                }), 5000, 'Accessibility.getFullAXTree').catch(() => null);
                const text = collectAxText(tree);
                if (looksLikeDeepResearchReport(text)) {
                    return {
                        status: 'completed',
                        report: text,
                        html: '',
                        url: iframeState.url,
                        method: 'cdp-accessibility-frame',
                        sources: [],
                        diagnostics,
                    };
                }
            }
        } catch (error) {
            diagnostics.cdpError = String(error?.message || error);
        }
    }

    if (useBridgeProbes && typeof page.readNetworkCapture === 'function' && !diagnostics.networkEntries) {
        try {
            const entries = await withTimeout(page.readNetworkCapture(), 3000, 'network capture read');
            diagnostics.networkEntries = (Array.isArray(entries) ? entries : [])
                .filter((entry) => /deep|research|oaiusercontent|ecosystem|widget/i.test(String(entry?.url || '')))
                .slice(-20)
                .map((entry) => ({
                    url: entry.url,
                    status: entry.responseStatus ?? entry.status ?? 0,
                    contentType: entry.responseContentType ?? '',
                    preview: String(entry.responsePreview || '').slice(0, 500),
                }));
            const candidate = diagnostics.networkEntries
                .map((entry) => entry.preview)
                .find((preview) => looksLikeDeepResearchReport(preview));
            if (candidate) {
                return {
                    status: 'completed',
                    report: normalizeDeepResearchText(candidate),
                    html: '',
                    url: iframeState.url,
                    method: 'network-capture',
                    sources: [],
                    diagnostics,
                };
            }
        } catch (error) {
            diagnostics.networkError = String(error?.message || error);
        }
    }

    return {
        status: generating ? 'running' : 'unavailable',
        report: '',
        html: '',
        url: iframeState.url,
        method: 'cross-origin-iframe-detected',
        sources: [],
        diagnostics,
    };
}

export async function waitForChatGPTDeepResearchResult(page, { conversationId = '', timeoutSeconds = 120, stableSeconds = 6 } = {}) {
    const startTime = Date.now();
    let lastReport = '';
    let stableStartedAt = 0;

    while (Date.now() - startTime < timeoutSeconds * 1000) {
        const result = await getChatGPTDeepResearchResult(page, { conversationId, useBridgeProbes: true });
        if (result.status === 'completed' && result.report) {
            if (/conversation-widget-state/.test(result.method || '')) {
                return { ...result, stableSeconds: 0 };
            }
            if (result.report === lastReport) {
                if (!stableStartedAt) stableStartedAt = Date.now();
                const elapsedSeconds = Math.floor((Date.now() - stableStartedAt) / 1000);
                if (elapsedSeconds >= stableSeconds) {
                    return { ...result, stableSeconds: elapsedSeconds };
                }
            } else {
                lastReport = result.report;
                stableStartedAt = Date.now();
            }
        }
        await page.wait(3);
    }

    throw new TimeoutError(
        'chatgpt deep-research-result',
        timeoutSeconds,
        'Deep Research did not complete or become extractable before timeout.',
    );
}

export function messageHtmlToMarkdown(html) {
    try {
        return htmlToMarkdown(html).trim();
    } catch {
        return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
}

export async function getBubbleCount(page) {
    const messages = await getVisibleMessages(page);
    return messages.length;
}

function cleanPromptText(str) {
    return String(str || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function responsePairKey(user, assistant) {
    return JSON.stringify([
        cleanPromptText(user?.Text),
        String(assistant?.Text || '').trim(),
    ]);
}

export function getChatGPTResponsePairKeys(messages, prompt) {
    const promptKey = cleanPromptText(prompt);
    if (!promptKey) return [];
    const keys = [];
    for (let index = 0; index < messages.length; index += 1) {
        const user = messages[index];
        if (user?.Role !== 'User' || cleanPromptText(user.Text) !== promptKey) continue;
        const assistant = messages.slice(index + 1).find((message) => message?.Role === 'Assistant');
        if (!assistant || !String(assistant.Text || '').trim()) continue;
        keys.push(responsePairKey(user, assistant));
    }
    return keys;
}

export function getChatGPTResponsePairCounts(messages, prompt) {
    const counts = new Map();
    for (const key of getChatGPTResponsePairKeys(messages, prompt)) {
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function normalizeBaselinePairCounts(options) {
    if (options.baselinePairCounts instanceof Map) return options.baselinePairCounts;
    return new Map(Array.from(options.baselinePairKeys || []).map((key) => [key, 1]));
}

function findLatestNewAssistantResponse(messages, prompt, baselinePairCounts) {
    const promptKey = cleanPromptText(prompt);
    if (!promptKey) return '';
    const currentPairCounts = getChatGPTResponsePairCounts(messages, prompt);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const user = messages[index];
        if (user?.Role !== 'User' || cleanPromptText(user.Text) !== promptKey) continue;
        const assistantIndex = messages.findIndex((message, candidateIndex) => (
            candidateIndex > index
            && message?.Role === 'Assistant'
            && String(message.Text || '').trim()
        ));
        if (assistantIndex < 0) continue;
        const assistant = messages[assistantIndex];
        const key = responsePairKey(user, assistant);
        if ((currentPairCounts.get(key) || 0) <= (baselinePairCounts.get(key) || 0)) continue;
        return String(assistant.Text || '').trim();
    }
    return '';
}

export async function waitForChatGPTResponse(page, baselineCount, prompt, timeoutSeconds, options = {}) {
    const startTime = Date.now();
    let lastText = '';
    let stableCount = 0;
    const baselinePairCounts = normalizeBaselinePairCounts(options);

    while (Date.now() - startTime < timeoutSeconds * 1000) {
        await page.wait(3);
        if (options.conversationUrl) {
            const currentUrl = await currentChatGPTUrl(page);
            if (currentUrl && !isSameChatGPTConversation(currentUrl, options.conversationUrl)) {
                throw new CommandExecutionError(
                    `ChatGPT navigated away from the target conversation (${options.conversationUrl}); current URL is ${currentUrl}`,
                );
            }
        }
        if (await isGenerating(page)) {
            stableCount = 0;
            continue;
        }

        const messages = await getVisibleMessages(page);
        const candidate = findLatestNewAssistantResponse(messages, prompt, baselinePairCounts);
        if (!candidate || candidate === String(prompt || '').trim()) continue;

        if (candidate === lastText) {
            stableCount += 1;
            if (stableCount >= 2) return candidate;
        } else {
            lastText = candidate;
            stableCount = 0;
        }
    }

    throw new TimeoutError(
        'chatgpt ask',
        timeoutSeconds,
        'No ChatGPT response appeared before timeout. Re-run with a higher --timeout if it is still generating.',
    );
}

export async function getConversationList(page) {
    // ensureOnChatGPT already waits for the composer selector after navigation,
    // so the previous standalone 2 s settle is redundant.
    await ensureOnChatGPT(page);

    const openSidebar = requireBooleanEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('button'))
            .find((node) => /open sidebar/i.test(node.getAttribute('aria-label') || ''));
        if (button instanceof HTMLElement) {
            button.click();
            return true;
        }
        return false;
    })()`)), 'chatgpt sidebar open state');
    if (openSidebar) {
        try {
            await page.wait({ selector: CONVERSATION_LINK_SELECTOR, timeout: 3 });
        } catch {
            // Sidebar slide-in didn't surface conversation links; extractConversationLinks below tolerates empty and falls back to home goto.
        }
    }

    let items = await extractConversationLinks(page);
    if (!items.length) {
        await page.goto(CHATGPT_URL, { settleMs: 2000 });
        try {
            await page.wait({ selector: CONVERSATION_LINK_SELECTOR, timeout: 8 });
        } catch {
            // No conversation links visible after fallback goto; extractConversationLinks returns empty.
        }
        items = await extractConversationLinks(page);
    }

    return items;
}

async function extractConversationLinks(page) {
    const items = requireArrayEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const links = Array.from(document.querySelectorAll('a[href*="/c/"]'))
            .filter((link) => link instanceof HTMLAnchorElement && isVisible(link));
        const seen = new Set();
        const rows = [];
        for (const link of links) {
            const href = link.getAttribute('href') || '';
            const match = href.match(/\\/c\\/([^/?#]+)/);
            if (!match || seen.has(match[1])) continue;
            seen.add(match[1]);
            const title = (link.innerText || link.textContent || '').replace(/\\s+/g, ' ').trim() || '(untitled)';
            rows.push({
                Id: match[1],
                Title: title,
                Url: href.startsWith('http') ? href : ('${CHATGPT_URL}' + href),
            });
        }
        return rows;
    })()`)), 'chatgpt conversation link extraction');
    return items.map((item, index) => ({
        Index: index + 1,
        Id: String(item?.Id || ''),
        Title: String(item?.Title || '(untitled)').trim() || '(untitled)',
        Url: String(item?.Url || ''),
    })).filter((item) => item.Id);
}

function imageMimeFromPath(filePath) {
    const lower = String(filePath || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.heic')) return 'image/heic';
    if (lower.endsWith('.heif')) return 'image/heif';
    return 'image/jpeg';
}

export async function prepareChatGPTImagePaths(imagePaths) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const absPaths = imagePaths.map(filePath => path.default.resolve(filePath));
    const allowedExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);

    for (const absPath of absPaths) {
        if (!fs.default.existsSync(absPath)) {
            return { ok: false, reason: `Image not found: ${absPath}` };
        }
        const stat = fs.default.statSync(absPath);
        if (!stat.isFile()) {
            return { ok: false, reason: `Not a file: ${absPath}` };
        }
        if (stat.size > 25 * 1024 * 1024) {
            return { ok: false, reason: `Image too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max: 25 MB` };
        }
        const ext = path.default.extname(absPath).toLowerCase();
        if (!allowedExts.has(ext)) {
            return { ok: false, reason: `Unsupported image type: ${absPath}` };
        }
    }

    return { ok: true, paths: absPaths };
}

async function waitForChatGPTUploadPreview(page, fileNames) {
    const namesJson = JSON.stringify(fileNames);
    for (let attempt = 0; attempt < 10; attempt += 1) {
        await page.wait(1);
        const ready = requireBooleanEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
            (() => {
                const names = ${namesJson};
                const text = document.body ? (document.body.innerText || '') : '';
                const matchedNames = names.filter(name => text.includes(name)).length;
                if (matchedNames >= names.length) return true;

                const composer = document.querySelector('[aria-label="Chat with ChatGPT"], [placeholder="Ask anything"], #prompt-textarea');
                let root = composer;
                for (let i = 0; i < 6 && root && root.parentElement; i += 1) root = root.parentElement;
                const scope = root || document.body;
                if (!scope) return false;

                const isVisibleMedia = (node) => {
                    if (!(node instanceof HTMLElement)) return false;
                    const style = window.getComputedStyle(node);
                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                    const rect = node.getBoundingClientRect();
                    const width = node.naturalWidth || node.videoWidth || rect.width || 0;
                    const height = node.naturalHeight || node.videoHeight || rect.height || 0;
                    if (width > 32 && height > 32) return true;
                    const backgroundImage = style.backgroundImage || '';
                    return /url\\(/.test(backgroundImage) && rect.width > 32 && rect.height > 32;
                };
                const previewNodes = Array.from(scope.querySelectorAll('img[src], canvas, video, [style*="background-image"]')).filter(isVisibleMedia);
                return previewNodes.length >= names.length;
            })()
        `)), 'chatgpt upload preview detection');
        if (ready) return true;
    }
    return false;
}

export async function uploadChatGPTImages(page, imagePaths) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const prepared = await prepareChatGPTImagePaths(imagePaths);
    if (!prepared.ok) return prepared;
    const absPaths = prepared.paths;

    const fileNames = absPaths.map(filePath => path.default.basename(filePath));

    let uploaded = false;
    if (page.setFileInput) {
        try {
            await page.setFileInput(absPaths, 'input[type="file"]');
            uploaded = true;
        } catch (err) {
            const msg = String(err?.message || err);
            if (!msg.includes('Unknown action') && !msg.includes('not supported') && !msg.includes('Not allowed') && !msg.includes('No element found')) {
                throw err;
            }
        }
    }

    if (!uploaded) {
        const files = absPaths.map(absPath => ({
            name: path.default.basename(absPath),
            mime: imageMimeFromPath(absPath),
            base64: fs.default.readFileSync(absPath).toString('base64'),
        }));
        const fallbackResult = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
            (() => {
                const files = ${JSON.stringify(files)};
                const input = document.querySelector('input[type="file"]');
                if (!(input instanceof HTMLInputElement)) {
                    return { ok: false, reason: 'file input not found' };
                }

                const dt = new DataTransfer();
                for (const item of files) {
                    const binary = atob(item.base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
                    dt.items.add(new File([bytes], item.name, { type: item.mime }));
                }
                input.files = dt.files;

                const propsKey = Object.keys(input).find(key => key.startsWith('__reactProps$'));
                if (propsKey && input[propsKey] && typeof input[propsKey].onChange === 'function') {
                    const nativeEvent = new Event('change', { bubbles: true });
                    input[propsKey].onChange({
                        target: input,
                        currentTarget: input,
                        nativeEvent,
                        preventDefault() {},
                        stopPropagation() {},
                        isDefaultPrevented() { return false; },
                        isPropagationStopped() { return false; },
                        persist() {},
                    });
                } else {
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return { ok: true };
            })()
        `)), 'chatgpt image upload fallback');
        if (fallbackResult && !fallbackResult.ok) return fallbackResult;
    }

    const ready = await waitForChatGPTUploadPreview(page, fileNames);
    if (!ready) return { ok: false, reason: 'image upload preview did not appear' };

    return { ok: true, files: absPaths };
}

/**
 * Check if ChatGPT is still generating a response.
 */
export async function isGenerating(page) {
    return requireBooleanEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
        (() => {
            const text = (document.body?.innerText || '').replace(/\\s+/g, ' ');
            if (/正在思考|停止生成|Thinking/.test(text)) return true;
            return Array.from(document.querySelectorAll('button')).some(b => {
                const label = b.getAttribute('aria-label') || '';
                return label === 'Stop generating'
                    || label.includes('Thinking')
                    || label.includes('停止生成')
                    || label.includes('正在思考');
            });
        })()
    `)), 'chatgpt generation state');
}

/**
 * Get visible image URLs from the ChatGPT page (excluding profile/avatar images).
 */
export async function getChatGPTVisibleImageUrls(page) {
    return requireArrayEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
        (() => {
            const isVisible = (el) => {
                if (!(el instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 32 && rect.height > 32;
            };

            const urls = [];
            const seen = new Set();
            const normalizeUrl = (value) => {
                const raw = String(value || '').trim();
                if (!raw || raw === 'none') return '';
                if (/^(?:https?:|blob:|data:)/i.test(raw)) return raw;
                try {
                    return new URL(raw, window.location.href).href;
                } catch {
                    return raw;
                }
            };
            const addUrl = (value) => {
                const src = normalizeUrl(value);
                if (!src || seen.has(src)) return;
                seen.add(src);
                urls.push(src);
            };
            const isDecorative = (el, src = '') => {
                const alt = (el.getAttribute('alt') || '').toLowerCase();
                const cls = String(el.className || '').toLowerCase();
                const testId = (el.getAttribute('data-testid') || '').toLowerCase();
                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                const text = [alt, cls, testId, label, src.toLowerCase()].join(' ');
                return /avatar|profile|logo|icon/.test(text);
            };
            const isUserUploadPreview = (img) => {
                const alt = (img.getAttribute('alt') || '').toLowerCase();
                const turn = img.closest('section[data-testid^="conversation-turn"]');
                const heading = (turn?.querySelector('h4')?.innerText || '').toLowerCase();
                if (/you said|你说/.test(heading)) return true;
                if (/chatgpt|assistant|助手/.test(heading)) return false;
                const openButtonLabel = (img.closest('button[aria-label^="Open image:"]')?.getAttribute('aria-label') || '').toLowerCase();
                const previewText = [alt, openButtonLabel].join(' ');
                return /\.(png|jpe?g|webp|gif|heic|heif)(?:\b|$)/i.test(previewText)
                    || /ref-|reference|参考|upload|uploaded|attachment/.test(previewText);
            };

            const imgs = Array.from(document.querySelectorAll('img')).filter(img =>
                img instanceof HTMLImageElement && isVisible(img)
            );

            for (const img of imgs) {
                const src = img.currentSrc || img.src || '';
                const width = img.naturalWidth || img.width || 0;
                const height = img.naturalHeight || img.height || 0;

                if (!src) continue;
                if (isDecorative(img, src)) continue;
                if (isUserUploadPreview(img)) continue;
                if (width < 128 && height < 128) continue;
                addUrl(src);
            }

            // ChatGPT occasionally renders generated images as CSS background
            // thumbnails instead of plain <img> nodes. Treat visible, large
            // background images as generated-image candidates too.
            for (const el of Array.from(document.querySelectorAll('[style*="background-image"], [style*="background"]'))) {
                if (!(el instanceof HTMLElement) || !isVisible(el) || isDecorative(el)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width < 128 && rect.height < 128) continue;
                const backgroundImage = window.getComputedStyle(el).backgroundImage || '';
                for (const match of backgroundImage.matchAll(/url\\((['"]?)(.*?)\\1\\)/g)) {
                    const src = match[2];
                    if (!src || isDecorative(el, src)) continue;
                    addUrl(src);
                }
            }

            // Some ChatGPT image surfaces mount large transparent canvases as
            // placeholders/overlays before the real backend image is ready. If
            // those data URLs are accepted as generated assets, the adapter can
            // save a blank transparent PNG while reporting success. Prefer real
            // <img>/background URLs; only keep a canvas if it contains at least
            // one non-transparent/non-white sampled pixel.
            for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
                if (!(canvas instanceof HTMLCanvasElement) || !isVisible(canvas) || isDecorative(canvas)) continue;
                const width = canvas.width || canvas.getBoundingClientRect().width || 0;
                const height = canvas.height || canvas.getBoundingClientRect().height || 0;
                if (width < 128 && height < 128) continue;
                try {
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    if (!ctx) continue;
                    const sourceWidth = Math.max(1, Math.floor(canvas.width || width));
                    const sourceHeight = Math.max(1, Math.floor(canvas.height || height));
                    const xCount = Math.min(sourceWidth, 16);
                    const yCount = Math.min(sourceHeight, 16);
                    let hasContent = false;
                    for (let yi = 0; yi < yCount && !hasContent; yi += 1) {
                        const y = Math.min(sourceHeight - 1, Math.floor((yi + 0.5) * sourceHeight / yCount));
                        for (let xi = 0; xi < xCount && !hasContent; xi += 1) {
                            const x = Math.min(sourceWidth - 1, Math.floor((xi + 0.5) * sourceWidth / xCount));
                            const pixel = ctx.getImageData(x, y, 1, 1).data;
                            const r = pixel[0];
                            const g = pixel[1];
                            const b = pixel[2];
                            const a = pixel[3];
                            if (a > 0 && !(r > 248 && g > 248 && b > 248)) {
                                hasContent = true;
                                break;
                            }
                        }
                    }
                    if (hasContent) addUrl(canvas.toDataURL('image/png'));
                } catch { }
            }
            return urls;
        })()
    `)), 'chatgpt visible image url extraction');
}

/**
 * Wait for new images to appear after sending a prompt.
 */
export async function waitForChatGPTImages(page, beforeUrls, timeoutSeconds, convUrl) {
    const beforeSet = new Set(beforeUrls);
    const pollIntervalSeconds = 3;
    const maxPolls = Math.max(1, Math.ceil(timeoutSeconds / pollIntervalSeconds));
    let lastUrls = [];
    let stableCount = 0;

    for (let i = 0; i < maxPolls; i++) {
        await page.wait(i === 0 ? 3 : pollIntervalSeconds);

        let currentUrl = '';
        if (convUrl && convUrl.includes('/c/')) {
            currentUrl = unwrapEvaluateResult(await page.evaluate('window.location.href').catch(() => ''));
            if (currentUrl && !isSameChatGPTConversation(currentUrl, convUrl)) {
                await page.goto(convUrl);
                await page.wait(3);
            }
        }

        const generating = await isGenerating(page);
        if (generating) continue;

        if (convUrl && convUrl.includes('/c/') && i > 0 && i % 5 === 0) {
            const onConversation = !currentUrl || isSameChatGPTConversation(currentUrl, convUrl);
            if (onConversation) {
                await page.goto(convUrl);
                await page.wait(3);
            }
        }

        const urls = (await getChatGPTVisibleImageUrls(page)).filter(url => !beforeSet.has(url));
        if (urls.length === 0) continue;

        const key = urls.join('\n');
        const prevKey = lastUrls.join('\n');
        if (key === prevKey) {
            stableCount += 1;
        } else {
            lastUrls = urls;
            stableCount = 1;
        }

        if (stableCount >= 2 || i === maxPolls - 1) {
            return lastUrls;
        }
    }
    return lastUrls;
}

/**
 * Get the list of ChatGPT Projects from the sidebar.
 * Navigates to chatgpt.com if not already there, opens the sidebar,
 * and extracts project links (matching /g/g-p-*).
 */
export async function getProjectList(page) {
    await ensureOnChatGPT(page);

    // Ensure sidebar is open
    const openSidebar = requireBooleanEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('button'))
            .find((node) => /open sidebar/i.test(node.getAttribute('aria-label') || ''));
        if (button instanceof HTMLElement) {
            button.click();
            return true;
        }
        return false;
    })()`)), 'chatgpt sidebar open state');
    if (openSidebar) {
        await page.wait(0.5);
    }

    // Click "Show more" to reveal all projects
    await page.evaluate(`(() => {
        var btn = Array.from(document.querySelectorAll('button')).find(function(b) {
            var text = (b.innerText || '').trim();
            return text === 'Show more' || text === '显示更多' || text === '查看更多';
        });
        if (btn instanceof HTMLElement) {
            btn.click();
        }
    })()`);
    await page.wait(0.5);

    let items = await extractProjectLinks(page);
    if (!items.length) {
        await page.goto(CHATGPT_URL, { settleMs: 2000 });
        await page.wait(1);
        // Try clicking Show more again on fresh page
        await page.evaluate(`(() => {
            var btn = Array.from(document.querySelectorAll('button')).find(function(b) {
                var text = (b.innerText || '').trim();
                return text === 'Show more' || text === '显示更多' || text === '查看更多';
            });
            if (btn instanceof HTMLElement) {
                btn.click();
            }
        })()`);
        await page.wait(0.5);
        items = await extractProjectLinks(page);
    }

    return items;
}

async function extractProjectLinks(page) {
    const items = requireArrayEvaluateResult(unwrapEvaluateResult(await page.evaluate(`(() => {
        const projectLinkSelector = ${JSON.stringify(PROJECT_LINK_SELECTOR)};
        const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const cleanText = (value) => String(value || '').replace(new RegExp('\\\\s+', 'g'), ' ').trim();
        const trustedHost = (hostname) => hostname === '${CHATGPT_DOMAIN}' || hostname.endsWith('.${CHATGPT_DOMAIN}');
        const projectIdFromPathname = (pathname) => {
            const match = String(pathname || '').match(new RegExp('^/g/g-p-([a-f0-9]{8,})(?:[-/]|$)', 'i'));
            return match ? match[1].toLowerCase() : '';
        };
        const parseProjectId = (value) => {
            const raw = String(value || '').trim();
            if (new RegExp('^https?://', 'i').test(raw) || raw.startsWith('/')) {
                try {
                    const url = new URL(raw, '${CHATGPT_URL}');
                    if (url.protocol !== 'https:' || !trustedHost(url.hostname)) return '';
                    return projectIdFromPathname(url.pathname);
                } catch {
                    return '';
                }
            }
            const slugMatch = raw.match(new RegExp('^g-p-([a-f0-9]{8,})', 'i'));
            if (slugMatch) return slugMatch[1].toLowerCase();
            if (new RegExp('^[a-f0-9]{8,}$', 'i').test(raw)) return raw.toLowerCase();
            return '';
        };
        const normalizeProjectUrl = (href, projectId) => {
            try {
                const url = new URL(href, '${CHATGPT_URL}');
                if (url.protocol !== 'https:' || !trustedHost(url.hostname)) return '';
                if (projectIdFromPathname(url.pathname) !== projectId) return '';
                url.search = '';
                url.hash = '';
                return url.href.endsWith('/') ? url.href.slice(0, -1) : url.href;
            } catch {
                return '${CHATGPT_URL}' + '/g/g-p-' + projectId;
            }
        };

        var seen = new Set();
        var rows = [];
        const addRow = (projectId, title, url) => {
            if (!projectId || seen.has(projectId)) return;
            seen.add(projectId);
            rows.push({
                Id: projectId,
                Title: cleanText(title) || '(untitled project)',
                Url: url || ('${CHATGPT_URL}' + '/g/g-p-' + projectId),
            });
        };

        // Prefer explicit project anchors when the sidebar exposes them. This is
        // stable across React internals and matches the URL shape documented by
        // PROJECT_LINK_SELECTOR.
        for (const link of Array.from(document.querySelectorAll(projectLinkSelector))) {
            if (!isVisible(link)) continue;
            const href = link.getAttribute('href') || link.href || '';
            const projectId = parseProjectId(href);
            if (!projectId) continue;
            const container = link.closest('[data-sidebar-item="true"]') || link;
            addRow(projectId, cleanText(container.innerText || container.textContent || link.textContent), normalizeProjectUrl(href, projectId));
        }

        // Fallback for ChatGPT sidebar builds that render project rows without
        // anchors but keep gizmo data on React Fiber props.
        const projectEls = Array.from(document.querySelectorAll('[data-sidebar-item="true"]'))
            .filter(function(el) {
                if (!isVisible(el)) return false;
                var icon = el.querySelector('[data-testid="project-folder-icon"]');
                if (!icon) return false;
                var text = cleanText(el.innerText || el.textContent);
                if (!text) return false;
                if (el.getAttribute('data-testid') === 'accounts-profile-button') return false;
                return true;
            });

        for (var i = 0; i < projectEls.length; i++) {
            var el = projectEls[i];
            var title = cleanText(el.innerText || el.textContent);
            var projectId = '';
            var shortUrl = '';
            var fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); });
            if (fiberKey) {
                var f = el[fiberKey];
                for (var d = 0; f && d < 15; d++) {
                    var props = f.memoizedProps || f.pendingProps;
                    if (props && props.gizmo) {
                        var g = props.gizmo;
                        var gId = g.gizmo && g.gizmo.id ? g.gizmo.id : g.id;
                        var gIdMatch = String(gId || '').match(new RegExp('^g-p-([a-f0-9]{8,})(?:-|$)', 'i'));
                        if (gIdMatch) {
                            projectId = gIdMatch[1].toLowerCase();
                            shortUrl = String(g.short_url || g.gizmo && g.gizmo.short_url || '');
                            break;
                        }
                    }
                    f = f.return;
                }
            }
            if (!projectId) continue;
            var url = shortUrl ? '${CHATGPT_URL}' + '/g/' + shortUrl : '${CHATGPT_URL}' + '/g/g-p-' + projectId;
            addRow(projectId, title, url);
        }

        return rows;
    })()`)), 'chatgpt project link extraction');
    return items.map(function(item, index) {
        return {
            Index: index + 1,
            Id: String(item?.Id || ''),
            Title: String(item?.Title || '(untitled project)').trim() || '(untitled project)',
            Url: String(item?.Url || ''),
        };
    }).filter(function(item) { return item.Id; });
}

/**
 * Navigate to a ChatGPT project page.
 */
const PROJECT_ADD_FILES_LABELS = [
    'Add files',
    'Add sources',
    '添加文件',
    'Project files',
    '项目文件',
];

const PROJECT_ADD_FILES_DIALOG_SELECTORS = [
    '[role="tabpanel"][data-state="active"] [data-project-home-sources-surface="true"] input[type="file"]:not([accept])',
    '[data-project-home-sources-surface="true"] input[type="file"]:not([accept])',
    '[role="dialog"] input[type="file"]',
    '[data-testid*="project-files"] input[type="file"]',
    '[data-testid*="project"] input[type="file"]',
];

/**
 * Navigate to a ChatGPT project page.
 */
export async function navigateToProject(page, projectId) {
    const id = parseChatGPTProjectId(projectId);
    await page.goto(`${CHATGPT_URL}/g/g-p-${id}`, { settleMs: 2000 });
    try {
        await page.wait({ selector: COMPOSER_WAIT_SELECTOR, timeout: 10 });
    } catch {
        // Composer may not mount if project requires login; downstream ensureChatGPTLogin handles it.
    }
    const state = await getPageState(page);
    if (projectIdFromUrl(state.url) === id) return id;
    if (state.hasLoginGate || !state.isLoggedIn) {
        throw new AuthRequiredError(CHATGPT_DOMAIN, 'ChatGPT project requires a logged-in ChatGPT session.');
    }
    throw new CommandExecutionError(
        `ChatGPT did not open the requested project ${id}.`,
        `Current URL: ${state.url || '(unknown)'}`,
    );
}

/**
 * Open the Project knowledge files dialog by clicking the "Add files" button
 * in the project header area (NOT the chat composer's plus button).
 * Returns true if the dialog appeared.
 */
export async function openProjectKnowledgeDialog(page) {
    const rawOpenResult = unwrapEvaluateResult(await page.evaluate(`
        (() => {
            const labels = ${JSON.stringify(PROJECT_ADD_FILES_LABELS)};
            const isVisible = (el) => {
                if (!(el instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };

            // Current ChatGPT project pages expose project knowledge under a
            // Sources tab. Prefer that surface when present; it contains the
            // project-source file input and avoids the chat composer's plus menu.
            const sourceInput = document.querySelector('[data-project-home-sources-surface="true"] input[type="file"]:not([accept])');
            if (sourceInput instanceof HTMLInputElement) return { ok: true };

            const sourcesTab = Array.from(document.querySelectorAll('[role="tab"], button')).find(el => {
                const text = (el.innerText || el.textContent || '').trim();
                const id = el.id || '';
                return text === 'Sources' || text === '资料' || id.includes('-sources');
            });
            if (sourcesTab instanceof HTMLElement) {
                if (sourcesTab.getAttribute('aria-selected') === 'true') return { ok: true };
                const rect = sourcesTab.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const nativeClick = rect.width > 0 && rect.height > 0 && Number.isFinite(centerX) && Number.isFinite(centerY) ? {
                    x: centerX,
                    y: centerY,
                } : null;

                // Radix-powered tabs on the live ChatGPT project page do not
                // respond reliably to HTMLElement.click(); they activate after
                // the same pointer/mouse sequence a real browser click emits.
                const eventInit = {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    view: window,
                    clientX: nativeClick ? nativeClick.x : 0,
                    clientY: nativeClick ? nativeClick.y : 0,
                    button: 0,
                    buttons: 1,
                };
                for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                    const Ctor = type.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
                    sourcesTab.dispatchEvent(new Ctor(type, eventInit));
                }
                return { ok: true, nativeClick };
            }

            // Older project pages opened a dedicated project files dialog.
            // Strategy 1: aria-label or data-testid
            const byAttr = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(el => {
                if (!isVisible(el)) return false;
                if (el.closest('[role="textbox"], #prompt-textarea, [data-testid="composer"], form[data-type="unified-composer"]')) return false;
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                const testid = (el.getAttribute('data-testid') || '').toLowerCase();
                const text = (el.innerText || el.textContent || '').trim();
                if (aria.includes('add sources') || aria.includes('project files')) return true;
                if (aria === 'add files') return true;
                if (testid.includes('add-files') || testid.includes('project-files')) return true;
                if (labels.some(l => text === l)) return true;
                return false;
            });
            if (byAttr instanceof HTMLElement) { byAttr.click(); return { ok: true }; }

            // Strategy 2: look for buttons that contain "Add files"/"Add sources"
            // text, but exclude the composer plus button (which has a different role).
            const allButtons = Array.from(document.querySelectorAll('button'));
            for (const btn of allButtons) {
                if (!isVisible(btn)) continue;
                const text = (btn.innerText || btn.textContent || '').trim();
                if (labels.some(l => text === l) && !btn.closest('[role="textbox"], #prompt-textarea, [data-testid="composer"]')) {
                    btn.click();
                    return { ok: true };
                }
            }

            return { ok: false };
        })()
    `));
    const openResult = typeof rawOpenResult === 'boolean'
        ? { ok: rawOpenResult }
        : requireObjectEvaluateResult(rawOpenResult, 'chatgpt project knowledge dialog open');

    if (openResult.ok) {
        if (openResult.nativeClick && typeof page.nativeClick === 'function') {
            try { await page.nativeClick(openResult.nativeClick.x, openResult.nativeClick.y); } catch {}
        }
        if (openResult.nativeClick && typeof page.click === 'function') {
            try { await page.click('[role="tab"][id$="-sources"]'); } catch {}
        }
        // Wait for the dialog or Sources tab content to appear
        await page.wait(1);
        try {
            await page.wait({ selector: '[role="dialog"], [data-project-home-sources-surface="true"] input[type="file"]', timeout: 5 });
        } catch {
            // Dialog/source input may use a different shape; upload selectors surface the precise failure.
        }
        return true;
    }
    return false;
}

/**
 * Upload files to a ChatGPT Project's knowledge base.
 * This navigates to the project page, opens the knowledge files dialog,
 * and uploads files through the dialog's file input.
 */
export async function uploadChatGPTProjectFiles(page, projectId, filePaths) {
    const id = parseChatGPTProjectId(projectId);
    const fs = await import('node:fs');
    const path = await import('node:path');

    const prepared = await prepareChatGPTFilePaths(filePaths);
    if (!prepared.ok) return { ...prepared, inputError: true };
    const absPaths = prepared.paths;

    // Navigate to project and open knowledge dialog
    await navigateToProject(page, id);
    await ensureChatGPTLogin(page, 'ChatGPT project file upload requires a logged-in ChatGPT session.');

    const dialogOpened = await openProjectKnowledgeDialog(page);
    if (!dialogOpened) {
        return { ok: false, reason: 'could not find or click the project "Add files" button' };
    }

    // Try uploading via dialog file input (multiple selector patterns)
    const fileNames = absPaths.map(fp => path.default.basename(fp));

    let uploaded = false;
    if (page.setFileInput) {
        for (const selector of PROJECT_ADD_FILES_DIALOG_SELECTORS) {
            try {
                await page.setFileInput(absPaths, selector);
                uploaded = true;
                break;
            } catch (err) {
                const msg = String(err?.message || err);
                if (!msg.includes('Unknown action') && !msg.includes('not supported') && !msg.includes('Not allowed') && !msg.includes('No element found')) {
                    throw err;
                }
            }
        }
    }

    if (!uploaded) {
        // Fallback: try all dialog file inputs via evaluate
        const files = absPaths.map(absPath => ({
            name: path.default.basename(absPath),
            mime: mimeFromFilePath(absPath),
            base64: fs.default.readFileSync(absPath).toString('base64'),
        }));
        const fallbackResult = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
            (() => {
                const files = ${JSON.stringify(files)};

                // Look for file input inside a dialog or the project area
                const selectors = ${JSON.stringify(PROJECT_ADD_FILES_DIALOG_SELECTORS)};
                let input = null;
                for (const sel of selectors) {
                    input = document.querySelector(sel);
                    if (input instanceof HTMLInputElement) break;
                }
                // Last resort: stay scoped to project knowledge containers. Do
                // not fall back to arbitrary page inputs, because the composer
                // attachment input can also accept files but uploads them to
                // the conversation instead of project knowledge.
                if (!(input instanceof HTMLInputElement)) {
                    const allFileInputs = document.querySelectorAll('[data-project-home-sources-surface="true"] input[type="file"], [role="dialog"] input[type="file"], [data-testid*="project"] input[type="file"]');
                    for (const fi of allFileInputs) {
                        input = fi;
                        break;
                    }
                }
                if (!(input instanceof HTMLInputElement)) {
                    return { ok: false, reason: 'project file input not found' };
                }

                const dt = new DataTransfer();
                for (const item of files) {
                    const binary = atob(item.base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
                    dt.items.add(new File([bytes], item.name, { type: item.mime }));
                }
                input.files = dt.files;

                const propsKey = Object.keys(input).find(key => key.startsWith('__reactProps$'));
                if (propsKey && input[propsKey] && typeof input[propsKey].onChange === 'function') {
                    const nativeEvent = new Event('change', { bubbles: true });
                    input[propsKey].onChange({
                        target: input,
                        currentTarget: input,
                        nativeEvent,
                        preventDefault() {},
                        stopPropagation() {},
                        isDefaultPrevented() { return false; },
                        isPropagationStopped() { return false; },
                        persist() {},
                    });
                } else {
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return { ok: true };
            })()
        `)), 'chatgpt project file upload fallback');
        if (fallbackResult && !fallbackResult.ok) return fallbackResult;
    }

    const confirmation = await waitForChatGPTProjectUploadConfirmation(page, fileNames);
    if (!confirmation.ok) return confirmation;

    return { ok: true, files: absPaths };
}

async function waitForChatGPTProjectUploadConfirmation(page, fileNames) {
    const expectedFileNames = fileNames.map(name => String(name || '').trim()).filter(Boolean);
    if (!expectedFileNames.length) return { ok: true };

    let lastReason = 'uploaded file did not appear in project knowledge';
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const result = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
            (() => {
                const expectedFileNames = ${JSON.stringify(expectedFileNames)};
                const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
                const root = document.querySelector('[role="dialog"]')
                    || document.querySelector('[data-project-home-sources-surface="true"]')
                    || document.querySelector('[role="tabpanel"][data-state="active"]');
                if (!root) {
                    return { ok: false, pending: true, reason: 'project knowledge surface was not visible after upload' };
                }
                const text = normalize(root?.innerText || root?.textContent || '');
                const errorNode = Array.from((root || document).querySelectorAll('[role="alert"], [data-testid*="error"], [class*="error"]')).find((node) => {
                    const label = normalize(node.innerText || node.textContent || node.getAttribute('aria-label') || '');
                    return /failed|error|unable|could not|too large|unsupported/i.test(label);
                });
                if (errorNode) {
                    return { ok: false, reason: normalize(errorNode.innerText || errorNode.textContent || errorNode.getAttribute('aria-label') || 'project upload failed') };
                }
                const missing = expectedFileNames.filter((name) => !text.includes(name));
                if (!missing.length) return { ok: true };
                return { ok: false, pending: true, reason: 'uploaded file did not appear in project knowledge: ' + missing.join(', ') };
            })()
        `)), 'chatgpt project upload confirmation');

        if (result.ok === true) return { ok: true };
        lastReason = String(result.reason || lastReason);
        if (!result.pending) return { ok: false, reason: lastReason };
        await page.wait(0.5);
    }

    return { ok: false, reason: lastReason };
}

/**
 * Validate local file paths for project file upload.
 * Accepts all file types with a 512 MB per-file limit (matching ChatGPT's project limit).
 */
export async function prepareChatGPTFilePaths(filePaths) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const absPaths = filePaths.map(filePath => path.default.resolve(filePath));

    for (const absPath of absPaths) {
        if (!fs.default.existsSync(absPath)) {
            return { ok: false, reason: `File not found: ${absPath}` };
        }
        const stat = fs.default.statSync(absPath);
        if (!stat.isFile()) {
            return { ok: false, reason: `Not a file: ${absPath}` };
        }
        if (stat.size > 512 * 1024 * 1024) {
            return { ok: false, reason: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max: 512 MB` };
        }
    }

    return { ok: true, paths: absPaths };
}

function mimeFromFilePath(filePath) {
    const lower = String(filePath || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.doc')) return 'application/msword';
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
    if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
    if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (lower.endsWith('.csv')) return 'text/csv';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.xml')) return 'application/xml';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.py')) return 'text/x-python';
    if (lower.endsWith('.js')) return 'text/javascript';
    if (lower.endsWith('.ts')) return 'application/typescript';
    if (lower.endsWith('.jsx')) return 'text/jsx';
    if (lower.endsWith('.tsx')) return 'text/tsx';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
}

export const __test__ = {
    COMPOSER_SELECTORS,
    SEND_BUTTON_SELECTOR,
    SEND_BUTTON_FALLBACK_SELECTORS,
    SEND_BUTTON_LABELS,
    CLOSE_SIDEBAR_LABELS,
    buildComposerLocatorScript,
    isSameChatGPTConversation,
    parseChatGPTConversationId,
    parseChatGPTProjectId,
    extractDeepResearchFromConversationPayload,
    extractDeepResearchFromNetworkEntries,
    extractDeepResearchFromWidgetState,
    looksLikeDeepResearchReport,
    imageMimeFromPath,
    mimeFromFilePath,
    PROJECT_LINK_SELECTOR,
};

/**
 * Export images by URL: fetch from ChatGPT backend API and convert to base64 data URLs.
 */
export async function getChatGPTImageAssets(page, urls) {
    const urlsJson = JSON.stringify(urls);
    return requireArrayEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
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

            const results = [];

            for (const targetUrl of targetUrls) {
                let dataUrl = '';
                let mimeType = 'image/jpeg';
                let width = 0;
                let height = 0;

                // Try to find the img element for size info
                const img = Array.from(document.querySelectorAll('img')).find(el =>
                    (el.currentSrc || el.src || '') === targetUrl
                );
                if (img) {
                    width = img.naturalWidth || img.width || 0;
                    height = img.naturalHeight || img.height || 0;
                } else {
                    const backgroundEl = Array.from(document.querySelectorAll('[style*="background-image"], [style*="background"]')).find(el => {
                        if (!(el instanceof HTMLElement)) return false;
                        const backgroundImage = window.getComputedStyle(el).backgroundImage || '';
                        return Array.from(backgroundImage.matchAll(/url\\((['"]?)(.*?)\\1\\)/g)).some(match => {
                            const raw = String(match[2] || '').trim();
                            if (!raw) return false;
                            if (raw === targetUrl) return true;
                            try {
                                return new URL(raw, window.location.href).href === targetUrl;
                            } catch {
                                return false;
                            }
                        });
                    });
                    if (backgroundEl) {
                        const rect = backgroundEl.getBoundingClientRect();
                        width = Math.round(rect.width || 0);
                        height = Math.round(rect.height || 0);
                    }
                }

                try {
                    if (String(targetUrl).startsWith('data:')) {
                        dataUrl = String(targetUrl);
                        mimeType = (String(targetUrl).match(/^data:([^;]+);/i) || [])[1] || 'image/png';
                    } else {
                        // Try to fetch via CORS from the page's origin
                        const res = await fetch(targetUrl, { credentials: 'include' });
                        if (res.ok) {
                            const blob = await res.blob();
                            mimeType = inferMime(blob.type, targetUrl);
                            dataUrl = await blobToDataUrl(blob);
                        }
                    }
                } catch (e) {
                    // If fetch fails (CORS), try canvas approach via img element
                }

                // Fallback: draw img to canvas
                if (!dataUrl && img && img instanceof HTMLImageElement) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth || img.width || 512;
                        canvas.height = img.naturalHeight || img.height || 512;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.drawImage(img, 0, 0);
                            dataUrl = canvas.toDataURL('image/png');
                            mimeType = 'image/png';
                        }
                    } catch (e) { }
                }

                if (dataUrl) {
                    results.push({ url: String(targetUrl), dataUrl, mimeType, width, height });
                }
            }

            return results;
        })(${urlsJson})
    `)), 'chatgpt image asset export');
}
