import { CDPBridge } from '../../browser/index.js';
import { CliError } from '../../errors.js';
import { browserSession } from '../../runtime.js';
import type { IPage } from '../../types.js';
import type { ChatGPTSurface } from './surface.js';
import { chatGPTCDPHint } from './surface.js';

type RawChatGPTTurn = {
  role?: string | null;
  text?: string | null;
};

type ChatGPTCDPProbe = {
  title: string;
  url: string;
  readyState: string;
  likelyChatGPT: boolean;
  turnCount: number;
  composerFound: boolean;
  composerTag: string;
  composerEmpty: boolean;
  draftLength: number;
  sendButtonEnabled: boolean;
  busy: boolean;
};

export type ChatGPTTurn = {
  Role: string;
  Text: string;
};

const CHATGPT_UI_CHROME = new Set([
  'Copy',
  'Edit',
  'Share',
  'Retry',
  'Regenerate',
  'Read aloud',
  'Good response',
  'Bad response',
  'More',
  'You said:',
  'ChatGPT said:',
  '你说：',
  'ChatGPT 说：',
  'Sources',
  '来源',
]);

export function formatChatGPTStatusRow(
  probe: ChatGPTCDPProbe,
  surface: ChatGPTSurface,
): Record<string, string | number> {
  return {
    Status: probe.likelyChatGPT ? 'Connected' : 'Connected (target unverified)',
    Surface: surface,
    Url: probe.url,
    Title: probe.title,
    Turns: probe.turnCount,
    Composer: !probe.composerFound
      ? 'Missing'
      : probe.composerEmpty
        ? 'Ready'
        : `Draft (${probe.draftLength} chars)`,
    Busy: probe.busy ? 'Yes' : 'No',
  };
}

export function formatChatGPTSendResultRow(opts: {
  surface: ChatGPTSurface;
  submitMethod?: string;
  injectedText: string;
}): Record<string, string> {
  return {
    Status: 'Success',
    Surface: opts.surface,
    Submit: opts.submitMethod || '',
    InjectedText: opts.injectedText,
  };
}

export function normalizeChatGPTText(text: string | null | undefined): string {
  const cleaned = String(text ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r/g, '')
    .trim();

  if (!cleaned) return '';

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return cleaned;

  const filtered = lines.filter((line) => !CHATGPT_UI_CHROME.has(line));
  return filtered.join('\n').trim();
}

export function normalizeChatGPTTurns(rawTurns: RawChatGPTTurn[]): ChatGPTTurn[] {
  const normalized: ChatGPTTurn[] = [];

  for (const raw of rawTurns) {
    const text = normalizeChatGPTText(raw?.text);
    if (!text) continue;

    const role = normalizeChatGPTRole(raw?.role);
    const nextTurn = { Role: role, Text: text };
    const prevTurn = normalized[normalized.length - 1];

    if (prevTurn && prevTurn.Role === nextTurn.Role && prevTurn.Text === nextTurn.Text) {
      continue;
    }

    normalized.push(nextTurn);
  }

  return normalized;
}

export async function probeChatGPTCDP(surface: ChatGPTSurface): Promise<Record<string, string | number>> {
  return withChatGPTCDP(surface, 'status', async (page) => {
    return formatChatGPTStatusRow(await probeChatGPTPage(page), surface);
  });
}

export async function readChatGPTCDP(surface: ChatGPTSurface): Promise<ChatGPTTurn[]> {
  return withChatGPTCDP(surface, 'read', async (page) => {
    const rawTurns = await page.evaluate(readScript()) as RawChatGPTTurn[];
    const turns = normalizeChatGPTTurns(Array.isArray(rawTurns) ? rawTurns : []);

    if (turns.length > 0) {
      return [turns[turns.length - 1]!];
    }

    const probe = await probeChatGPTPage(page);
    const detail = probe.likelyChatGPT
      ? 'No visible chat messages were found in the current ChatGPT window.'
      : 'Connected CDP target does not look like ChatGPT. Try setting OPENCLI_CDP_TARGET=chatgpt.';

    return [{ Role: 'System', Text: detail }];
  });
}

