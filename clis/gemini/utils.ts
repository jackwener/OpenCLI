import { CommandExecutionError } from '../../src/errors.js';
import type { IPage } from '../../src/types.js';

export const GEMINI_DOMAIN = 'gemini.google.com';
export const GEMINI_APP_URL = 'https://gemini.google.com/app';

export interface GeminiPageState {
  url: string;
  title: string;
  isSignedIn: boolean | null;
  composerLabel: string;
  canSend: boolean;
}

export interface GeminiTurn {
  Role: 'User' | 'Assistant' | 'System';
  Text: string;
}

export interface GeminiSnapshot {
  turns: GeminiTurn[];
  transcriptLines: string[];
  composerHasText: boolean;
  isGenerating: boolean;
  structuredTurnsTrusted: boolean;
}

export interface GeminiStructuredAppend {
  appendedTurns: GeminiTurn[];
  hasTrustedAppend: boolean;
  hasNewUserTurn: boolean;
  hasNewAssistantTurn: boolean;
}

export interface GeminiSubmissionBaseline {
  snapshot: GeminiSnapshot;
  preSendAssistantCount: number;
  userAnchorTurn: GeminiTurn | null;
  reason: 'user_turn' | 'composer_generating' | 'composer_transcript';
}

const GEMINI_RESPONSE_NOISE_PATTERNS = [
  /Gemini can make mistakes\.?/gi,
  /Google Terms/gi,
  /Google Privacy Policy/gi,
  /Opens in a new window/gi,
];
const GEMINI_TRANSCRIPT_CHROME_MARKERS = ['gemini', '我的内容', '对话', 'google terms', 'google privacy policy'];

const GEMINI_COMPOSER_SELECTORS = [
  '.ql-editor[contenteditable="true"]',
  '.ql-editor[role="textbox"]',
  '.ql-editor[aria-label*="Gemini"]',
  '[contenteditable="true"][aria-label*="Gemini"]',
  '[aria-label="Enter a prompt for Gemini"]',
  '[aria-label*="prompt for Gemini"]',
];

const GEMINI_COMPOSER_MARKER_ATTR = 'data-opencli-gemini-composer';
const GEMINI_COMPOSER_PREPARE_ATTEMPTS = 4;
const GEMINI_COMPOSER_PREPARE_WAIT_SECONDS = 1;

function buildGeminiComposerLocatorScript(): string {
  const selectorsJson = JSON.stringify(GEMINI_COMPOSER_SELECTORS);
  const markerAttrJson = JSON.stringify(GEMINI_COMPOSER_MARKER_ATTR);
  return `
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const markerAttr = ${markerAttrJson};
      const clearComposerMarkers = (active) => {
        document.querySelectorAll('[' + markerAttr + ']').forEach((node) => {
          if (node !== active) node.removeAttribute(markerAttr);
        });
      };

      const markComposer = (node) => {
        if (!(node instanceof HTMLElement)) return null;
        clearComposerMarkers(node);
        node.setAttribute(markerAttr, '1');
        return node;
      };

      const findComposer = () => {
        const marked = document.querySelector('[' + markerAttr + '="1"]');
        if (marked instanceof HTMLElement && isVisible(marked)) return marked;

        const selectors = ${selectorsJson};
        for (const selector of selectors) {
          const node = Array.from(document.querySelectorAll(selector)).find((candidate) => candidate instanceof HTMLElement && isVisible(candidate));
          if (node instanceof HTMLElement) return markComposer(node);
        }
        return null;
      };
  `;
}

