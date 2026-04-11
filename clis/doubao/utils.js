import { CliError } from '@jackwener/opencli/errors';

export const DOUBAO_DOMAIN = 'www.doubao.com';
export const DOUBAO_CHAT_URL = 'https://www.doubao.com/chat';
export const DOUBAO_NEW_CHAT_URL = 'https://www.doubao.com/chat/new-thread/create-by-msg';
function getTranscriptLinesScript() {
    return `
    (() => {
      const clean = (value) => (value || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();

      const root = document.body.cloneNode(true);
      const removableSelectors = [
        '[data-testid="flow_chat_sidebar"]',
        '[data-testid="chat_input"]',
        '[data-testid="flow_chat_guidance_page"]',
      ];

      for (const selector of removableSelectors) {
        root.querySelectorAll(selector).forEach((node) => node.remove());
      }

      root.querySelectorAll('script, style, noscript').forEach((node) => node.remove());

      const stopLines = new Set([
        '豆包',
        '新对话',
        '内容由豆包 AI 生成',
        'AI 创作',
        '云盘',
        '更多',
        '历史对话',
        '手机版对话',
        '快速',
        '超能模式',
        'Beta',
        'PPT 生成',
        '图像生成',
        '帮我写作',
      ]);

      const noisyPatterns = [
        /^window\\._SSR_DATA/,
        /^window\\._ROUTER_DATA/,
        /^\{"namedChunks"/,
        /^在此处拖放文件/,
        /^文件数量：/,
        /^文件类型：/,
      ];

      const transcriptText = clean(root.innerText || root.textContent || '')
        .replace(/新对话/g, '\\n')
        .replace(/内容由豆包 AI 生成/g, '\\n')
        .replace(/在此处拖放文件/g, '\\n')
        .replace(/文件数量：[^\\n]*/g, '')
        .replace(/文件类型：[^\\n]*/g, '');

      return clean(transcriptText)
        .split('\\n')
        .map((line) => clean(line))
        .filter((line) => line
          && line.length <= 400
          && !stopLines.has(line)
          && !noisyPatterns.some((pattern) => pattern.test(line)));
    })()
  `;
}
function getStateScript() {
    return `
    (() => {
      const routerData = window._ROUTER_DATA?.loaderData?.chat_layout;
      const placeholderNode = document.querySelector(
        'textarea[data-testid="chat_input_input"], textarea[placeholder], [contenteditable="true"][placeholder], [aria-label*="发消息"], [aria-label*="Message"]'
      );
      return {
        url: window.location.href,
        title: document.title || '',
        isLogin: typeof routerData?.userSetting?.data?.is_login === 'boolean'
          ? routerData.userSetting.data.is_login
          : null,
        accountDescription: routerData?.accountInfo?.data?.description || '',
        placeholder: placeholderNode?.getAttribute('placeholder')
          || placeholderNode?.getAttribute('aria-label')
          || '',
      };
    })()
  `;
}
function getTurnsScript() {
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

      const getRole = (root) => {
        if (
          root.matches('[data-testid="send_message"], [class*="send-message"]')
          || root.querySelector('[data-testid="send_message"], [class*="send-message"]')
        ) {
          return 'User';
        }
        if (
          root.matches('[data-testid="receive_message"], [data-testid*="receive_message"], [class*="receive-message"]')
          || root.querySelector('[data-testid="receive_message"], [data-testid*="receive_message"], [class*="receive-message"]')
        ) {
          return 'Assistant';
        }
        return '';
      };

      const messageTextSelectors = [
        '[data-testid="message_text_content"]',
        '[data-testid="message_content"]',
        '[data-testid*="message_text"]',
        '[data-testid*="message_content"]',
        '[class*="message-text"]',
        '[class*="message-content"]',
      ];
      const messageImageSelector = messageTextSelectors.map((s) => s + ' img').join(', ');

      const extractTextChunks = (root) => {
        const chunks = [];
        const seen = new Set();
        for (const selector of messageTextSelectors) {
          const nodes = Array.from(root.querySelectorAll(selector))
            .filter((el) => isVisible(el))
            .map((el) => clean(el.innerText || el.textContent || ''))
            .filter(Boolean);

          for (const nodeText of nodes) {
            if (seen.has(nodeText)) continue;
            seen.add(nodeText);
            chunks.push(nodeText);
          }

          if (chunks.length > 0) break;
        }
        return chunks;
      };

      const extractImageLines = (root) => Array.from(root.querySelectorAll(messageImageSelector))
          .filter((el) => el instanceof HTMLImageElement && isVisible(el))
          .map((el) => {
            const width = el.naturalWidth || el.width || 0;
            const height = el.naturalHeight || el.height || 0;
            if (width > 0 && height > 0 && width <= 48 && height <= 48) return '';
            const url = clean(el.currentSrc || el.src || '');
            return /^https?:\\/\\//i.test(url) ? 'Image: ' + url : '';
          })
          .filter((line, index, items) => Boolean(line) && items.indexOf(line) === index);

      const extractText = (root) => {
        const chunks = extractTextChunks(root);
        const text = chunks.length > 0 ? clean(chunks.join('\\n')) : clean(root.innerText || root.textContent || '');
        const imageLines = extractImageLines(root);
        if (imageLines.length === 0) return text;
        return text ? text + '\\n' + imageLines.join('\\n') : imageLines.join('\\n');
      };

      const messageList = document.querySelector('[data-testid="message-list"]');
      if (!messageList) return [];

      const unionRoots = Array.from(messageList.querySelectorAll('[data-testid="union_message"]'))
        .filter((el) => isVisible(el));
      const blockRoots = Array.from(messageList.querySelectorAll('[data-testid="message-block-container"]'))
        .filter((el) => isVisible(el) && !el.closest('[data-testid="union_message"]'));
      const roots = (unionRoots.length > 0 ? unionRoots : blockRoots)
        .filter((el, index, items) => !items.some((other, otherIndex) => otherIndex !== index && other.contains(el)));

      const turns = roots
        .map((el) => {
          const role = getRole(el);
          const text = extractText(el);
          return { el, role, text };
        })
        .filter((item) => (item.role === 'User' || item.role === 'Assistant') && item.text);

      turns.sort((a, b) => {
        if (a.el === b.el) return 0;
        const pos = a.el.compareDocumentPosition(b.el);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

      const deduped = [];
      const seen = new Set();
      for (const turn of turns) {
        const key = turn.role + '::' + turn.text;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push({ Role: turn.role, Text: turn.text });
      }

      if (deduped.length > 0) return deduped;
      return [];
    })()
  `;
}
function fillComposerScript(text) {
    return `
    ((inputText) => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const candidates = [
        'textarea[data-testid="chat_input_input"]',
        '.chat-input textarea',
        '.chat-input [contenteditable="true"]',
        '.chat-editor textarea',
        '.chat-editor [contenteditable="true"]',
        'textarea[placeholder*="发消息"]',
        'textarea[placeholder*="Message"]',
        '[contenteditable="true"][placeholder*="发消息"]',
        '[contenteditable="true"][placeholder*="Message"]',
        '[contenteditable="true"][aria-label*="发消息"]',
        '[contenteditable="true"][aria-label*="Message"]',
        'textarea',
        '[contenteditable="true"]',
      ];

      let composer = null;
      for (const selector of candidates) {
        const node = Array.from(document.querySelectorAll(selector)).find(isVisible);
        if (node) {
          composer = node;
          break;
        }
      }

      if (!composer) throw new Error('Could not find Doubao input element');

      composer.focus();

      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const proto = composer instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter?.call(composer, inputText);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
        return 'text-input';
      }

      if (composer instanceof HTMLElement) {
        composer.textContent = '';
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('insertText', false, inputText);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
        return 'contenteditable';
      }

      throw new Error('Unsupported Doubao input element');
    })(${JSON.stringify(text)})
  `;
}
function fillAndSubmitComposerScript(text) {
    return `
    ((inputText) => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const candidates = [
        'textarea[data-testid="chat_input_input"]',
        '[data-testid="chat_input"] textarea',
        '.chat-input textarea',
        'textarea[placeholder*="发消息"]',
        'textarea[placeholder*="Message"]',
        'textarea',
      ];

      let composer = null;
      for (const selector of candidates) {
        const node = Array.from(document.querySelectorAll(selector)).find(isVisible);
        if (node) {
          composer = node;
          break;
        }
      }

      if (!(composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement)) {
        throw new Error('Could not find Doubao textarea input element');
      }

      composer.focus();
      const proto = composer instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(composer, inputText);
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));

      const root = document.querySelector('[data-testid="chat_input"], .chat-input') || document.body;
      const buttons = Array.from(root.querySelectorAll('button, [role="button"]')).filter(isVisible);
      const target = buttons[buttons.length - 1];

      if (target) {
        target.click();
        return 'button';
      }

      return 'enter';
    })(${JSON.stringify(text)})
  `;
}
function clickSendButtonScript() {
    return `
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const labels = ['发送', 'Send', '发消息...', 'Message...'];
      const root = document.querySelector('[data-testid="chat_input"], .chat-input') || document;
      const buttons = Array.from(root.querySelectorAll(
        '.chat-input-button button, .chat-input-button [role="button"], .chat-input button, button[type="submit"], [role="button"]'
      ));

      for (const button of buttons) {
        if (!isVisible(button)) continue;
        const disabled = button.getAttribute('disabled') !== null
          || button.getAttribute('aria-disabled') === 'true';
        if (disabled) continue;
        const text = (button.innerText || button.textContent || '').trim();
        const aria = (button.getAttribute('aria-label') || '').trim();
        const title = (button.getAttribute('title') || '').trim();
        const haystacks = [text, aria, title];
        if (haystacks.some((value) => labels.some((label) => value.includes(label)))) {
          button.click();
          return true;
        }
      }

      const styledCandidate = [...buttons].reverse().find((button) => {
        if (!isVisible(button)) return false;
        const disabled = button.getAttribute('disabled') !== null
          || button.getAttribute('aria-disabled') === 'true';
        if (disabled) return false;
        const className = button.className || '';
        return className.includes('bg-dbx-text-highlight')
          || className.includes('bg-dbx-fill-highlight')
          || className.includes('text-dbx-text-static-white-primary');
      });

      if (styledCandidate) {
        styledCandidate.click();
        return true;
      }

      const inputButton = [...buttons].reverse().find((button) => {
        if (!isVisible(button)) return false;
        const disabled = button.getAttribute('disabled') !== null
          || button.getAttribute('aria-disabled') === 'true';
        if (disabled) return false;
        return !!button.closest('.chat-input-button');
      });

      if (inputButton) {
        inputButton.click();
        return true;
      }

      const lastEnabledButton = [...buttons].reverse().find((button) => {
        if (!isVisible(button)) return false;
        return button.getAttribute('disabled') === null
          && button.getAttribute('aria-disabled') !== 'true';
      });

      if (lastEnabledButton) {
        lastEnabledButton.click();
        return true;
      }

      return false;
    })()
  `;
}
function clickNewChatScript() {
    return `
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const labels = ['新对话', 'New Chat', '创建新对话'];
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));

      for (const button of buttons) {
        if (!isVisible(button)) continue;
        const text = (button.innerText || button.textContent || '').trim();
        const aria = (button.getAttribute('aria-label') || '').trim();
        const title = (button.getAttribute('title') || '').trim();
        const haystacks = [text, aria, title];
        if (haystacks.some((value) => labels.some((label) => value.includes(label)))) {
          button.click();
          return text || aria || title || 'new-chat';
        }
      }

      return '';
    })()
  `;
}
function normalizeDoubaoTabs(rawTabs) {
    return rawTabs
        .map((tab, index) => {
        const record = (tab || {});
        return {
            index: typeof record.index === 'number' ? record.index : index,
            url: typeof record.url === 'string' ? record.url : '',
            title: typeof record.title === 'string' ? record.title : '',
            active: record.active === true,
        };
    })
        .filter((tab) => tab.url.includes('doubao.com/chat'));
}
async function selectPreferredDoubaoTab(page) {
    const rawTabs = await page.tabs().catch(() => []);
    if (!Array.isArray(rawTabs) || rawTabs.length === 0)
        return false;
    const tabs = normalizeDoubaoTabs(rawTabs);
    if (tabs.length === 0)
        return false;
    const preferred = [...tabs].sort((left, right) => {
        const score = (tab) => {
            let value = tab.index;
            if (/https:\/\/www\.doubao\.com\/chat\/[A-Za-z0-9_-]+/.test(tab.url))
                value += 1000;
            else if (tab.url.startsWith(DOUBAO_CHAT_URL))
                value += 100;
            if (tab.active)
                value += 25;
            return value;
        };
        return score(right) - score(left);
    })[0];
    if (!preferred)
        return false;
    await page.selectTab(preferred.index);
    await page.wait(0.8);
    return true;
}
export async function ensureDoubaoChatPage(page) {
    let currentUrl = await page.evaluate('window.location.href').catch(() => '');
    if (typeof currentUrl === 'string' && currentUrl.includes('doubao.com/chat')) {
        await page.wait(1);
        return;
    }
    const reusedTab = await selectPreferredDoubaoTab(page);
    if (reusedTab) {
        currentUrl = await page.evaluate('window.location.href').catch(() => '');
        if (typeof currentUrl === 'string' && currentUrl.includes('doubao.com/chat')) {
            await page.wait(1);
            return;
        }
    }
    await page.goto(DOUBAO_CHAT_URL, { waitUntil: 'load', settleMs: 2500 });
    await page.wait(1.5);
}
export async function getDoubaoPageState(page) {
    await ensureDoubaoChatPage(page);
    return await page.evaluate(getStateScript());
}
export async function getDoubaoTurns(page) {
    await ensureDoubaoChatPage(page);
    const turns = await page.evaluate(getTurnsScript());
    if (turns.length > 0)
        return turns;
    const lines = await page.evaluate(getTranscriptLinesScript());
    return lines.map((line) => ({ Role: 'System', Text: line }));
}
export async function getDoubaoVisibleTurns(page) {
    await ensureDoubaoChatPage(page);
    return await page.evaluate(getTurnsScript());
}
export async function getDoubaoTranscriptLines(page) {
    await ensureDoubaoChatPage(page);
    return await page.evaluate(getTranscriptLinesScript());
}
export async function sendDoubaoMessage(page, text) {
    await ensureDoubaoChatPage(page);
    const submittedBy = await page.evaluate(fillAndSubmitComposerScript(text));
    if (submittedBy === 'enter') {
        await page.pressKey('Enter');
    }
    await page.wait(0.8);
    return submittedBy;
}
export async function waitForDoubaoResponse(page, beforeLines, beforeTurns, promptText, timeoutSeconds) {
    const beforeSet = new Set(beforeLines);
    const beforeTurnSet = new Set(beforeTurns
        .filter((turn) => turn.Role === 'Assistant')
        .map((turn) => `${turn.Role}::${turn.Text}`));
    const sanitizeCandidate = (value) => value
        .replace(promptText, '')
        .replace(/内容由豆包 AI 生成/g, '')
        .replace(/在此处拖放文件/g, '')
        .replace(/文件数量：.*$/g, '')
        .replace(/\{"namedChunks".*$/g, '')
        .replace(/window\\._SSR_DATA.*$/g, '')
        .trim();
    const getCandidate = async () => {
        const turns = await getDoubaoVisibleTurns(page);
        const assistantCandidate = [...turns]
            .reverse()
            .find((turn) => turn.Role === 'Assistant' && !beforeTurnSet.has(`${turn.Role}::${turn.Text}`));
        const visibleCandidate = assistantCandidate ? sanitizeCandidate(assistantCandidate.Text) : '';
        if (visibleCandidate)
            return visibleCandidate;
        const lines = await getDoubaoTranscriptLines(page);
        const additions = lines
            .filter((line) => !beforeSet.has(line))
            .map((line) => sanitizeCandidate(line))
            .filter((line) => line && line !== promptText);
        const shortCandidate = additions.find((line) => line.length <= 120);
        return shortCandidate || additions[additions.length - 1] || '';
    };
    const pollIntervalSeconds = 2;
    const maxPolls = Math.max(1, Math.ceil(timeoutSeconds / pollIntervalSeconds));
    let lastCandidate = '';
    let stableCount = 0;
    for (let index = 0; index < maxPolls; index += 1) {
        await page.wait(index === 0 ? 1.5 : pollIntervalSeconds);
        const candidate = await getCandidate();
        if (!candidate)
            continue;
        if (candidate === lastCandidate) {
            stableCount += 1;
        }
        else {
            lastCandidate = candidate;
            stableCount = 1;
        }
        if (stableCount >= 2 || index === maxPolls - 1) {
            return candidate;
        }
    }
    return lastCandidate;
}
function getConversationListScript() {
    return `
    (() => {
      const sidebar = document.querySelector('[data-testid="flow_chat_sidebar"]');
      if (!sidebar) return [];

      const items = Array.from(
        sidebar.querySelectorAll('a[data-testid="chat_list_thread_item"]')
      );

      return items
        .map(a => {
          const href = a.getAttribute('href') || '';
          const match = href.match(/\\/chat\\/(\\d{10,})/);
          if (!match) return null;
          const id = match[1];
          const textContent = (a.textContent || a.innerText || '').trim();
          const title = textContent
            .replace(/\\s+/g, ' ')
            .substring(0, 200);
          return { id, title, href };
        })
        .filter(Boolean);
    })()
  `;
}
export async function getDoubaoConversationList(page) {
    await ensureDoubaoChatPage(page);
    const raw = await page.evaluate(getConversationListScript());
    if (!Array.isArray(raw))
        return [];
    return raw.map((item) => ({
        Id: item.id,
        Title: item.title,
        Url: `${DOUBAO_CHAT_URL}/${item.id}`,
    }));
}
function buildInvalidDoubaoThreadError() {
    return new CliError('INVALID_INPUT', 'Invalid Doubao thread id or URL', 'Pass a numeric conversation ID or a full https://www.doubao.com/chat/<id> URL.');
}
export function parseDoubaoConversationId(input) {
    const raw = typeof input === 'string' ? input.trim() : '';
    if (!raw) {
        throw buildInvalidDoubaoThreadError();
    }
    if (/^\d{10,}$/.test(raw)) {
        return raw;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(raw);
    }
    catch {
        throw buildInvalidDoubaoThreadError();
    }
    const pathname = parsedUrl.pathname.replace(/\/+$/, '');
    const match = pathname.match(/^\/chat\/(\d{10,})$/);
    if (parsedUrl.origin === 'https://www.doubao.com' && match) {
        return match[1];
    }
    throw buildInvalidDoubaoThreadError();
}
function getConversationDetailScript() {
    return `
    (() => {
      const clean = (v) => (v || '').replace(/\\u00a0/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();

      const messageList = document.querySelector('[data-testid="message-list"]');
      if (!messageList) return { messages: [], meeting: null };

      const meetingCard = messageList.querySelector('[data-testid="meeting-minutes-card"]');
      let meeting = null;
      if (meetingCard) {
        const raw = clean(meetingCard.textContent || '');
        const match = raw.match(/^(.+?)(?:会议时间：|\\s*$)(.*)/);
        meeting = {
          title: match ? match[1].trim() : raw,
          time: match && match[2] ? match[2].trim() : '',
        };
      }

      const unions = Array.from(messageList.querySelectorAll('[data-testid="union_message"]'));
      const messages = unions.map(u => {
        const isSend = !!u.querySelector('[data-testid="send_message"]');
        const isReceive = !!u.querySelector('[data-testid="receive_message"]');
        const textEl = u.querySelector('[data-testid="message_text_content"]');
        const text = textEl ? clean(textEl.innerText || textEl.textContent || '') : '';
        return {
          role: isSend ? 'User' : isReceive ? 'Assistant' : 'System',
          text,
          hasMeetingCard: !!u.querySelector('[data-testid="meeting-minutes-card"]'),
        };
      }).filter(m => m.text);

      return { messages, meeting };
    })()
  `;
}
export async function navigateToConversation(page, conversationId) {
    const url = `${DOUBAO_CHAT_URL}/${conversationId}`;
    const currentUrl = await page.evaluate('window.location.href').catch(() => '');
    if (typeof currentUrl === 'string') {
        try {
            const current = new URL(currentUrl);
            if (current.origin === 'https://www.doubao.com' && current.pathname.replace(/\/+$/, '') === `/chat/${conversationId}`) {
                await page.wait(1);
                return;
            }
        }
        catch {
            // Ignore malformed current URLs and fall through to explicit navigation.
        }
    }
    await page.goto(url, { waitUntil: 'load', settleMs: 3000 });
    await page.wait(2);
}
export async function getConversationDetail(page, conversationId) {
    await navigateToConversation(page, conversationId);
    const raw = await page.evaluate(getConversationDetailScript());
    const messages = (raw.messages || []).map((m) => ({
        Role: m.role,
        Text: m.text,
        HasMeetingCard: m.hasMeetingCard,
    }));
    return { messages, meeting: raw.meeting };
}
// ---------------------------------------------------------------------------
// Meeting minutes panel helpers
// ---------------------------------------------------------------------------
function clickMeetingCardScript() {
    return `
    (() => {
      const card = document.querySelector('[data-testid="meeting-minutes-card"]');
      if (!card) return false;
      card.click();
      return true;
    })()
  `;
}
function readMeetingSummaryScript() {
    return `
    (() => {
      const panel = document.querySelector('[data-testid="canvas_panel_container"]');
      if (!panel) return { error: 'no panel' };

      const summary = panel.querySelector('[data-testid="meeting-summary-todos"]');
      const summaryText = summary
        ? (summary.innerText || summary.textContent || '').trim()
        : '';

      return { summary: summaryText };
    })()
  `;
}
function clickTextNotesTabScript() {
    return `
    (() => {
      const panel = document.querySelector('[data-testid="canvas_panel_container"]');
      if (!panel) return false;
      const tabs = panel.querySelectorAll('[role="tab"], .semi-tabs-tab');
      for (const tab of tabs) {
        if ((tab.textContent || '').trim().includes('文字')) {
          tab.click();
          return true;
        }
      }
      return false;
    })()
  `;
}
function readTextNotesScript() {
    return `
    (() => {
      const panel = document.querySelector('[data-testid="canvas_panel_container"]');
      if (!panel) return '';
      const textNotes = panel.querySelector('[data-testid="meeting-text-notes"]');
      if (!textNotes) return '';
      return (textNotes.innerText || textNotes.textContent || '').trim();
    })()
  `;
}
function normalizeTranscriptLines(text) {
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
}
function containsLineSequence(haystack, needle) {
    if (needle.length === 0)
        return true;
    if (needle.length > haystack.length)
        return false;
    for (let start = 0; start <= haystack.length - needle.length; start += 1) {
        let matched = true;
        for (let offset = 0; offset < needle.length; offset += 1) {
            if (haystack[start + offset] !== needle[offset]) {
                matched = false;
                break;
            }
        }
        if (matched)
            return true;
    }
    return false;
}
export function mergeTranscriptSnapshots(existing, incoming) {
    const currentLines = normalizeTranscriptLines(existing);
    const nextLines = normalizeTranscriptLines(incoming);
    if (nextLines.length === 0)
        return currentLines.join('\n');
    if (currentLines.length === 0)
        return nextLines.join('\n');
    if (containsLineSequence(currentLines, nextLines))
        return currentLines.join('\n');
    const maxOverlap = Math.min(currentLines.length, nextLines.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        let matched = true;
        for (let index = 0; index < overlap; index += 1) {
            if (currentLines[currentLines.length - overlap + index] !== nextLines[index]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            return [...currentLines, ...nextLines.slice(overlap)].join('\n');
        }
    }
    return [...currentLines, ...nextLines].join('\n');
}
function clickChapterTabScript() {
    return `
    (() => {
      const panel = document.querySelector('[data-testid="canvas_panel_container"]');
      if (!panel) return false;
      const tabs = panel.querySelectorAll('[role="tab"], .semi-tabs-tab');
      for (const tab of tabs) {
        if ((tab.textContent || '').trim().includes('章节')) {
          tab.click();
          return true;
        }
      }
      return false;
    })()
  `;
}
function readChapterScript() {
    return `
    (() => {
      const panel = document.querySelector('[data-testid="canvas_panel_container"]');
      if (!panel) return '';
      const chapter = panel.querySelector('[data-testid="meeting-ai-chapter"]');
      if (!chapter) return '';
      return (chapter.innerText || chapter.textContent || '').trim();
    })()
  `;
}
function triggerTranscriptDownloadScript() {
    return `
    (() => {
      const panel = document.querySelector('[data-testid="canvas_panel_container"]');
      if (!panel) return { error: 'no panel' };

      const downloadIcon = panel.querySelector('[class*="DownloadMeetingAudio"] span[role="img"]');
      if (!downloadIcon) return { error: 'no download icon' };

      downloadIcon.click();
      return { clicked: 'icon' };
    })()
  `;
}
function clickTranscriptDownloadBtnScript() {
    return `
    (() => {
      const btn = document.querySelector('[data-testid="minutes-download-text-btn"]');
      if (!btn) return { error: 'no download text btn' };
      btn.click();
      return { clicked: 'transcript' };
    })()
  `;
}
export async function openMeetingPanel(page, conversationId) {
    await navigateToConversation(page, conversationId);
    const clicked = await page.evaluate(clickMeetingCardScript());
    if (!clicked)
        return false;
    await page.wait(2);
    return true;
}
export async function getMeetingSummary(page) {
    const result = await page.evaluate(readMeetingSummaryScript());
    return result.summary || '';
}
export async function getMeetingChapters(page) {
    await page.evaluate(clickChapterTabScript());
    await page.wait(1.5);
    return await page.evaluate(readChapterScript());
}
function scrollTextNotesPanelScript() {
    return `
    (() => {
      const panel = document.querySelector('[data-testid="canvas_panel_container"]');
      if (!panel) return 0;
      const textNotes = panel.querySelector('[data-testid="meeting-text-notes"]');
      if (!textNotes) return 0;

      const scrollable = textNotes.closest('[class*="overflow"]')
        || textNotes.parentElement
        || textNotes;
      const maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
      if (maxScroll > 0) {
        scrollable.scrollTop = scrollable.scrollHeight;
      }
      return maxScroll;
    })()
  `;
}
export async function getMeetingTranscript(page) {
    await page.evaluate(clickTextNotesTabScript());
    await page.wait(2);
    let merged = '';
    let stableRounds = 0;
    for (let i = 0; i < 10; i++) {
        await page.evaluate(scrollTextNotesPanelScript());
        await page.wait(1);
        const snapshot = await page.evaluate(readTextNotesScript());
        const nextMerged = mergeTranscriptSnapshots(merged, snapshot);
        if (nextMerged === merged && snapshot.length > 0) {
            stableRounds += 1;
            if (stableRounds >= 2)
                break;
        }
        else {
            stableRounds = 0;
            merged = nextMerged;
        }
    }
    return merged;
}
export async function triggerTranscriptDownload(page) {
    const iconResult = await page.evaluate(triggerTranscriptDownloadScript());
    if (iconResult.error)
        return false;
    await page.wait(1);
    const btnResult = await page.evaluate(clickTranscriptDownloadBtnScript());
    return !btnResult.error;
}
export async function startNewDoubaoChat(page) {
    await ensureDoubaoChatPage(page);
    const clickedLabel = await page.evaluate(clickNewChatScript());
    if (clickedLabel) {
        await page.wait(1.5);
        return clickedLabel;
    }
    await page.goto(DOUBAO_NEW_CHAT_URL, { waitUntil: 'load', settleMs: 2000 });
    await page.wait(1.5);
    return 'navigate';
}