export async function sendChatGPTCDP(
  text: string,
  surface: ChatGPTSurface,
): Promise<Array<Record<string, string>>> {
  return withChatGPTCDP(surface, 'send', async (page) => {
    const probe = await probeChatGPTPage(page);

    if (!probe.likelyChatGPT) {
      throw new CliError(
        'COMMAND_EXEC',
        'Connected CDP target does not look like ChatGPT.',
        `${chatGPTCDPHint(surface)} If multiple inspectable targets exist, set OPENCLI_CDP_TARGET=chatgpt.`,
      );
    }

    if (probe.busy) {
      throw new CliError(
        'COMMAND_EXEC',
        'ChatGPT is currently busy or still generating a response.',
        'Wait for the current response to finish (or stop it in the UI) before using the experimental CDP send path again.',
      );
    }

    await page.evaluate(injectScript(text));
    await page.wait(0.25);

    let submitMethod = await page.evaluate(submitScript()) as string | null;
    if (!submitMethod) {
      await page.pressKey('Enter');
      submitMethod = 'keyboard-enter';
    }

    await page.wait(0.5);

    return [
      formatChatGPTSendResultRow({
        surface,
        submitMethod,
        injectedText: text,
      }),
    ];
  });
}

async function withChatGPTCDP<T>(
  surface: ChatGPTSurface,
  commandName: string,
  fn: (page: IPage) => Promise<T>,
): Promise<T> {
  const endpoint = process.env.OPENCLI_CDP_ENDPOINT;
  if (!endpoint) {
    throw new CliError(
      'CONFIG',
      `OPENCLI_CDP_ENDPOINT is required for ChatGPT ${commandName} on the ${surface} surface.`,
      chatGPTCDPHint(surface),
    );
  }

  try {
    return await browserSession(CDPBridge as any, fn, { workspace: 'site:chatgpt' });
  } catch (err: any) {
    if (err instanceof CliError) throw err;

    const message = String(err?.message ?? err ?? 'Unknown error');
    const looksLikeConnectFailure = /ECONNREFUSED|fetch failed|Failed to fetch CDP targets|No inspectable targets found|CDP connect timeout/i.test(message);

    if (looksLikeConnectFailure) {
      throw new CliError(
        'BROWSER_CONNECT',
        `Could not attach to the ChatGPT CDP endpoint at ${endpoint}.`,
        chatGPTCDPHint(surface),
      );
    }

    const looksLikeSelectorFailure = /composer|ChatGPT|target/i.test(message);
    throw new CliError(
      looksLikeSelectorFailure ? 'COMMAND_EXEC' : 'BROWSER_CONNECT',
      `ChatGPT ${commandName} failed on the ${surface} surface: ${message}`,
      chatGPTCDPHint(surface),
    );
  }
}

async function probeChatGPTPage(page: IPage): Promise<ChatGPTCDPProbe> {
  const probe = await page.evaluate(statusScript()) as ChatGPTCDPProbe;
  if (!probe || typeof probe !== 'object') {
    throw new CliError('COMMAND_EXEC', 'ChatGPT CDP probe returned an invalid page state.');
  }
  return probe;
}

function normalizeChatGPTRole(role: string | null | undefined): string {
  const value = String(role ?? '').trim().toLowerCase();
  if (value === 'user' || value === 'human') return 'User';
  if (value === 'assistant' || value === 'ai') return 'Assistant';
  if (value === 'system') return 'System';
  return 'Message';
}

function domHelpersScript(): string {
  return `
    const normalizeText = (value) => String(value ?? '')
      .replace(/[\\u200B-\\u200D\\uFEFF]/g, '')
      .replace(/\\r/g, '')
      .trim();

    const elementText = (el) => {
      if (!el) return '';
      const value = typeof el.value === 'string' ? el.value : '';
      const innerText = typeof el.innerText === 'string' ? el.innerText : '';
      const textContent = typeof el.textContent === 'string' ? el.textContent : '';
      return normalizeText(value || innerText || textContent);
    };

    const isVisible = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const scoreComposer = (el) => {
      if (!isVisible(el)) return Number.NEGATIVE_INFINITY;
      let score = 0;
      const dataTestId = (el.getAttribute('data-testid') || '').toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();

      if (el.id === 'prompt-textarea') score += 400;
      if (dataTestId.includes('composer')) score += 240;
      if (dataTestId.includes('prompt')) score += 180;
      if (dataTestId.includes('message')) score += 80;
      if (el.tagName === 'TEXTAREA') score += 140;
      if (el.getAttribute('contenteditable') === 'true') score += 120;
      if (ariaLabel.includes('message')) score += 120;
      if (placeholder.includes('message')) score += 120;
      if (el.closest('form')) score += 80;
      if (el.closest('footer')) score += 40;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') score -= 500;

      return score;
    };

    const selectComposer = () => {
      const selector = [
        '#prompt-textarea',
        '[data-testid="composer-text-input"]',
        '[data-testid*="composer"]',
        'form textarea',
        'form [contenteditable="true"]',
        'textarea',
        '[contenteditable="true"][data-lexical-editor="true"]',
        '[contenteditable="true"]',
      ].join(',');

      let best = null;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (const el of Array.from(document.querySelectorAll(selector))) {
        const score = scoreComposer(el);
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }

      return best;
    };

    const selectSendButton = () => {
      const selector = [
        'button[data-testid="send-button"]',
        'button[data-testid*="send"]',
        'button[aria-label*="Send"]',
        'form button[type="submit"]',
        'form button',
      ].join(',');

      let best = null;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (!isVisible(el)) continue;
        let score = 0;
        const dataTestId = (el.getAttribute('data-testid') || '').toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();

        if (dataTestId.includes('send')) score += 300;
        if (ariaLabel.includes('send')) score += 240;
        if (el.getAttribute('type') === 'submit') score += 100;
        if (el.closest('form')) score += 60;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') score -= 100;

        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }

      return best;
    };
  `;
}