export function sanitizeGeminiResponseText(value: string, promptText: string): string {
  let sanitized = value;
  for (const pattern of GEMINI_RESPONSE_NOISE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  sanitized = sanitized.trim();

  const prompt = promptText.trim();
  if (!prompt) return sanitized;
  if (sanitized === prompt) return '';

  for (const separator of ['\n\n', '\n', '\r\n\r\n', '\r\n']) {
    const prefix = `${prompt}${separator}`;
    if (sanitized.startsWith(prefix)) {
      return sanitized.slice(prefix.length).trim();
    }
  }

  return sanitized;
}

export function collectGeminiTranscriptAdditions(
  beforeLines: string[],
  currentLines: string[],
  promptText: string,
): string {
  const beforeSet = new Set(beforeLines);
  const additions = currentLines
    .filter((line) => !beforeSet.has(line))
    .map((line) => extractGeminiTranscriptLineCandidate(line, promptText))
    .filter((line) => line && line !== promptText);

  return additions.join('\n').trim();
}

export function collapseAdjacentGeminiTurns(turns: GeminiTurn[]): GeminiTurn[] {
  const collapsed: GeminiTurn[] = [];

  for (const turn of turns) {
    if (!turn || typeof turn.Role !== 'string' || typeof turn.Text !== 'string') continue;
    const previous = collapsed.at(-1);
    if (previous?.Role === turn.Role && previous.Text === turn.Text) continue;
    collapsed.push(turn);
  }

  return collapsed;
}

function hasGeminiTurnPrefix(before: GeminiTurn[], current: GeminiTurn[]): boolean {
  if (before.length > current.length) return false;
  return before.every((turn, index) => (
    turn.Role === current[index]?.Role
    && turn.Text === current[index]?.Text
  ));
}

function findLastMatchingGeminiTurnIndex(turns: GeminiTurn[], target: GeminiTurn | null): number | null {
  if (!target) return null;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.Role === target.Role && turn.Text === target.Text) {
      return index;
    }
  }
  return null;
}

function diffTrustedStructuredTurns(
  before: GeminiSnapshot,
  current: GeminiSnapshot,
): GeminiStructuredAppend {
  if (!before.structuredTurnsTrusted || !current.structuredTurnsTrusted) {
    return {
      appendedTurns: [],
      hasTrustedAppend: false,
      hasNewUserTurn: false,
      hasNewAssistantTurn: false,
    };
  }

  if (!hasGeminiTurnPrefix(before.turns, current.turns)) {
    return {
      appendedTurns: [],
      hasTrustedAppend: false,
      hasNewUserTurn: false,
      hasNewAssistantTurn: false,
    };
  }

  const appendedTurns = current.turns.slice(before.turns.length);
  return {
    appendedTurns,
    hasTrustedAppend: appendedTurns.length > 0,
    hasNewUserTurn: appendedTurns.some((turn) => turn.Role === 'User'),
    hasNewAssistantTurn: appendedTurns.some((turn) => turn.Role === 'Assistant'),
  };
}

function diffTranscriptLines(before: GeminiSnapshot, current: GeminiSnapshot): string[] {
  const beforeLines = new Set(before.transcriptLines);
  return current.transcriptLines.filter((line) => !beforeLines.has(line));
}

function isLikelyGeminiTranscriptChrome(line: string): boolean {
  const lower = line.toLowerCase();
  const markerHits = GEMINI_TRANSCRIPT_CHROME_MARKERS.filter((marker) => lower.includes(marker)).length;
  return markerHits >= 2;
}

function extractGeminiTranscriptLineCandidate(transcriptLine: string, promptText: string): string {
  const candidate = transcriptLine.trim();
  if (!candidate) return '';

  const prompt = promptText.trim();
  const sanitized = sanitizeGeminiResponseText(candidate, promptText);

  if (!prompt) return sanitized;
  if (!candidate.includes(prompt)) return sanitized;
  if (sanitized && sanitized !== prompt && sanitized !== candidate) return sanitized;
  if (isLikelyGeminiTranscriptChrome(candidate)) return '';

  // Some transcript snapshots flatten "prompt + answer" into a single line.
  // Recover the answer only when the line starts with the current prompt.
  if (candidate.startsWith(prompt)) {
    const tail = candidate.slice(prompt.length).replace(/^[\s:：,，-]+/, '').trim();
    return tail ? sanitizeGeminiResponseText(tail, '') : '';
  }

  return sanitized;
}

function getStateScript(): string {
  return `
    (() => {
      ${buildGeminiComposerLocatorScript()}

      const signInNode = Array.from(document.querySelectorAll('a, button')).find((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
        const href = node.getAttribute('href') || '';
        return text === 'sign in'
          || aria === 'sign in'
          || text === '登录'
          || aria === '登录'
          || href.includes('accounts.google.com/ServiceLogin');
      });

      const composer = findComposer();

      return {
        url: window.location.href,
        title: document.title || '',
        isSignedIn: signInNode ? false : (composer ? true : null),
        composerLabel: composer?.getAttribute('aria-label') || '',
        canSend: !!composer,
      };
    })()
  `;
}

