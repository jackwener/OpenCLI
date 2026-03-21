import { CDPBridge } from '../../browser/index.js';
import { CliError } from '../../errors.js';
import { browserSession } from '../../runtime.js';
import type { IPage } from '../../types.js';

export type ChatGPTReasoningMode = 'instant' | 'thinking' | 'pro';

export type ChatGPTReasoningState = {
  mode: ChatGPTReasoningMode | '';
  label: string;
  triggerFound: boolean;
  triggerLabel: string;
};

export type ChatGPTReasoningChange = {
  status: 'Switched' | 'Already active';
  requested: ChatGPTReasoningMode;
  requestedLabel: string;
  reasoning: ChatGPTReasoningMode | '';
  reasoningLabel: string;
};

export type ChatGPTCDPProbe = {
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
  reasoningMode: ChatGPTReasoningMode | '';
  reasoningLabel: string;
  reasoningTriggerFound: boolean;
};

type RawChatGPTTurn = {
  role?: string | null;
  text?: string | null;
};

type ChatGPTReasoningOption = {
  mode: ChatGPTReasoningMode;
  label: string;
  aliases: string[];
};

type RawChatGPTReasoningState = {
  mode?: string | null;
  label?: string | null;
  triggerFound?: boolean | null;
  triggerLabel?: string | null;
};

type RawChatGPTReasoningSelection = {
  opened?: boolean | null;
  ok?: boolean | null;
  label?: string | null;
  triggerLabel?: string | null;
  visibleLabels?: string[] | null;
};

export type ChatGPTTurn = {
  Role: string;
  Text: string;
};

const CHATGPT_CDP_HINT =
  'Experimental ChatGPT desktop CDP mode: fully quit ChatGPT first if needed, launch it with ' +
  '--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1, then export ' +
  'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9224. If multiple inspectable targets exist, set OPENCLI_CDP_TARGET=chatgpt.';

const CHATGPT_REASONING_HINT =
  'This experimental helper only targets the top-level ChatGPT picker for Instant / Thinking / Pro. ' +
  'It does not yet control Light / Standard / Extended / Heavy thinking-time options.';

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
  'Finished thinking',
  'Answer immediately',
  '已完成推理',
  '立即回答',
]);

const CHATGPT_REASONING_OPTIONS: ChatGPTReasoningOption[] = [
  {
    mode: 'instant',
    label: 'Instant',
    aliases: ['instant', 'auto', 'gpt-5.3 instant', 'gpt53 instant', 'gpt 5.3 instant'],
  },
  {
    mode: 'thinking',
    label: 'Thinking',
    aliases: ['thinking', 'gpt-5.4 thinking', 'gpt54 thinking', 'gpt 5.4 thinking'],
  },
  {
    mode: 'pro',
    label: 'Pro',
    aliases: ['pro', 'gpt-5.4 pro', 'gpt54 pro', 'gpt 5.4 pro'],
  },
];

export function hasChatGPTCDPConfigured(): boolean {
  return !!process.env.OPENCLI_CDP_ENDPOINT;
}

export function chatGPTCDPHint(): string {
  return CHATGPT_CDP_HINT;
}

export function chatGPTReasoningHint(): string {
  return CHATGPT_REASONING_HINT;
}

export function chatGPTAsyncSendHint(): string {
  return 'Async by default: `opencli chatgpt send` only submits the prompt and returns immediately. Use `opencli chatgpt read` later to fetch the output.';
}