function statusScript(): string {
  return `
    (() => {
      ${domHelpersScript()}

      const composer = selectComposer();
      const sendButton = selectSendButton();
      const stopButton = document.querySelector(
        'button[aria-label*="Stop"], button[data-testid*="stop"], button[aria-label*="stop"]'
      );
      const turnNodes = Array.from(document.querySelectorAll([
        '[data-message-author-role]',
        'article[data-testid^="conversation-turn-"]',
        '[data-testid^="conversation-turn-"]',
        '[role="log"] > *',
      ].join(','))).filter(isVisible);

      const url = window.location.href || '';
      const title = document.title || '';
      const haystack = (title + ' ' + url).toLowerCase();
      const draft = elementText(composer);

      return {
        title,
        url,
        readyState: document.readyState,
        likelyChatGPT: /chatgpt|chat\\.openai|openai/.test(haystack),
        turnCount: turnNodes.length,
        composerFound: !!composer,
        composerTag: composer ? composer.tagName : '',
        composerEmpty: draft.length === 0,
        draftLength: draft.length,
        sendButtonEnabled: !!sendButton && !(sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true'),
        busy: !!stopButton,
      };
    })()
  `;
}

function readScript(): string {
  return `
    (() => {
      ${domHelpersScript()}

      const seen = new Set();
      const turns = [];
      const selector = [
        'article[data-testid^="conversation-turn-"]',
        '[data-testid^="conversation-turn-"]',
        '[data-message-author-role]',
        '[role="log"] > *',
      ].join(',');

      for (const node of Array.from(document.querySelectorAll(selector))) {
        const container =
          node.closest('article[data-testid^="conversation-turn-"]') ||
          node.closest('[data-testid^="conversation-turn-"]') ||
          node.closest('[data-message-author-role]') ||
          node;

        if (!container || seen.has(container) || !isVisible(container)) continue;
        seen.add(container);

        const roleNode =
          container.matches('[data-message-author-role]')
            ? container
            : container.querySelector('[data-message-author-role]');
        const role =
          container.getAttribute('data-turn') ||
          (roleNode ? roleNode.getAttribute('data-message-author-role') : '') ||
          '';

        const contentNode =
          container.querySelector('.markdown, .prose, [data-testid*="message-content"], [data-testid*="conversation-turn-content"], .whitespace-pre-wrap, p, li, pre, code') ||
          container;
        const text = elementText(contentNode || container);

        if (!text) continue;
        turns.push({ role, text });
      }

      if (turns.length > 0) return turns;

      const fallback = elementText(document.querySelector('main, [role="main"], [role="log"]') || document.body);
      if (!fallback) return [];

      return [{ role: 'message', text: fallback }];
    })()
  `;
}

function injectScript(text: string): string {
  return `
    (() => {
      ${domHelpersScript()}

      const text = ${JSON.stringify(text)};
      const composer = selectComposer();
      if (!composer) {
        throw new Error('Could not find the ChatGPT composer in the current CDP target.');
      }

      const existing = elementText(composer);
      if (existing.length > 0) {
        throw new Error('The ChatGPT composer already contains draft text. Refusing to overwrite it in experimental CDP mode.');
      }

      composer.focus();

      if (composer.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) throw new Error('Could not access the textarea setter for the ChatGPT composer.');
        setter.call(composer, text);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('insertText', false, text);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
      }

      return 'injected';
    })()
  `;
}

function submitScript(): string {
  return `
    (() => {
      ${domHelpersScript()}

      const sendButton = selectSendButton();
      if (sendButton && !(sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true')) {
        sendButton.click();
        return 'button';
      }

      const composer = selectComposer();
      const form = composer ? composer.closest('form') : null;
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        return 'form-requestSubmit';
      }

      return '';
    })()
  `;
}

export const __test__ = {
  formatChatGPTSendResultRow,
  formatChatGPTStatusRow,
  normalizeChatGPTText,
  normalizeChatGPTTurns,
};