function readGeminiSnapshotScript(): string {
  return `
    (() => {
      ${buildGeminiComposerLocatorScript()}
      const composer = findComposer();
      const composerText = composer?.textContent?.replace(/\\u00a0/g, ' ').trim() || '';
      const isGenerating = !!Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
        return text === 'stop response'
          || aria === 'stop response'
          || text === '停止回答'
          || aria === '停止回答';
      });
      const turns = ${getTurnsScript().trim()};
      const transcriptLines = ${getTranscriptLinesScript().trim()};

      return {
        turns,
        transcriptLines,
        composerHasText: composerText.length > 0,
        isGenerating,
        structuredTurnsTrusted: turns.length > 0 || transcriptLines.length === 0,
      };
    })()
  `;
}

function getTranscriptLinesScript(): string {
  return `
    (() => {
      const clean = (value) => (value || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();

      const main = document.querySelector('main') || document.body;
      const root = main.cloneNode(true);

      const removableSelectors = [
        'button',
        'nav',
        'header',
        'footer',
        '[aria-label="Enter a prompt for Gemini"]',
        '[aria-label*="prompt for Gemini"]',
        '.input-area-container',
        '.input-wrapper',
        '.textbox-container',
        '.ql-toolbar',
        '.send-button',
        '.main-menu-button',
        '.sign-in-button',
      ];

      for (const selector of removableSelectors) {
        root.querySelectorAll(selector).forEach((node) => node.remove());
      }
      root.querySelectorAll('script, style, noscript').forEach((node) => node.remove());

      const stopLines = new Set([
        'Gemini',
        'Google Terms',
        'Google Privacy Policy',
        'Meet Gemini, your personal AI assistant',
        'Conversation with Gemini',
        'Ask Gemini 3',
        'Write',
        'Plan',
        'Research',
        'Learn',
        'Fast',
        'send',
        'Microphone',
        'Main menu',
        'New chat',
        'Sign in',
        'Google Terms Opens in a new window',
        'Google Privacy Policy Opens in a new window',
      ]);

      const noisyPatterns = [
        /^Google Terms$/,
        /^Google Privacy Policy$/,
        /^Gemini is AI and can make mistakes\.?$/,
        /^and the$/,
        /^apply\.$/,
        /^Opens in a new window$/,
        /^Open mode picker$/,
        /^Open upload file menu$/,
        /^Tools$/,
      ];

      return clean(root.innerText || root.textContent || '')
        .split('\\n')
        .map((line) => clean(line))
        .filter((line) => line
          && line.length <= 4000
          && !stopLines.has(line)
          && !noisyPatterns.some((pattern) => pattern.test(line)));
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

      const selectors = [
        '[data-testid*="message"]',
        '[data-test-id*="message"]',
        '[class*="message"]',
        '[class*="conversation-turn"]',
        '[class*="query-text"]',
        '[class*="response-text"]',
      ];

      const roots = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
      const unique = roots
        .filter((el, index, all) => all.indexOf(el) === index)
        .filter(isVisible)
        .sort((left, right) => {
          if (left === right) return 0;
          const relation = left.compareDocumentPosition(right);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });

      const turns = unique.map((el) => {
        const text = clean(el.innerText || el.textContent || '');
        if (!text) return null;

        const roleAttr = [
          el.getAttribute('data-message-author-role'),
          el.getAttribute('data-role'),
          el.getAttribute('aria-label'),
          el.getAttribute('class'),
        ].filter(Boolean).join(' ').toLowerCase();

        let role = '';
        if (roleAttr.includes('user') || roleAttr.includes('query')) role = 'User';
        else if (roleAttr.includes('assistant') || roleAttr.includes('model') || roleAttr.includes('response') || roleAttr.includes('gemini')) role = 'Assistant';

        return role ? { Role: role, Text: text } : null;
      }).filter(Boolean);

      return turns;
    })()
  `;
}

function prepareComposerScript(): string {
  return `
    (() => {
      ${buildGeminiComposerLocatorScript()}
      const composer = findComposer();

      if (!(composer instanceof HTMLElement)) {
        return { ok: false, reason: 'Could not find Gemini composer' };
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
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' }));
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }

      return {
        ok: true,
        label: composer.getAttribute('aria-label') || '',
      };
    })()
  `;
}

