/**
 * ChatGPT web browser automation helpers.
 * Cross-platform: works on Linux/macOS/Windows via OpenCLI's CDP browser automation.
 */

import { htmlToMarkdown } from '@jackwener/opencli/utils';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

export const CHATGPT_DOMAIN = 'chatgpt.com';
export const CHATGPT_URL = 'https://chatgpt.com';

// Selectors
const COMPOSER_SELECTORS = [
    '[aria-label="Chat with ChatGPT"]',
    '[aria-label="与 ChatGPT 聊天"]',
    '[placeholder="Ask anything"]',
    '[placeholder="有问题，尽管问"]',
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
    '[contenteditable="true"][role="textbox"]',
];
const SEND_BUTTON_SELECTOR = 'button[data-testid="send-button"]:not([disabled])';
const SEND_BUTTON_FALLBACK_SELECTORS = [
    '#composer-submit-button:not([disabled])',
];
const SEND_BUTTON_LABELS = [
    'Send prompt',
    'Send message',
    'Send',
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
        const marked = document.querySelector('[' + markerAttr + '="1"]');
        if (marked instanceof HTMLElement && isVisible(marked)) return marked;

        for (const selector of ${JSON.stringify(COMPOSER_SELECTORS)}) {
          const node = Array.from(document.querySelectorAll(selector)).find(c => c instanceof HTMLElement && isVisible(c));
          if (node instanceof HTMLElement) {
            node.setAttribute(markerAttr, '1');
            return node;
          }
        }
        return null;
      };

      findComposer.toString = () => 'findComposer';
      return { findComposer, markerAttr };
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