export function formatChatGPTSendResultRow(opts: {
  mode: 'CDP' | 'AppleScript';
  reasoningLabel?: string;
  submitMethod?: string;
  injectedText: string;
}): Record<string, string> {
  return {
    Status: 'Submitted',
    Mode: opts.mode,
    Reasoning: opts.reasoningLabel || '',
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

export function detectChatGPTReasoningMode(text: string | null | undefined): ChatGPTReasoningMode | '' {
  return findChatGPTReasoningOption(text)?.mode ?? '';
}

export function normalizeChatGPTReasoningInput(text: string | null | undefined): ChatGPTReasoningMode | '' {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!normalized) return '';
  return CHATGPT_REASONING_OPTIONS.find((option) => option.aliases.includes(normalized) || option.mode === normalized)?.mode ?? '';
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

export function formatChatGPTStatusRow(probe: ChatGPTCDPProbe): Record<string, string | number> {
  return {
    Status: probe.likelyChatGPT ? 'Connected' : 'Connected (target unverified)',
    Mode: 'CDP',
    Url: probe.url,
    Title: probe.title,
    Turns: probe.turnCount,
    Composer: !probe.composerFound
      ? 'Missing'
      : probe.composerEmpty
        ? 'Ready'
        : `Draft (${probe.draftLength} chars)`,
    Reasoning: probe.reasoningLabel || 'Unknown',
    Busy: probe.busy ? 'Yes' : 'No',
  };
}

export async function probeChatGPTCDP(): Promise<ChatGPTCDPProbe> {
  return withChatGPTCDP('status', async (page) => {
    return await probeChatGPTPage(page);
  });
}

export async function probeChatGPTReasoningCDP(): Promise<ChatGPTReasoningState> {
  return withChatGPTCDP('reasoning', async (page) => {
    return await readChatGPTReasoningState(page);
  });
}

export async function switchChatGPTReasoningCDP(mode: string): Promise<ChatGPTReasoningChange> {
  const requested = requireChatGPTReasoningMode(mode);
  return withChatGPTCDP('reasoning', async (page) => {
    return await setChatGPTReasoningMode(page, requested);
  });
}

export async function readChatGPTCDP(): Promise<ChatGPTTurn[]> {
  return withChatGPTCDP('read', async (page) => {
    const rawTurns = await page.evaluate(readScript()) as RawChatGPTTurn[];
    const turns = normalizeChatGPTTurns(Array.isArray(rawTurns) ? rawTurns : []);

    if (turns.length > 0) return turns;

    const probe = await probeChatGPTPage(page);
    const detail = probe.likelyChatGPT
      ? 'No visible conversation turns were found in the current ChatGPT window.'
      : 'Connected CDP target does not look like ChatGPT. Try setting OPENCLI_CDP_TARGET=chatgpt.';

    return [{ Role: 'System', Text: detail }];
  });
}

export async function sendChatGPTCDP(
  text: string,
  opts: { reasoning?: string } = {},
): Promise<Array<Record<string, string>>> {
  const requestedReasoning = opts.reasoning ? requireChatGPTReasoningMode(opts.reasoning) : null;

  return withChatGPTCDP('send', async (page) => {
    const probe = await probeChatGPTPage(page);
    if (probe.busy) {
      throw new CliError(
        'COMMAND_EXEC',
        'ChatGPT is currently busy or still generating a response.',
        'Wait for the current response to finish (or stop it in the UI) before using the experimental send path again.'
      );
    }

    let reasoningLabel = probe.reasoningLabel || '';
    if (requestedReasoning) {
      const change = await setChatGPTReasoningMode(page, requestedReasoning);
      reasoningLabel = change.reasoningLabel || change.requestedLabel;
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
        mode: 'CDP',
        reasoningLabel: reasoningLabel || 'Unknown',
        submitMethod,
        injectedText: text,
      }),
    ];
  });
}

async function withChatGPTCDP<T>(commandName: string, fn: (page: IPage) => Promise<T>): Promise<T> {
  const endpoint = process.env.OPENCLI_CDP_ENDPOINT;
  if (!endpoint) {
    throw new CliError('CONFIG', `OPENCLI_CDP_ENDPOINT is required for ChatGPT ${commandName} in experimental CDP mode.`, CHATGPT_CDP_HINT);
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
        CHATGPT_CDP_HINT,
      );
    }

    const looksLikeSelectorFailure = /composer|ChatGPT|target|reasoning|picker/i.test(message);
    throw new CliError(
      looksLikeSelectorFailure ? 'COMMAND_EXEC' : 'BROWSER_CONNECT',
      `ChatGPT ${commandName} failed in experimental CDP mode: ${message}`,
      CHATGPT_CDP_HINT,
    );
  }
}