function composerHasTextScript(): string {
  return `
    (() => {
      ${buildGeminiComposerLocatorScript()}
      const composer = findComposer();

      return {
        hasText: !!(composer && ((composer.textContent || '').trim() || (composer.innerText || '').trim())),
      };
    })()
  `;
}

function insertComposerTextFallbackScript(text: string): string {
  return `
    ((inputText) => {
      ${buildGeminiComposerLocatorScript()}
      const composer = findComposer();

      if (!(composer instanceof HTMLElement)) {
        return { hasText: false, reason: 'Could not find Gemini composer' };
      }

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);

      composer.focus();
      composer.textContent = '';
      const execResult = typeof document.execCommand === 'function'
        ? document.execCommand('insertText', false, inputText)
        : false;

      if (!execResult) {
        const paragraph = document.createElement('p');
        const lines = String(inputText).split(/\\n/);
        for (const [index, line] of lines.entries()) {
          if (index > 0) paragraph.appendChild(document.createElement('br'));
          paragraph.appendChild(document.createTextNode(line));
        }
        composer.replaceChildren(paragraph);
      }

      composer.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: inputText, inputType: 'insertText' }));
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: inputText, inputType: 'insertText' }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        hasText: !!((composer.textContent || '').trim() || (composer.innerText || '').trim()),
      };
    })(${JSON.stringify(text)})
  `;
}

function submitComposerScript(): string {
  return `
    (() => {
      ${buildGeminiComposerLocatorScript()}
      const composer = findComposer();

      if (!(composer instanceof HTMLElement)) {
        throw new Error('Could not find Gemini composer');
      }

      const composerRect = composer.getBoundingClientRect();
      const rootCandidates = [
        composer.closest('form'),
        composer.closest('[role="form"]'),
        composer.closest('.input-area-container'),
        composer.closest('.textbox-container'),
        composer.closest('.input-wrapper'),
        composer.parentElement,
        composer.parentElement?.parentElement,
      ].filter(Boolean);

      const seen = new Set();
      const buttons = [];
      for (const root of rootCandidates) {
        root.querySelectorAll('button, [role="button"]').forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (seen.has(node)) return;
          seen.add(node);
          buttons.push(node);
        });
      }

      const excludedPattern = /main menu|主菜单|microphone|麦克风|upload|上传|mode|模式|tools|工具|settings|临时对话|new chat|新对话/i;
      const submitPattern = /send|发送|submit|提交/i;
      let bestButton = null;
      let bestScore = -1;

      for (const button of buttons) {
        if (!isVisible(button)) continue;
        if (button instanceof HTMLButtonElement && button.disabled) continue;
        if (button.getAttribute('aria-disabled') === 'true') continue;

        const label = ((button.getAttribute('aria-label') || '') + ' ' + ((button.textContent || '').trim())).trim();
        if (excludedPattern.test(label)) continue;

        const rect = button.getBoundingClientRect();
        const verticalDistance = Math.abs((rect.top + rect.bottom) / 2 - (composerRect.top + composerRect.bottom) / 2);
        if (verticalDistance > 160) continue;

        let score = 0;
        if (submitPattern.test(label)) score += 10;
        if (rect.left >= composerRect.right - 160) score += 3;
        if (rect.left >= composerRect.left) score += 1;
        if (rect.width <= 96 && rect.height <= 96) score += 1;

        if (score > bestScore) {
          bestScore = score;
          bestButton = button;
        }
      }

      if (bestButton instanceof HTMLElement && bestScore >= 3) {
        bestButton.click();
        return 'button';
      }

      return 'enter';
    })()
  `;
}

function dispatchComposerEnterScript(): string {
  return `
    (() => {
      ${buildGeminiComposerLocatorScript()}
      const composer = findComposer();

      if (!(composer instanceof HTMLElement)) {
        throw new Error('Could not find Gemini composer');
      }

      composer.focus();
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      return 'enter';
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

      const candidates = Array.from(document.querySelectorAll('button, a')).filter((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
        return isVisible(node) && (
          text === 'new chat'
          || aria === 'new chat'
          || text === '发起新对话'
          || aria === '发起新对话'
          || text === '新对话'
          || aria === '新对话'
        );
      });

      const target = candidates.find((node) => !node.hasAttribute('disabled')) || candidates[0];
      if (target instanceof HTMLElement) {
        target.click();
        return 'clicked';
      }
      return 'navigate';
    })()
  `;
}