export function parseChatGPTConversationId(value) {
    const raw = String(value ?? '').trim();
    const match = raw.match(/(?:^|\/c\/)([A-Za-z0-9_-]{8,})(?:[/?#]|$)/);
    if (match) return match[1];
    if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) return raw;
    throw new ArgumentError(
        'chatgpt detail requires a conversation id or /c/<id> URL',
        'Example: opencli chatgpt detail 123e4567-e89b-12d3-a456-426614174000',
    );
}

export async function currentChatGPTUrl(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
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

export async function getPageState(page) {
    return await page.evaluate(`(() => {
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
    })()`);
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

    const typeResult = await page.evaluate(`
        (() => {
            ${buildComposerLocatorScript()}
            const composer = findComposer();
            if (!composer) return false;
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
            return true;
        })()
    `);
    
    if (!typeResult) return false;
    
    // Use page.type() which is Playwright's native method
    try {
        if (page.nativeType) {
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
        sent = await page.evaluate(`
            (() => {
                const isUsable = (button) => button
                    && !button.disabled
                    && button.getAttribute('aria-disabled') !== 'true';
                const primary = document.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)})
                    || ${JSON.stringify(SEND_BUTTON_FALLBACK_SELECTORS)}.map(selector => document.querySelector(selector)).find(Boolean);
                const btns = Array.from(document.querySelectorAll('button'));
                const labels = ${JSON.stringify(SEND_BUTTON_LABELS)};
                const sendBtn = isUsable(primary)
                    ? primary
                    : btns.find(b => labels.includes(b.getAttribute('aria-label') || '') && isUsable(b));
                return { sendBtnFound: !!sendBtn };
            })()
        `);
        if (sent?.sendBtnFound) break;
    }

    if (!sent?.sendBtnFound) {
        return false;
    }
    
    await page.evaluate(`
        (() => {
            const primary = document.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)})
                || ${JSON.stringify(SEND_BUTTON_FALLBACK_SELECTORS)}.map(selector => document.querySelector(selector)).find(Boolean);
            const labels = ${JSON.stringify(SEND_BUTTON_LABELS)};
            const sendBtn = primary || Array.from(document.querySelectorAll('button')).find(b => labels.includes(b.getAttribute('aria-label') || '') && !b.disabled);
            if (sendBtn) sendBtn.click();
        })()
    `);
    return true;
}

export async function getVisibleMessages(page) {
    const result = await page.evaluate(`(() => {
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
    })()`);
    if (!Array.isArray(result)) return [];
    return result.map((item, index) => ({
        Index: index + 1,
        Role: item?.role === 'Assistant' ? 'Assistant' : 'User',
        Text: String(item?.text || '').trim(),
        Html: String(item?.html || ''),
    })).filter((item) => item.Text);
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

export async function waitForChatGPTResponse(page, baselineCount, prompt, timeoutSeconds) {
    const startTime = Date.now();
    let lastText = '';
    let stableCount = 0;

    while (Date.now() - startTime < timeoutSeconds * 1000) {
        await page.wait(3);
        if (await isGenerating(page)) {
            stableCount = 0;
            continue;
        }

        const messages = await getVisibleMessages(page);
        const newMessages = messages.slice(Math.max(0, baselineCount));
        const assistant = [...newMessages].reverse().find((m) => m.Role === 'Assistant')
            || [...messages].reverse().find((m) => m.Role === 'Assistant');
        const candidate = String(assistant?.Text || '').trim();
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

    const openSidebar = await page.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('button'))
            .find((node) => /open sidebar/i.test(node.getAttribute('aria-label') || ''));
        if (button instanceof HTMLElement) {
            button.click();
            return true;
        }
        return false;
    })()`);
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
    const items = await page.evaluate(`(() => {
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
    })()`);
    return Array.isArray(items)
        ? items.map((item, index) => ({
            Index: index + 1,
            Id: String(item?.Id || ''),
            Title: String(item?.Title || '(untitled)').trim() || '(untitled)',
            Url: String(item?.Url || ''),
        })).filter((item) => item.Id)
        : [];
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
        const ready = await page.evaluate(`
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

                const previewNodes = scope.querySelectorAll('img[src], canvas, video, [style*="background-image"], [data-testid*="attachment"], [data-testid*="upload"], [class*="attachment"], [class*="upload"]');
                return previewNodes.length >= names.length;
            })()
        `);
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
        const fallbackResult = await page.evaluate(`
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
        `);
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
    return await page.evaluate(`
        (() => {
            return Array.from(document.querySelectorAll('button')).some(b => {
                const label = b.getAttribute('aria-label') || '';
                return label === 'Stop generating' || label.includes('Thinking');
            });
        })()
    `);
}

/**
 * Get visible image URLs from the ChatGPT page (excluding profile/avatar images).
 */
export async function getChatGPTVisibleImageUrls(page) {
    return await page.evaluate(`
        (() => {
            const isVisible = (el) => {
                if (!(el instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 32 && rect.height > 32;
            };

            const imgs = Array.from(document.querySelectorAll('img')).filter(img =>
                img instanceof HTMLImageElement && isVisible(img)
            );

            const urls = [];
            const seen = new Set();

            for (const img of imgs) {
                const src = img.currentSrc || img.src || '';
                const alt = (img.getAttribute('alt') || '').toLowerCase();
                const cls = (img.className || '').toLowerCase();
                const width = img.naturalWidth || img.width || 0;
                const height = img.naturalHeight || img.height || 0;

                if (!src) continue;
                if (alt.includes('avatar') || alt.includes('profile') || alt.includes('logo') || alt.includes('icon')) continue;
                if (cls.includes('avatar') || cls.includes('profile') || cls.includes('icon')) continue;
                if (width < 128 && height < 128) continue;
                if (seen.has(src)) continue;

                seen.add(src);
                urls.push(src);
            }
            return urls;
        })()
    `);
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
            currentUrl = await page.evaluate('window.location.href').catch(() => '');
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

export const __test__ = {
    COMPOSER_SELECTORS,
    SEND_BUTTON_SELECTOR,
    SEND_BUTTON_FALLBACK_SELECTORS,
    SEND_BUTTON_LABELS,
    CLOSE_SIDEBAR_LABELS,
    isSameChatGPTConversation,
    parseChatGPTConversationId,
    imageMimeFromPath,
};

/**
 * Export images by URL: fetch from ChatGPT backend API and convert to base64 data URLs.
 */
export async function getChatGPTImageAssets(page, urls) {
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
    `, urls);
}