async function probeChatGPTPage(page: IPage): Promise<ChatGPTCDPProbe> {
  const probe = await page.evaluate(statusScript()) as ChatGPTCDPProbe;
  if (!probe || typeof probe !== 'object') {
    throw new CliError('COMMAND_EXEC', 'ChatGPT CDP probe returned an invalid page state.', CHATGPT_CDP_HINT);
  }

  if (!probe.reasoningMode && probe.reasoningTriggerFound) {
    const refined = await readChatGPTReasoningState(page);
    if (refined.mode || refined.label) {
      return {
        ...probe,
        reasoningMode: refined.mode || probe.reasoningMode,
        reasoningLabel: refined.label || probe.reasoningLabel,
        reasoningTriggerFound: refined.triggerFound || probe.reasoningTriggerFound,
      };
    }
  }

  return probe;
}

async function readChatGPTReasoningState(page: IPage): Promise<ChatGPTReasoningState> {
  const initial = await page.evaluate(readReasoningStateScript()) as RawChatGPTReasoningState;
  let triggerLabel = normalizeChatGPTText(initial?.triggerLabel);
  let option = findChatGPTReasoningOption(initial?.label) ?? findChatGPTReasoningOption(triggerLabel);

  if (!option && initial?.triggerFound) {
    const opened = await page.evaluate(openReasoningPickerScript()) as RawChatGPTReasoningSelection;
    if (opened?.opened) {
      for (const delaySeconds of [0.75, 0.5]) {
        await page.wait(delaySeconds);
        const expanded = await page.evaluate(readReasoningStateScript()) as RawChatGPTReasoningState;
        triggerLabel = normalizeChatGPTText(expanded?.triggerLabel || triggerLabel);
        option = findChatGPTReasoningOption(expanded?.label) ?? findChatGPTReasoningOption(triggerLabel);
        if (option) break;
      }

      try {
        await page.pressKey('Escape');
        await page.wait(0.1);
      } catch {
        // best-effort close only
      }
    }
  }

  return {
    mode: option?.mode ?? '',
    label: option?.label ?? '',
    triggerFound: !!initial?.triggerFound,
    triggerLabel,
  };
}

async function setChatGPTReasoningMode(page: IPage, requested: ChatGPTReasoningOption): Promise<ChatGPTReasoningChange> {
  const current = await readChatGPTReasoningState(page);
  if (current.mode === requested.mode) {
    return {
      status: 'Already active',
      requested: requested.mode,
      requestedLabel: requested.label,
      reasoning: current.mode,
      reasoningLabel: current.label || requested.label,
    };
  }

  const opened = await page.evaluate(openReasoningPickerScript()) as RawChatGPTReasoningSelection;
  if (!opened?.opened) {
    throw new CliError(
      'COMMAND_EXEC',
      'Could not find the ChatGPT reasoning/model picker in the current CDP target.',
      `${CHATGPT_CDP_HINT} ${CHATGPT_REASONING_HINT}`,
    );
  }

  await page.wait(0.75);

  const selected = await page.evaluate(selectReasoningOptionScript(requested.mode)) as RawChatGPTReasoningSelection;
  if (!selected?.ok) {
    const visibleLabels = (Array.isArray(selected?.visibleLabels) ? selected.visibleLabels : [])
      .map((label) => normalizeChatGPTText(label))
      .filter(Boolean)
      .slice(0, 8);
    const detail = visibleLabels.length > 0 ? ` Visible options: ${visibleLabels.join(' | ')}` : '';

    throw new CliError(
      'COMMAND_EXEC',
      `Could not find the ChatGPT reasoning mode "${requested.label}" in the current picker.${detail}`,
      `${CHATGPT_CDP_HINT} ${CHATGPT_REASONING_HINT}`,
    );
  }

  await page.wait(0.75);

  const after = await readChatGPTReasoningState(page);
  return {
    status: 'Switched',
    requested: requested.mode,
    requestedLabel: requested.label,
    reasoning: after.mode || requested.mode,
    reasoningLabel: after.label || requested.label,
  };
}

function normalizeChatGPTRole(role: string | null | undefined): string {
  const value = String(role ?? '').trim().toLowerCase();
  if (value === 'user' || value === 'human') return 'User';
  if (value === 'assistant' || value === 'ai') return 'Assistant';
  if (value === 'system') return 'System';
  return 'Message';
}