function currentUrlScript(): string {
  return 'window.location.href';
}

export async function isOnGemini(page: IPage): Promise<boolean> {
  const url = await page.evaluate(currentUrlScript()).catch(() => '');
  if (typeof url !== 'string' || !url) return false;
  try {
    const hostname = new URL(url).hostname;
    return hostname === GEMINI_DOMAIN || hostname.endsWith(`.${GEMINI_DOMAIN}`);
  } catch {
    return false;
  }
}

export async function ensureGeminiPage(page: IPage): Promise<void> {
  if (!(await isOnGemini(page))) {
    await page.goto(GEMINI_APP_URL, { waitUntil: 'load', settleMs: 2500 });
    await page.wait(1);
  }
}

export async function getGeminiPageState(page: IPage): Promise<GeminiPageState> {
  await ensureGeminiPage(page);
  return await page.evaluate(getStateScript()) as GeminiPageState;
}

export async function startNewGeminiChat(page: IPage): Promise<'clicked' | 'navigate'> {
  await ensureGeminiPage(page);
  const action = await page.evaluate(clickNewChatScript()) as 'clicked' | 'navigate';
  if (action === 'navigate') {
    await page.goto(GEMINI_APP_URL, { waitUntil: 'load', settleMs: 2500 });
  }
  await page.wait(1);
  return action;
}

export async function getGeminiVisibleTurns(page: IPage): Promise<GeminiTurn[]> {
  const turns = await getGeminiStructuredTurns(page);
  if (Array.isArray(turns) && turns.length > 0) return turns;

  const lines = await getGeminiTranscriptLines(page);
  return lines.map((line) => ({ Role: 'System', Text: line }));
}

async function getGeminiStructuredTurns(page: IPage): Promise<GeminiTurn[]> {
  await ensureGeminiPage(page);
  const turns = collapseAdjacentGeminiTurns(await page.evaluate(getTurnsScript()) as GeminiTurn[]);
  return Array.isArray(turns) ? turns : [];
}

export async function getGeminiTranscriptLines(page: IPage): Promise<string[]> {
  await ensureGeminiPage(page);
  return await page.evaluate(getTranscriptLinesScript()) as string[];
}

export async function readGeminiSnapshot(page: IPage): Promise<GeminiSnapshot> {
  await ensureGeminiPage(page);
  return await page.evaluate(readGeminiSnapshotScript()) as GeminiSnapshot;
}

function findLastUserTurnIndex(turns: GeminiTurn[]): number | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.Role === 'User') return index;
  }
  return null;
}

function findLastUserTurn(turns: GeminiTurn[]): GeminiTurn | null {
  const index = findLastUserTurnIndex(turns);
  return index === null ? null : turns[index] ?? null;
}

export async function waitForGeminiSubmission(
  page: IPage,
  before: GeminiSnapshot,
  timeoutSeconds: number,
): Promise<GeminiSubmissionBaseline | null> {
  const preSendAssistantCount = before.turns.filter((turn) => turn.Role === 'Assistant').length;
  const maxPolls = Math.max(1, Math.ceil(timeoutSeconds));

  for (let index = 0; index < maxPolls; index += 1) {
    await page.wait(index === 0 ? 0.5 : 1);
    const current = await readGeminiSnapshot(page);
    const structuredAppend = diffTrustedStructuredTurns(before, current);
    const transcriptDelta = diffTranscriptLines(before, current);

    if (structuredAppend.hasTrustedAppend && structuredAppend.hasNewUserTurn) {
      return {
        snapshot: current,
        preSendAssistantCount,
        userAnchorTurn: findLastUserTurn(current.turns),
        reason: 'user_turn',
      };
    }

    if (!current.composerHasText && current.isGenerating) {
      return {
        snapshot: current,
        preSendAssistantCount,
        userAnchorTurn: findLastUserTurn(current.turns),
        reason: 'composer_generating',
      };
    }

    if (!current.composerHasText && transcriptDelta.length > 0) {
      return {
        snapshot: current,
        preSendAssistantCount,
        userAnchorTurn: findLastUserTurn(current.turns),
        reason: 'composer_transcript',
      };
    }
  }

  return null;
}

