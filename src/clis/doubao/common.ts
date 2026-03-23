import type { IPage } from '../../types.js';

export const DOUBAO_DOMAIN = 'www.doubao.com';
export const DOUBAO_CHAT_URL = 'https://www.doubao.com/chat';
export const DOUBAO_NEW_CHAT_URL = 'https://www.doubao.com/chat/new-thread/create-by-msg';

export interface DoubaoTurn {
  Role: 'User' | 'Assistant' | 'System';
  Text: string;
}

export interface DoubaoPageState {
  url: string;
  title: string;
  isLogin: boolean | null;
  accountDescription: string;
  placeholder: string;
}

interface DoubaoTabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

function getTranscriptLinesScript(): string {
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

function getStateScript(): string {
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

      const extractText = (root) => {
        const selectors = [
          '[data-testid="message_text_content"]',
          '[data-testid="message_content"]',
          '[data-testid*="message_text"]',
          '[data-testid*="message_content"]',
          '[class*="message-text"]',
          '[class*="message-content"]',
        ];

        const chunks = [];
        const seen = new Set();
        for (const selector of selectors) {
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

        if (chunks.length > 0) return clean(chunks.join('\\n'));
        return clean(root.innerText || root.textContent || '');
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

function fillComposerScript(text: string): string {
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

function fillAndSubmitComposerScript(text: string): string {
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

function clickSendButtonScript(): string {
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

function normalizeDoubaoTabs(rawTabs: unknown[]): DoubaoTabInfo[] {
  return rawTabs
    .map((tab, index) => {
      const record = (tab || {}) as Record<string, unknown>;
      return {
        index: typeof record.index === 'number' ? record.index : index,
        url: typeof record.url === 'string' ? record.url : '',
        title: typeof record.title === 'string' ? record.title : '',
        active: record.active === true,
      };
    })
    .filter((tab) => tab.url.includes('doubao.com/chat'));
}

async function selectPreferredDoubaoTab(page: IPage): Promise<boolean> {
  const rawTabs = await page.tabs().catch(() => []);
  if (!Array.isArray(rawTabs) || rawTabs.length === 0) return false;

  const tabs = normalizeDoubaoTabs(rawTabs);
  if (tabs.length === 0) return false;

  const preferred = [...tabs].sort((left, right) => {
    const score = (tab: DoubaoTabInfo): number => {
      let value = tab.index;
      if (/https:\/\/www\.doubao\.com\/chat\/[A-Za-z0-9_-]+/.test(tab.url)) value += 1000;
      else if (tab.url.startsWith(DOUBAO_CHAT_URL)) value += 100;
      if (tab.active) value += 25;
      return value;
    };

    return score(right) - score(left);
  })[0];

  if (!preferred) return false;

  await page.selectTab(preferred.index);
  await page.wait(0.8);
  return true;
}

export async function ensureDoubaoChatPage(page: IPage): Promise<void> {
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

export async function getDoubaoPageState(page: IPage): Promise<DoubaoPageState> {
  await ensureDoubaoChatPage(page);
  return await page.evaluate(getStateScript()) as DoubaoPageState;
}

export async function getDoubaoTurns(page: IPage): Promise<DoubaoTurn[]> {
  await ensureDoubaoChatPage(page);
  const turns = await page.evaluate(getTurnsScript()) as DoubaoTurn[];
  if (turns.length > 0) return turns;

  const lines = await page.evaluate(getTranscriptLinesScript()) as string[];
  return lines.map((line) => ({ Role: 'System', Text: line }));
}

export async function getDoubaoVisibleTurns(page: IPage): Promise<DoubaoTurn[]> {
  await ensureDoubaoChatPage(page);
  return await page.evaluate(getTurnsScript()) as DoubaoTurn[];
}

export async function getDoubaoTranscriptLines(page: IPage): Promise<string[]> {
  await ensureDoubaoChatPage(page);
  return await page.evaluate(getTranscriptLinesScript()) as string[];
}

export async function sendDoubaoMessage(page: IPage, text: string): Promise<'button' | 'enter'> {
  await ensureDoubaoChatPage(page);
  const submittedBy = await page.evaluate(fillAndSubmitComposerScript(text)) as 'button' | 'enter';
  if (submittedBy === 'enter') {
    await page.pressKey('Enter');
  }
  await page.wait(0.8);
  return submittedBy;
}

export async function waitForDoubaoResponse(
  page: IPage,
  beforeLines: string[],
  beforeTurns: DoubaoTurn[],
  promptText: string,
  timeoutSeconds: number,
): Promise<string> {
  const beforeSet = new Set(beforeLines);
  const beforeTurnSet = new Set(
    beforeTurns
      .filter((turn) => turn.Role === 'Assistant')
      .map((turn) => `${turn.Role}::${turn.Text}`),
  );

  const sanitizeCandidate = (value: string): string => value
    .replace(promptText, '')
    .replace(/内容由豆包 AI 生成/g, '')
    .replace(/在此处拖放文件/g, '')
    .replace(/文件数量：.*$/g, '')
    .replace(/\{"namedChunks".*$/g, '')
    .replace(/window\\._SSR_DATA.*$/g, '')
    .trim();

  const getCandidate = async (): Promise<string> => {
    const turns = await getDoubaoVisibleTurns(page);
    const assistantCandidate = [...turns]
      .reverse()
      .find((turn) => turn.Role === 'Assistant' && !beforeTurnSet.has(`${turn.Role}::${turn.Text}`));
    const visibleCandidate = assistantCandidate ? sanitizeCandidate(assistantCandidate.Text) : '';

    if (visibleCandidate) return visibleCandidate;

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

    if (!candidate) continue;
    if (candidate === lastCandidate) {
      stableCount += 1;
    } else {
      lastCandidate = candidate;
      stableCount = 1;
    }

    if (stableCount >= 2 || index === maxPolls - 1) {
      return candidate;
    }
  }

  return lastCandidate;
}

export async function startNewDoubaoChat(page: IPage): Promise<string> {
  await ensureDoubaoChatPage(page);
  const clickedLabel = await page.evaluate(clickNewChatScript()) as string;
  if (clickedLabel) {
    await page.wait(1.5);
    return clickedLabel;
  }

  await page.goto(DOUBAO_NEW_CHAT_URL, { waitUntil: 'load', settleMs: 2000 });
  await page.wait(1.5);
  return 'navigate';
}