function findChatGPTReasoningOption(text: string | null | undefined): ChatGPTReasoningOption | null {
  const haystack = String(text ?? '').trim().toLowerCase();
  if (!haystack) return null;

  const direct = CHATGPT_REASONING_OPTIONS.find((option) =>
    option.aliases.some((alias) => alias === haystack) || option.mode === haystack,
  );
  if (direct) return direct;

  if (/\bgpt[-\s]?5(?:\.4)?\b.*\bpro\b|\bpro\b|研究级|专业/.test(haystack)) {
    return CHATGPT_REASONING_OPTIONS[2] ?? null;
  }
  if (/\bgpt[-\s]?5(?:\.3)?\b.*\binstant\b|\binstant\b|\bauto\b|自动/.test(haystack)) {
    return CHATGPT_REASONING_OPTIONS[0] ?? null;
  }
  if (/\bgpt[-\s]?5(?:\.4)?\b.*\bthinking\b|\bthinking\b|思考/.test(haystack)) {
    return CHATGPT_REASONING_OPTIONS[1] ?? null;
  }

  return null;
}

function requireChatGPTReasoningMode(mode: string): ChatGPTReasoningOption {
  const option = CHATGPT_REASONING_OPTIONS.find((candidate) =>
    candidate.aliases.includes(String(mode ?? '').trim().toLowerCase()) || candidate.mode === String(mode ?? '').trim().toLowerCase(),
  );

  if (!option) {
    throw new CliError(
      'COMMAND_EXEC',
      `Unsupported ChatGPT reasoning mode "${mode}".`,
      `Use one of: instant, thinking, pro. Alias: auto → instant. ${CHATGPT_REASONING_HINT}`,
    );
  }

  return option;
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

    const elementLabel = (el) => {
      if (!el) return '';
      const parts = [
        el.getAttribute?.('aria-label') || '',
        el.getAttribute?.('title') || '',
        typeof el.innerText === 'string' ? el.innerText : '',
        typeof el.textContent === 'string' ? el.textContent : '',
        el.getAttribute?.('data-testid') || '',
      ].filter(Boolean);
      return normalizeText(parts.join(' '));
    };

    const isVisible = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const clickElement = (el) => {
      if (!el) return;
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', inline: 'center' });
      }
      if (typeof el.focus === 'function') {
        el.focus();
      }
      const PointerCtor = window.PointerEvent || null;
      if (PointerCtor) {
        el.dispatchEvent(new PointerCtor('pointerdown', { bubbles: true, cancelable: true }));
      }
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      if (PointerCtor) {
        el.dispatchEvent(new PointerCtor('pointerup', { bubbles: true, cancelable: true }));
      }
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      if (typeof el.click === 'function') {
        el.click();
      } else {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
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

    const overlaySelector = [
      '[role="menu"]',
      '[role="listbox"]',
      '[role="dialog"]',
      '[data-radix-popper-content-wrapper]',
      '[data-radix-menu-content]',
      '[cmdk-root]',
      '[cmdk-list]',
      '[data-headlessui-state]',
    ].join(',');

    const detectReasoningMode = (value) => {
      const text = normalizeText(value).toLowerCase();
      if (!text) return null;
      if (/\bgpt[-\s]?5(?:\.4)?\b.*\bpro\b|\bpro\b|研究级|专业/.test(text)) return { mode: 'pro', label: 'Pro' };
      if (/\bgpt[-\s]?5(?:\.3)?\b.*\binstant\b|\binstant\b|\bauto\b|自动/.test(text)) return { mode: 'instant', label: 'Instant' };
      if (/\bgpt[-\s]?5(?:\.4)?\b.*\bthinking\b|\bthinking\b|思考/.test(text)) return { mode: 'thinking', label: 'Thinking' };
      return null;
    };

    const escapeSelectorValue = (value) => String(value ?? '').replace(/["\\\\]/g, '\\\\$&');

    const isConversationTurnNode = (el) => {
      if (!el || typeof el.closest !== 'function') return false;
      return !!el.closest('[role="log"], [data-message-author-role], article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]');
    };

    const findReasoningMenuForTrigger = (trigger) => {
      if (!trigger) return null;

      const candidates = [];
      const addCandidate = (node) => {
        if (!node) return;
        const container = typeof node.matches === 'function' && node.matches(overlaySelector)
          ? node
          : node.closest?.(overlaySelector) || node;
        if (!container || !isVisible(container) || candidates.includes(container)) return;
        candidates.push(container);
      };

      const controls = trigger.getAttribute('aria-controls') || '';
      if (controls) {
        addCandidate(document.getElementById(controls));
      }

      const triggerId = trigger.id || '';
      if (triggerId) {
        const selector = '[aria-labelledby="' + escapeSelectorValue(triggerId) + '"]';
        addCandidate(document.querySelector(selector));
      }

      if ((trigger.getAttribute('data-testid') || '') === 'model-switcher-dropdown-button') {
        for (const el of Array.from(document.querySelectorAll('[data-testid^="model-switcher-gpt-"]'))) {
          if (!isVisible(el)) continue;
          addCandidate(el.closest(overlaySelector) || el.parentElement || el);
        }
      }

      return candidates[0] || null;
    };

    const scoreReasoningTrigger = (el) => {
      if (!isVisible(el)) return Number.NEGATIVE_INFINITY;
      const label = elementLabel(el);
      const text = label.toLowerCase();
      const match = detectReasoningMode(label);
      const dataTestId = (el.getAttribute('data-testid') || '').toLowerCase();
      const ariaHasPopup = (el.getAttribute('aria-haspopup') || '').toLowerCase();
      let score = 0;

      if (dataTestId === 'model-switcher-dropdown-button') score += 900;
      if (match) score += 320;
      if (text.includes('model') || text.includes('模型')) score += 220;
      if (text.includes('reason') || text.includes('推理') || text.includes('思考')) score += 180;
      if (dataTestId.includes('model')) score += 200;
      if (dataTestId.includes('picker')) score += 160;
      if (dataTestId.includes('mode')) score += 140;
      if (ariaHasPopup === 'menu' || ariaHasPopup === 'listbox' || ariaHasPopup === 'dialog') score += 120;
      if (el.tagName === 'BUTTON') score += 90;
      if (el.getAttribute('role') === 'button') score += 70;
      if (el.closest('form, footer')) score += 140;
      if (el.closest('header')) score += 100;
      if (/\bupgrade\b|\bsubscribe\b|\btrial\b|\bpremium\b|\bbilling\b|\bplan\b/.test(text)) score -= 280;
      if (/retry|重试/.test(text)) score -= 260;
      if (label.length > 40 && !text.includes('model') && !text.includes('模型')) score -= 80;
      if (el.closest(overlaySelector)) score -= 260;
      if (isConversationTurnNode(el)) score -= 520;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') score -= 500;

      return score;
    };

    const selectReasoningTrigger = () => {
      const explicit = document.querySelector('button[data-testid="model-switcher-dropdown-button"]');
      if (explicit && isVisible(explicit)) {
        return explicit;
      }

      const selector = [
        'button',
        '[role="button"]',
        '[aria-haspopup="menu"]',
        '[aria-haspopup="listbox"]',
        '[data-testid*="model"]',
        '[data-testid*="picker"]',
        '[data-testid*="mode"]',
      ].join(',');

      let best = null;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (const el of Array.from(document.querySelectorAll(selector))) {
        const score = scoreReasoningTrigger(el);
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }

      return bestScore >= 220 ? best : null;
    };

    const readOpenReasoningSelection = (menu) => {
      if (!menu) return { mode: '', label: '' };

      const selector = [
        '[data-testid^="model-switcher-gpt-"]',
        '[role="menuitem"]',
        '[role="option"]',
        'button',
        '[role="button"]',
        'li',
      ].join(',');

      let best = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestLabel = '';

      for (const el of Array.from(menu.querySelectorAll(selector))) {
        if (!isVisible(el)) continue;
        const dataTestId = (el.getAttribute('data-testid') || '').toLowerCase();
        const label = elementLabel(el);
        const match = detectReasoningMode(label + ' ' + dataTestId);
        if (!match) continue;

        let score = 0;
        if (dataTestId.startsWith('model-switcher-')) score += 260;
        if (el.querySelector('.trailing svg, .trailing use')) score += 260;
        if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true') score += 220;
        if (el.getAttribute('data-state') === 'checked' || el.getAttribute('data-selected') === 'true') score += 220;
        if (el.getAttribute('role') === 'menuitem' || el.getAttribute('role') === 'option') score += 80;

        if (score > bestScore) {
          best = match;
          bestScore = score;
          bestLabel = label;
        }
      }

      return {
        mode: best ? best.mode : '',
        label: best ? (best.label || bestLabel) : '',
      };
    };

    const readReasoningState = () => {
      const trigger = selectReasoningTrigger();
      const triggerLabel = elementLabel(trigger);
      const menu = findReasoningMenuForTrigger(trigger);
      const current = readOpenReasoningSelection(menu);
      const match = current.mode ? current : (detectReasoningMode(triggerLabel) || { mode: '', label: '' });

      return {
        mode: match ? match.mode : '',
        label: match ? match.label : '',
        triggerFound: !!trigger,
        triggerLabel,
      };
    };  `;
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
      const reasoning = readReasoningState();

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
        reasoningMode: reasoning.mode,
        reasoningLabel: reasoning.label,
        reasoningTriggerFound: reasoning.triggerFound,
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

function readReasoningStateScript(): string {
  return `
    (() => {
      ${domHelpersScript()}
      return readReasoningState();
    })()
  `;
}

function openReasoningPickerScript(): string {
  return `
    (() => {
      ${domHelpersScript()}

      const trigger = selectReasoningTrigger();
      if (!trigger) {
        return { opened: false, triggerLabel: '' };
      }

      const triggerLabel = elementLabel(trigger);
      const existingMenu = findReasoningMenuForTrigger(trigger);
      if (existingMenu) {
        return { opened: true, triggerLabel };
      }

      clickElement(trigger);
      return { opened: true, triggerLabel };
    })()
  `;
}

function selectReasoningOptionScript(mode: ChatGPTReasoningMode): string {
  return `
    (() => {
      ${domHelpersScript()}

      const target = ${JSON.stringify(mode)};
      const trigger = selectReasoningTrigger();
      const menu = findReasoningMenuForTrigger(trigger);
      const selector = [
        '[data-testid^="model-switcher-gpt-"]',
        '[role="menuitem"]',
        '[role="option"]',
        'button',
        '[role="button"]',
        'li',
      ].join(',');

      const candidates = menu ? Array.from(menu.querySelectorAll(selector)) : [];

      const scoreReasoningOption = (el) => {
        if (!isVisible(el)) return Number.NEGATIVE_INFINITY;
        if (isConversationTurnNode(el)) return Number.NEGATIVE_INFINITY;

        const dataTestId = (el.getAttribute('data-testid') || '').toLowerCase();
        const label = elementLabel(el);
        const match = detectReasoningMode(label + ' ' + dataTestId);
        if (!match || match.mode !== target) return Number.NEGATIVE_INFINITY;

        let score = 0;
        if (match.mode === target) score += 420;
        if (dataTestId.startsWith('model-switcher-')) score += 320;
        if (target === 'pro' && dataTestId.includes('pro')) score += 180;
        if (target === 'thinking' && dataTestId.includes('thinking')) score += 180;
        if (target === 'instant' && (dataTestId.includes('gpt-5-3') || /\bauto\b|自动/.test(label.toLowerCase()))) score += 220;
        if (el.closest(overlaySelector)) score += 180;
        if (el.getAttribute('role') === 'menuitem' || el.getAttribute('role') === 'option') score += 100;
        if (el.tagName === 'BUTTON') score += 60;
        if (/\bupgrade\b|\bsubscribe\b|\btrial\b|\bpremium\b|\bbilling\b|\bplan\b/.test(label.toLowerCase())) score -= 320;
        if (/retry|重试/.test(label.toLowerCase())) score -= 260;
        if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked') score += 40;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') score -= 600;
        return score;
      };

      let best = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestLabel = '';

      for (const el of candidates) {
        const score = scoreReasoningOption(el);
        if (score > bestScore) {
          best = el;
          bestScore = score;
          bestLabel = elementLabel(el);
        }
      }

      if (!best) {
        const visibleLabels = candidates
          .filter(isVisible)
          .map((el) => elementLabel(el))
          .filter(Boolean)
          .slice(0, 12);
        return { ok: false, visibleLabels };
      }

      clickElement(best);
      return { ok: true, label: bestLabel };
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
  detectChatGPTReasoningMode,
  formatChatGPTSendResultRow,
  formatChatGPTStatusRow,
  normalizeChatGPTReasoningInput,
  normalizeChatGPTText,
  normalizeChatGPTTurns,
};