export async function sendGeminiMessage(page: IPage, text: string): Promise<'button' | 'enter'> {
  await ensureGeminiPage(page);
  let prepared: { ok?: boolean; reason?: string } | undefined;
  for (let attempt = 0; attempt < GEMINI_COMPOSER_PREPARE_ATTEMPTS; attempt += 1) {
    prepared = await page.evaluate(prepareComposerScript()) as { ok?: boolean; reason?: string };
    if (prepared?.ok) break;
    if (attempt < GEMINI_COMPOSER_PREPARE_ATTEMPTS - 1) await page.wait(GEMINI_COMPOSER_PREPARE_WAIT_SECONDS);
  }
  if (!prepared?.ok) {
    throw new CommandExecutionError(prepared?.reason || 'Could not find Gemini composer');
  }

  let hasText = false;
  if (page.nativeType) {
    try {
      await page.nativeType(text);
      await page.wait(0.2);
      const nativeState = await page.evaluate(composerHasTextScript()) as { hasText?: boolean };
      hasText = !!nativeState?.hasText;
    } catch {}
  }

  if (!hasText) {
    const fallbackState = await page.evaluate(insertComposerTextFallbackScript(text)) as { hasText?: boolean };
    hasText = !!fallbackState?.hasText;
  }

  if (!hasText) {
    throw new CommandExecutionError('Failed to insert text into Gemini composer');
  }

  const submitAction = await page.evaluate(submitComposerScript()) as 'button' | 'enter';
  if (submitAction === 'button') {
    await page.wait(1);
    return 'button';
  }

  if (page.nativeKeyPress) {
    try {
      await page.nativeKeyPress('Enter');
    } catch {
      await page.evaluate(dispatchComposerEnterScript());
    }
  } else {
    await page.evaluate(dispatchComposerEnterScript());
  }

  await page.wait(1);
  return 'enter';
}

export const __test__ = {
  GEMINI_COMPOSER_SELECTORS,
  GEMINI_COMPOSER_MARKER_ATTR,
  collapseAdjacentGeminiTurns,
  clickNewChatScript,
  diffTranscriptLines,
  diffTrustedStructuredTurns,
  hasGeminiTurnPrefix,
  readGeminiSnapshot,
  readGeminiSnapshotScript,
  submitComposerScript,
  insertComposerTextFallbackScript,
};

export async function getGeminiVisibleImageUrls(page: IPage): Promise<string[]> {
  await ensureGeminiPage(page);
  return await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 32 && rect.height > 32;
      };

      const imgs = Array.from(document.querySelectorAll('main img')).filter((img) => img instanceof HTMLImageElement && isVisible(img));
      const urls = [];
      const seen = new Set();

      for (const img of imgs) {
        const src = img.currentSrc || img.src || '';
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (!src) continue;
        if (alt.includes('avatar') || alt.includes('logo') || alt.includes('icon')) continue;
        if (width < 128 && height < 128) continue;
        if (seen.has(src)) continue;
        seen.add(src);
        urls.push(src);
      }
      return urls;
    })()
  `) as string[];
}

export async function waitForGeminiImages(
  page: IPage,
  beforeUrls: string[],
  timeoutSeconds: number,
): Promise<string[]> {
  const beforeSet = new Set(beforeUrls);
  const pollIntervalSeconds = 3;
  const maxPolls = Math.max(1, Math.ceil(timeoutSeconds / pollIntervalSeconds));
  let lastUrls: string[] = [];
  let stableCount = 0;

  for (let index = 0; index < maxPolls; index += 1) {
    await page.wait(index === 0 ? 2 : pollIntervalSeconds);
    const urls = (await getGeminiVisibleImageUrls(page)).filter((url) => !beforeSet.has(url));
    if (urls.length === 0) continue;

    const key = urls.join('\n');
    const prevKey = lastUrls.join('\n');
    if (key == prevKey) stableCount += 1;
    else {
      lastUrls = urls;
      stableCount = 1;
    }

    if (stableCount >= 2 || index === maxPolls - 1) return lastUrls;
  }

  return lastUrls;
}

export interface GeminiImageAsset {
  url: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

export async function exportGeminiImages(page: IPage, urls: string[]): Promise<GeminiImageAsset[]> {
  await ensureGeminiPage(page);
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

      const images = Array.from(document.querySelectorAll('main img'));
      const results = [];

      for (const targetUrl of targetUrls) {
        const img = images.find((node) => (node.currentSrc || node.src || '') === targetUrl);
        let dataUrl = '';
        let mimeType = 'image/jpeg';
        const width = img?.naturalWidth || img?.width || 0;
        const height = img?.naturalHeight || img?.height || 0;

        try {
          if (String(targetUrl).startsWith('data:')) {
            dataUrl = String(targetUrl);
            mimeType = (String(targetUrl).match(/^data:([^;]+);/i) || [])[1] || 'image/png';
          } else {
            const res = await fetch(String(targetUrl), { credentials: 'include' });
            if (res.ok) {
              const blob = await res.blob();
              mimeType = inferMime(blob.type, targetUrl);
              dataUrl = await blobToDataUrl(blob);
            }
          }
        } catch {}

        if (!dataUrl && img instanceof HTMLImageElement) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0);
              dataUrl = canvas.toDataURL('image/png');
              mimeType = 'image/png';
            }
          } catch {}
        }

        if (dataUrl) {
          results.push({ url: String(targetUrl), dataUrl, mimeType, width, height });
        }
      }

      return results;
    })(${urlsJson})
  `) as GeminiImageAsset[];
}
export async function waitForGeminiResponse(
  page: IPage,
  baseline: GeminiSubmissionBaseline,
  promptText: string,
  timeoutSeconds: number,
): Promise<string> {
  if (timeoutSeconds <= 0) return '';

  // Reply ownership must survive Gemini prepending older history later.
  // Re-anchor on the submitted user turn when possible, and otherwise only
  // accept assistants that are appended to the exact submission snapshot.
  const pickStructuredReplyCandidate = (current: GeminiSnapshot): string => {
    if (!current.structuredTurnsTrusted) return '';

    const userAnchorTurnIndex = findLastMatchingGeminiTurnIndex(current.turns, baseline.userAnchorTurn);
    if (userAnchorTurnIndex !== null) {
      const candidate = current.turns
        .slice(userAnchorTurnIndex + 1)
        .filter((turn) => turn.Role === 'Assistant')
        .at(-1);
      return candidate ? sanitizeGeminiResponseText(candidate.Text, promptText) : '';
    }

    if (hasGeminiTurnPrefix(baseline.snapshot.turns, current.turns)) {
      const appendedAssistant = current.turns
        .slice(baseline.snapshot.turns.length)
        .filter((turn) => turn.Role === 'Assistant')
        .at(-1);
      if (appendedAssistant) {
        return sanitizeGeminiResponseText(appendedAssistant.Text, promptText);
      }
    }

    return '';
  };

  const pickFallbackGeminiTranscriptReply = (current: GeminiSnapshot): string => current.transcriptLines
    .filter((line) => !baseline.snapshot.transcriptLines.includes(line))
    .map((line) => extractGeminiTranscriptLineCandidate(line, promptText))
    .filter(Boolean)
    .join('\n')
    .trim();

  const maxPolls = Math.max(1, Math.ceil(timeoutSeconds / 2));
  let lastStructured = '';
  let structuredStableCount = 0;
  let lastTranscript = '';
  let transcriptStableCount = 0;
  let transcriptMissCount = 0;

  for (let index = 0; index < maxPolls; index += 1) {
    await page.wait(index === 0 ? 1 : 2);
    const current = await readGeminiSnapshot(page);
    const structuredCandidate = pickStructuredReplyCandidate(current);

    if (structuredCandidate) {
      if (structuredCandidate === lastStructured) structuredStableCount += 1;
      else {
        lastStructured = structuredCandidate;
        structuredStableCount = 1;
      }

      if (!current.isGenerating && structuredStableCount >= 2) {
        return structuredCandidate;
      }

      continue;
    }

    transcriptMissCount += 1;
    if (transcriptMissCount < 2) continue;

    const transcriptCandidate = pickFallbackGeminiTranscriptReply(current);
    if (!transcriptCandidate) continue;

    if (transcriptCandidate === lastTranscript) transcriptStableCount += 1;
    else {
      lastTranscript = transcriptCandidate;
      transcriptStableCount = 1;
    }

    if (!current.isGenerating && transcriptStableCount >= 2) {
      return transcriptCandidate;
    }
  }

  return '';
}
