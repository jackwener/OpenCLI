import { CommandExecutionError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

export const GEMINI_DOMAIN = 'gemini.google.com';
export const GEMINI_APP_URL = 'https://gemini.google.com/app';
export const GEMINI_DEEP_RESEARCH_DEFAULT_TOOL_LABELS = ['Deep Research', 'Deep research', '\u6df1\u5ea6\u7814\u7a76'];
export const GEMINI_DEEP_RESEARCH_DEFAULT_CONFIRM_LABELS = [
  'Start research',
  'Start Research',
  'Start deep research',
  'Start Deep Research',
  'Generate research plan',
  'Generate Research Plan',
  'Generate deep research plan',
  'Generate Deep Research Plan',
  '\u5f00\u59cb\u7814\u7a76',
  '\u5f00\u59cb\u6df1\u5ea6\u7814\u7a76',
  '\u5f00\u59cb\u8c03\u7814',
  '\u751f\u6210\u7814\u7a76\u8ba1\u5212',
  '\u751f\u6210\u8c03\u7814\u8ba1\u5212',
];

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

export interface GeminiConversation {
  Title: string;
  Url: string;
}

export type GeminiTitleMatchMode = 'contains' | 'exact';

export interface GeminiSnapshot {
  url?: string;
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

export function resolveGeminiLabels(value: unknown, fallback: string[]): string[] {
  const label = String(value ?? '').trim();
  return label ? [label] : fallback;
}

export function parseGeminiPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseGeminiTitleMatchMode(value: unknown, fallback: GeminiTitleMatchMode = 'contains'): GeminiTitleMatchMode | null {
  const raw = String(value ?? fallback).trim().toLowerCase();
  if (raw === 'contains' || raw === 'exact') return raw;
  return null;
}

export function parseGeminiConversationUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname !== GEMINI_DOMAIN && !url.hostname.endsWith(`.${GEMINI_DOMAIN}`)) return null;
    if (!url.pathname.startsWith('/app/')) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeGeminiTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function pickGeminiConversationByTitle(
  conversations: GeminiConversation[],
  query: string,
  mode: GeminiTitleMatchMode = 'contains',
): GeminiConversation | null {
  const normalizedQuery = normalizeGeminiTitle(query);
  if (!normalizedQuery) return null;

  for (const conversation of conversations) {
    const normalizedTitle = normalizeGeminiTitle(conversation.Title);
    if (!normalizedTitle) continue;
    if (mode === 'exact') {
      if (normalizedTitle === normalizedQuery) return conversation;
      continue;
    }
    if (normalizedTitle.includes(normalizedQuery)) return conversation;
  }

  return null;
}

export function resolveGeminiConversationForQuery(
  conversations: GeminiConversation[],
  query: string,
  mode: GeminiTitleMatchMode,
): GeminiConversation | null {
  const normalizedQuery = String(query ?? '').trim();
  if (!normalizedQuery) return conversations[0] ?? null;

  const exact = pickGeminiConversationByTitle(conversations, normalizedQuery, 'exact');
  if (exact) return exact;
  if (mode === 'contains') return pickGeminiConversationByTitle(conversations, normalizedQuery, 'contains');
  return null;
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
        url: window.location.href,
        turns,
        transcriptLines,
        composerHasText: composerText.length > 0,
        isGenerating,
        structuredTurnsTrusted: turns.length > 0 || transcriptLines.length === 0,
      };
    })()
  `;
}

function isGeminiConversationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== GEMINI_DOMAIN && !parsed.hostname.endsWith(`.${GEMINI_DOMAIN}`)) return false;
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return pathname.startsWith('/app/') && pathname !== '/app';
  } catch {
    return false;
  }
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

function openGeminiToolsMenuScript(): string {
  return `
    (() => {
      const labels = ['tools', 'tool', 'mode', '研究', 'deep research', 'deep-research', '工具'];
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const matchesLabel = (value) => {
        const text = normalize(value);
        return labels.some((label) => text.includes(label));
      };

      const isDisabled = (el) => {
        if (!(el instanceof HTMLElement)) return true;
        if ('disabled' in el && el.disabled) return true;
        if (el.hasAttribute('disabled')) return true;
        const ariaDisabled = (el.getAttribute('aria-disabled') || '').toLowerCase();
        return ariaDisabled === 'true';
      };

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = el.getAttribute('aria-hidden');
        if (ariaHidden && ariaHidden.toLowerCase() === 'true') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        if (style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const isInteractable = (el) => isVisible(el) && !isDisabled(el);

      const roots = [
        document.querySelector('main'),
        document.querySelector('[role="main"]'),
        document.querySelector('header'),
        document,
      ].filter(Boolean);

      const isMenuTrigger = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const popupValue = (node.getAttribute('aria-haspopup') || '').toLowerCase();
        const hasPopup = popupValue === 'menu' || popupValue === 'listbox' || popupValue === 'true';
        const controls = (node.getAttribute('aria-controls') || '').toLowerCase();
        const hasControls = ['menu', 'listbox', 'popup'].some((token) => controls.includes(token));
        return hasPopup || hasControls;
      };

      const menuAlreadyOpen = () => {
        const visibleMenus = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"]')).filter(isVisible);
        const labeledMenu = visibleMenus.some((menu) => {
          const text = menu.textContent || '';
          const aria = menu.getAttribute('aria-label') || '';
          return matchesLabel(text) || matchesLabel(aria);
        });
        if (labeledMenu) return true;
        const expanded = Array.from(document.querySelectorAll('[aria-expanded="true"]')).filter(isVisible);
        return expanded.some((node) => {
          if (!(node instanceof HTMLElement)) return false;
          const text = node.textContent || '';
          const aria = node.getAttribute('aria-label') || '';
          return isMenuTrigger(node) && (matchesLabel(text) || matchesLabel(aria));
        });
      };

      if (menuAlreadyOpen()) return true;

      const pickTarget = (root) => {
        const nodes = Array.from(root.querySelectorAll('button, [role="button"]')).filter(isInteractable);
        const matches = nodes.filter((node) => {
          const text = (node.textContent || '').trim().toLowerCase();
          const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
          if (!text && !aria) return false;
          return matchesLabel(text) || matchesLabel(aria);
        });
        if (matches.length === 0) return null;
        const menuMatches = matches.filter((node) => isMenuTrigger(node));
        return menuMatches[0] || matches[0];
      };

      let target = null;
      for (const root of roots) {
        target = pickTarget(root);
        if (target) break;
      }
      if (target instanceof HTMLElement) {
        target.click();
        return true;
      }
      return false;
    })()
  `;
}

function selectGeminiToolScript(labels: string[]): string {
  const labelsJson = JSON.stringify(labels);
  return `
    ((targetLabels) => {
      const isDisabled = (el) => {
        if (!(el instanceof HTMLElement)) return true;
        if ('disabled' in el && el.disabled) return true;
        if (el.hasAttribute('disabled')) return true;
        const ariaDisabled = (el.getAttribute('aria-disabled') || '').toLowerCase();
        return ariaDisabled === 'true';
      };

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = el.getAttribute('aria-hidden');
        if (ariaHidden && ariaHidden.toLowerCase() === 'true') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        if (style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const isInteractable = (el) => isVisible(el) && !isDisabled(el);

      const normalized = Array.isArray(targetLabels)
        ? targetLabels.map((label) => String(label || '').trim()).filter((label) => label)
        : [];
      const lowered = normalized.map((label) => label.toLowerCase());
      if (lowered.length === 0) return '';

      const menuSelectors = [
        '[role="menu"]',
        '[role="listbox"]',
        '[aria-label*="tool" i]',
        '[aria-label*="mode" i]',
        '[aria-modal="true"]',
      ];
      const menuRoots = Array.from(document.querySelectorAll(menuSelectors.join(','))).filter(isVisible);
      if (menuRoots.length === 0) return '';
      const seen = new Set();

      for (const root of menuRoots) {
        const candidates = Array.from(root.querySelectorAll('button, [role="menuitem"], [role="option"], [role="button"], a, li'));
        for (const node of candidates) {
          if (seen.has(node)) continue;
          seen.add(node);
          if (!isInteractable(node)) continue;
          const text = (node.textContent || '').trim().toLowerCase();
          const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
          if (!text && !aria) continue;
          const combined = \`\${text} \${aria}\`.trim();
          for (let index = 0; index < lowered.length; index += 1) {
            const label = lowered[index];
            if (label && combined.includes(label)) {
              if (node instanceof HTMLElement) node.click();
              return normalized[index];
            }
          }
        }
      }

      return '';
    })(${labelsJson})
  `;
}

function clickGeminiConfirmButtonScript(labels: string[]): string {
  const labelsJson = JSON.stringify(labels);
  return `
    ((targetLabels) => {
      const isDisabled = (el) => {
        if (!(el instanceof HTMLElement)) return true;
        if ('disabled' in el && el.disabled) return true;
        if (el.hasAttribute('disabled')) return true;
        const ariaDisabled = (el.getAttribute('aria-disabled') || '').toLowerCase();
        return ariaDisabled === 'true';
      };

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = el.getAttribute('aria-hidden');
        if (ariaHidden && ariaHidden.toLowerCase() === 'true') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        if (style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const isInteractable = (el) => isVisible(el) && !isDisabled(el);

      const normalized = Array.isArray(targetLabels)
        ? targetLabels.map((label) => String(label || '').trim()).filter((label) => label)
        : [];
      const lowered = normalized.map((label) => label.toLowerCase());
      if (lowered.length === 0) return '';

      const dialogRoots = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter(isVisible);
      const mainRoot = document.querySelector('main');
      const primaryRoots = [...dialogRoots, mainRoot].filter(Boolean).filter(isVisible);
      const rootGroups = primaryRoots.length > 0 ? [primaryRoots, [document]] : [[document]];
      const seen = new Set();

      for (const roots of rootGroups) {
        for (const root of roots) {
          const candidates = Array.from(root.querySelectorAll('button, [role="button"]'));
          for (const node of candidates) {
            if (seen.has(node)) continue;
            seen.add(node);
            if (!isInteractable(node)) continue;
            const text = (node.textContent || '').trim().toLowerCase();
            const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
            if (!text && !aria) continue;
            const combined = \`\${text} \${aria}\`.trim();
            for (let index = 0; index < lowered.length; index += 1) {
              const label = lowered[index];
              if (label && combined.includes(label)) {
                if (node instanceof HTMLElement) node.click();
                return normalized[index];
              }
            }
          }
        }
      }

      return '';
    })(${labelsJson})
  `;
}

function getGeminiConversationListScript(): string {
  return `
    (() => {
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const clampText = (value, maxLength) => {
        const normalized = normalizeText(value);
        if (!normalized) return '';
        if (normalized.length <= maxLength) return normalized;
        return normalized.slice(0, maxLength).trim();
      };

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = el.getAttribute('aria-hidden');
        if (ariaHidden && ariaHidden.toLowerCase() === 'true') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        if (style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const selector = 'a[href*="/app"]';
      const navRoots = Array.from(document.querySelectorAll('nav, aside, [role="navigation"]'));
      const rootsWithLinks = navRoots.filter((root) => root.querySelector(selector));
      const roots = rootsWithLinks.length > 0 ? rootsWithLinks : [document];

      const results = [];
      const seen = new Set();
      const maxLength = 200;

      for (const root of roots) {
        const anchors = Array.from(root.querySelectorAll(selector));
        for (const anchor of anchors) {
          if (!(anchor instanceof HTMLAnchorElement)) continue;
          if (!isVisible(anchor)) continue;
          const href = anchor.getAttribute('href') || '';
          if (!href) continue;
          let url = '';
          try {
            url = new URL(href, 'https://gemini.google.com').href;
          } catch {
            continue;
          }
          if (!url) continue;
          const title = clampText(anchor.textContent || anchor.getAttribute('aria-label') || '', maxLength);
          if (!title) continue;
          const key = url + '::' + title;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ title, url });
        }
      }

      return results;
    })()
  `;
}

function clickGeminiConversationByTitleScript(query: string): string {
  const normalizedQuery = normalizeGeminiTitle(query);
  return `
    ((targetQuery) => {
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const isDisabled = (el) => {
        if (!(el instanceof HTMLElement)) return true;
        if ('disabled' in el && el.disabled) return true;
        if (el.hasAttribute('disabled')) return true;
        const ariaDisabled = (el.getAttribute('aria-disabled') || '').toLowerCase();
        return ariaDisabled === 'true';
      };
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = (el.getAttribute('aria-hidden') || '').toLowerCase();
        if (ariaHidden === 'true' || el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0 || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const selector = 'nav a[href*="/app"], aside a[href*="/app"], [role="navigation"] a[href*="/app"], a[href*="/app"]';
      const anchors = Array.from(document.querySelectorAll(selector));

      for (const anchor of anchors) {
        if (!(anchor instanceof HTMLAnchorElement)) continue;
        if (!isVisible(anchor)) continue;
        if (isDisabled(anchor)) continue;
        const title = normalizeText(anchor.textContent || anchor.getAttribute('aria-label') || '');
        if (!title || !targetQuery) continue;
        if (!title.includes(targetQuery)) continue;
        anchor.click();
        return true;
      }
      return false;
    })(${JSON.stringify(normalizedQuery)})
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

export async function getCurrentGeminiUrl(page: IPage): Promise<string> {
  await ensureGeminiPage(page);
  const url = await page.evaluate(currentUrlScript()).catch(() => '');
  if (typeof url === 'string' && url.trim()) return url;
  return GEMINI_APP_URL;
}

export async function openGeminiToolsMenu(page: IPage): Promise<boolean> {
  await ensureGeminiPage(page);
  const opened = await page.evaluate(openGeminiToolsMenuScript()) as boolean;
  if (opened) {
    await page.wait(0.5);
    return true;
  }
  return false;
}

export async function selectGeminiTool(page: IPage, labels: string[]): Promise<string> {
  await ensureGeminiPage(page);
  await openGeminiToolsMenu(page);
  const matched = await page.evaluate(selectGeminiToolScript(labels)) as string;
  return typeof matched === 'string' ? matched : '';
}

export async function waitForGeminiConfirmButton(
  page: IPage,
  labels: string[],
  timeoutSeconds: number,
): Promise<string> {
  await ensureGeminiPage(page);
  const pollIntervalSeconds = 1;
  const maxPolls = Math.max(1, Math.ceil(timeoutSeconds / pollIntervalSeconds));

  for (let index = 0; index < maxPolls; index += 1) {
    await page.wait(index === 0 ? 0.5 : pollIntervalSeconds);
    const matched = await page.evaluate(clickGeminiConfirmButtonScript(labels)) as string;
    if (typeof matched === 'string' && matched) return matched;
  }

  return '';
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

export async function getGeminiConversationList(page: IPage): Promise<GeminiConversation[]> {
  await ensureGeminiPage(page);
  const raw = await page.evaluate(getGeminiConversationListScript()) as Array<{ title: string; url: string }>;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item.title === 'string' && typeof item.url === 'string')
    .map((item) => ({ Title: item.title, Url: item.url }));
}

export async function clickGeminiConversationByTitle(page: IPage, query: string): Promise<boolean> {
  await ensureGeminiPage(page);
  const normalizedQuery = normalizeGeminiTitle(query);
  if (!normalizedQuery) return false;
  const clicked = await page.evaluate(clickGeminiConversationByTitleScript(normalizedQuery)) as boolean;
  if (clicked) await page.wait(1);
  return !!clicked;
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

export async function waitForGeminiTranscript(page: IPage, attempts = 5): Promise<string[]> {
  let lines: string[] = [];
  for (let index = 0; index < attempts; index += 1) {
    lines = await getGeminiTranscriptLines(page);
    if (lines.length > 0) return lines;
    if (index < attempts - 1) await page.wait(1);
  }
  return lines;
}

export async function getLatestGeminiAssistantResponse(page: IPage): Promise<string> {
  await ensureGeminiPage(page);
  const turns = await getGeminiVisibleTurns(page);
  const assistantTurn = [...turns].reverse().find((turn) => turn.Role === 'Assistant');
  if (assistantTurn?.Text) {
    return sanitizeGeminiResponseText(assistantTurn.Text, '');
  }
  const lines = await getGeminiTranscriptLines(page);
  return lines.join('\n').trim();
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

    // Transcript-only growth is noisy on /app root. When URL is available,
    // trust this signal only after Gemini has navigated into a concrete
    // conversation URL. (Keep backwards compatibility for mocked snapshots
    // that don't carry url.)
    const transcriptSubmissionAllowed = !current.url || isGeminiConversationUrl(String(current.url));
    if (!current.composerHasText && transcriptDelta.length > 0 && transcriptSubmissionAllowed) {
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

export interface GeminiDeepResearchExportResult {
  url: string;
  source: 'network' | 'window-open' | 'anchor' | 'performance' | 'blob' | 'tab' | 'none';
}

function normalizeGeminiExportUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of value) {
    const raw = String(item ?? '').trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    urls.push(raw);
  }
  return urls;
}

export function pickGeminiDeepResearchExportUrl(rawUrls: string[], currentUrl: string): GeminiDeepResearchExportResult {
  let bestScore = -Infinity;
  let bestUrl = '';
  let bestSource: GeminiDeepResearchExportResult['source'] = 'none';

  const sourceWeight: Record<string, number> = {
    fetch: 50,
    xhr: 45,
    'fetch-body': 72,
    'xhr-body': 72,
    'fetch-body-docs-id': 95,
    'xhr-body-docs-id': 95,
    open: 55,
    anchor: 55,
    performance: 35,
  };

  for (const rawEntry of rawUrls) {
    const match = rawEntry.match(/^([a-z-]+)::(.+)$/i);
    const sourceKey = (match?.[1] ?? 'performance').toLowerCase();
    const rawUrl = (match?.[2] ?? rawEntry).trim();
    if (!rawUrl) continue;

    let parsedUrl = rawUrl;
    let isBlob = false;

    if (rawUrl.startsWith('blob:')) {
      isBlob = true;
    } else {
      try {
        parsedUrl = new URL(rawUrl, currentUrl).href;
      } catch {
        continue;
      }
    }

    if (!isBlob) {
      try {
        const parsed = new URL(parsedUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      } catch {
        continue;
      }
    }

    const hasMarkdownSignal = /\.md(?:$|[?#])/i.test(parsedUrl) || /markdown/i.test(parsedUrl);
    const hasExportSignal = /export|download|attachment|file|save-report/i.test(parsedUrl);
    const isGoogleDocUrl = /docs\.google\.com\/document\//i.test(parsedUrl);
    const isGoogleSheetUrl = /docs\.google\.com\/spreadsheets\//i.test(parsedUrl);
    const isNoiseEndpoint = /cspreport|allowlist|gen_204|telemetry|metrics|analytics|doubleclick|logging|collect|favicon/i.test(parsedUrl);

    let score = sourceWeight[sourceKey] ?? 20;
    if (hasMarkdownSignal) score += 45;
    if (hasExportSignal) score += 25;
    if (isGoogleDocUrl) score += 100;
    if (isGoogleSheetUrl) score -= 160;
    if (/gemini\.google\.com\/app\//i.test(parsedUrl)) score -= 60;
    if (/googleapis\.com|gstatic\.com|doubleclick\.net|google-analytics/i.test(parsedUrl)) score -= 40;
    if (!hasMarkdownSignal && !hasExportSignal && !isBlob) score -= 40;
    if (isNoiseEndpoint) score -= 120;
    if (parsedUrl === currentUrl) score -= 80;
    if (isBlob) score += 25;

    if (score > bestScore) {
      bestScore = score;
      bestUrl = parsedUrl;
      if (isBlob) bestSource = 'blob';
      else if (sourceKey === 'open') bestSource = 'window-open';
      else if (sourceKey === 'anchor') bestSource = 'anchor';
      else if (sourceKey === 'performance') bestSource = 'performance';
      else bestSource = 'network';
    }
  }

  if (!bestUrl || bestScore < 60) {
    return { url: '', source: 'none' };
  }
  return { url: bestUrl, source: bestSource };
}

function exportGeminiDeepResearchReportScript(maxWaitMs: number): string {
  return `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const labels = {
        actionMenu: ['open menu for conversation actions', 'conversation actions', '会话操作'],
        share: ['share & export', 'share and export', 'share/export', '分享与导出', '分享和导出', '分享并导出', '共享和导出'],
        shareConversation: ['share conversation', '分享会话', '分享对话'],
        export: ['export', '导出'],
        exportDocs: ['export to docs', 'export to google docs', 'export to doc', '导出到 docs', '导出到文档', '导出到 google docs'],
      };

      const recorderKey = '__opencliGeminiExportUrls';
      const patchedKey = '__opencliGeminiExportPatched';
      const trace = [];
      const tracePush = (step, detail = '') => {
        const entry = detail ? step + ':' + detail : step;
        trace.push(entry);
        if (trace.length > 80) trace.shift();
      };

      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const normalizeLabels = (values) => {
        if (!Array.isArray(values)) return [];
        return values.map((value) => normalize(value)).filter(Boolean);
      };
      const includesAny = (value, candidates) => {
        const text = normalize(value);
        if (!text) return false;
        return candidates.some((candidate) => text.includes(candidate));
      };
      const labelsNormalized = {
        actionMenu: normalizeLabels(labels.actionMenu),
        share: normalizeLabels(labels.share),
        shareConversation: normalizeLabels(labels.shareConversation),
        export: normalizeLabels(labels.export),
        exportDocs: normalizeLabels(labels.exportDocs),
      };

      const queryAllDeep = (roots, selector) => {
        const seed = Array.isArray(roots) && roots.length > 0 ? roots : [document];
        const seenScopes = new Set();
        const seenElements = new Set();
        const out = [];
        const queue = [...seed];
        while (queue.length > 0) {
          const scope = queue.shift();
          const isValidScope = scope === document
            || scope instanceof Document
            || scope instanceof Element
            || scope instanceof ShadowRoot;
          if (!isValidScope || seenScopes.has(scope)) continue;
          seenScopes.add(scope);

          let nodes = [];
          try {
            nodes = Array.from(scope.querySelectorAll(selector));
          } catch {}

          for (const node of nodes) {
            if (!(node instanceof Element)) continue;
            if (!seenElements.has(node)) {
              seenElements.add(node);
              out.push(node);
            }
            if (node.shadowRoot) queue.push(node.shadowRoot);
          }

          let descendants = [];
          try {
            descendants = Array.from(scope.querySelectorAll('*'));
          } catch {}
          for (const child of descendants) {
            if (child instanceof Element && child.shadowRoot) queue.push(child.shadowRoot);
          }
        }
        return out;
      };

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = (el.getAttribute('aria-hidden') || '').toLowerCase();
        if (ariaHidden === 'true' || el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0 || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const isDisabled = (el) => {
        if (!(el instanceof HTMLElement)) return true;
        if ('disabled' in el && el.disabled) return true;
        if (el.hasAttribute('disabled')) return true;
        return (el.getAttribute('aria-disabled') || '').toLowerCase() === 'true';
      };
      const isInteractable = (el) => isVisible(el) && !isDisabled(el);
      const textOf = (node) => [
        node?.textContent || '',
        node instanceof HTMLElement ? (node.innerText || '') : '',
        node?.getAttribute?.('aria-label') || '',
        node?.getAttribute?.('title') || '',
        node?.getAttribute?.('data-tooltip') || '',
        node?.getAttribute?.('mattooltip') || '',
      ].join(' ');
      const hasTokens = (value, tokens) => {
        const normalized = normalize(value);
        if (!normalized) return false;
        return tokens.every((token) => normalized.includes(token));
      };
      const isKindMatch = (kind, combined, targetLabels) => {
        if (includesAny(combined, targetLabels)) return true;
        if (kind === 'share') return hasTokens(combined, ['share', 'export']) || hasTokens(combined, ['分享', '导出']);
        if (kind === 'export') return hasTokens(combined, ['export']) || hasTokens(combined, ['导出']);
        if (kind === 'export-docs') {
          return hasTokens(combined, ['export', 'docs'])
            || hasTokens(combined, ['导出', '文档'])
            || hasTokens(combined, ['导出', 'docs']);
        }
        if (kind === 'action-menu') {
          return hasTokens(combined, ['conversation', 'action']) || hasTokens(combined, ['会话', '操作']);
        }
        return false;
      };
      const triggerClick = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        try { node.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
        try { node.focus({ preventScroll: true }); } catch {}
        try {
          const EventCtor = window.PointerEvent || window.MouseEvent;
          node.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
        } catch {}
        try { node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button: 0 })); } catch {}
        try { node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, button: 0 })); } catch {}
        try { node.click(); } catch { return false; }
        return true;
      };

      const ensureRecorder = () => {
        if (!Array.isArray(window[recorderKey])) window[recorderKey] = [];
        const push = (prefix, raw) => {
          const url = String(raw || '').trim();
          if (!url) return;
          window[recorderKey].push(prefix + '::' + url);
        };
        const extractUrlsFromText = (rawText) => {
          const text = String(rawText || '');
          const urls = [];
          const direct = text.match(/https?:\\/\\/[^\\s"'<>\\\\]+/g) || [];
          urls.push(...direct);
          const escaped = text.match(/https?:\\\\\\/\\\\\\/[^\\s"'<>]+/g) || [];
          for (const item of escaped) {
            urls.push(
              item
                .split('\\\\/').join('/')
                .split('\\\\u003d').join('=')
                .split('\\\\u0026').join('&'),
            );
          }
          return Array.from(new Set(urls.map((value) => String(value || '').trim()).filter(Boolean)));
        };
        const extractDocsIdsFromText = (rawText) => {
          const text = String(rawText || '');
          const ids = [];
          const patterns = [
            /"id"\\s*:\\s*"([a-zA-Z0-9_-]{15,})"/g,
            /'id'\\s*:\\s*'([a-zA-Z0-9_-]{15,})'/g,
          ];
          for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
              const docId = String(match[1] || '').trim();
              if (docId) ids.push(docId);
            }
          }
          return Array.from(new Set(ids));
        };
        const docsUrlFromId = (id) => {
          const docId = String(id || '').trim();
          if (!/^[a-zA-Z0-9_-]{15,}$/.test(docId)) return '';
          return 'https://docs.google.com/document/d/' + docId + '/edit';
        };
        const isDriveDocCreateRequest = (url) => /\\/upload\\/drive\\/v3\\/files/i.test(String(url || ''));

        if (window[patchedKey]) return push;
        window[patchedKey] = true;

        const originalFetch = window.fetch.bind(window);
        window.fetch = (...args) => {
          let reqUrl = '';
          try {
            const input = args[0];
            reqUrl = typeof input === 'string' ? input : (input && input.url) || '';
            push('fetch', reqUrl);
          } catch {}
          return originalFetch(...args).then((response) => {
            try {
              response.clone().text().then((text) => {
                const embeddedUrls = extractUrlsFromText(text);
                for (const embeddedUrl of embeddedUrls) push('fetch-body', embeddedUrl);
                if (isDriveDocCreateRequest(reqUrl)) {
                  const docIds = extractDocsIdsFromText(text);
                  for (const docId of docIds) {
                    const docUrl = docsUrlFromId(docId);
                    if (docUrl) push('fetch-body-docs-id', docUrl);
                  }
                }
              }).catch(() => {});
            } catch {}
            return response;
          });
        };

        const originalXhrOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          try { push('xhr', url); } catch {}
          try { this.__opencliReqUrl = String(url || ''); } catch {}
          return originalXhrOpen.call(this, method, url, ...rest);
        };
        const originalXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
          try {
            this.addEventListener('load', () => {
              try {
                const embeddedUrls = extractUrlsFromText(this.responseText || '');
                for (const embeddedUrl of embeddedUrls) push('xhr-body', embeddedUrl);
                const reqUrl = String(this.__opencliReqUrl || '');
                if (isDriveDocCreateRequest(reqUrl)) {
                  const docIds = extractDocsIdsFromText(this.responseText || '');
                  for (const docId of docIds) {
                    const docUrl = docsUrlFromId(docId);
                    if (docUrl) push('xhr-body-docs-id', docUrl);
                  }
                }
              } catch {}
            });
          } catch {}
          return originalXhrSend.apply(this, args);
        };

        const originalOpen = window.open.bind(window);
        window.open = (...args) => {
          try { push('open', args[0]); } catch {}
          return originalOpen(...args);
        };

        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function(...args) {
          try { push('anchor', this.href || this.getAttribute('href')); } catch {}
          return originalAnchorClick.apply(this, args);
        };

        return push;
      };

      const pushUrl = ensureRecorder();
      const collectUrls = () => {
        try {
          const entries = performance.getEntriesByType('resource');
          for (const entry of entries) {
            if (!entry || !entry.name) continue;
            pushUrl('performance', entry.name);
          }
        } catch {}
        try {
          const anchors = queryAllDeep([document], 'a[href]');
          for (const anchor of anchors) {
            const href = anchor.getAttribute('href') || '';
            if (!href) continue;
            if (/docs\\.google\\.com\\/document\\//i.test(href)) pushUrl('anchor', href);
          }
        } catch {}
        const all = Array.isArray(window[recorderKey]) ? window[recorderKey] : [];
        return Array.from(new Set(all.map((value) => String(value || '').trim()).filter(Boolean)));
      };

      const clickByLabels = (kind, targetLabels, roots) => {
        const allRoots = Array.isArray(roots) && roots.length > 0 ? roots : [document];
        const selector = 'button, [role="button"], [role="menuitem"], [role="option"], a, li';

        for (const root of allRoots) {
          if (!(root instanceof Document || root instanceof Element)) continue;
          let nodes = [];
          try {
            nodes = Array.from(root.querySelectorAll(selector));
          } catch {
            continue;
          }

          for (const node of nodes) {
            if (!isInteractable(node)) continue;
            const combined = normalize(textOf(node));
            if (!combined) continue;
            if (!isKindMatch(kind, combined, targetLabels)) continue;
            if (triggerClick(node)) {
              const clickedText = (textOf(node) || targetLabels[0] || '').trim();
              tracePush('clicked', kind + '|' + clickedText.slice(0, 120));
              return clickedText;
            }
          }
        }
        tracePush('miss', kind);
        return '';
      };

      const getDialogRoots = () =>
        queryAllDeep([document], '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"]')
          .filter((node) => isVisible(node));
      const buildRoots = () => {
        const dialogRoots = getDialogRoots();
        if (dialogRoots.length > 0) return [...dialogRoots, document];
        return [document];
      };
      const clickWithRetry = async (kind, targetLabels, attempts, delayMs, includeDialogs = true) => {
        for (let index = 0; index < attempts; index += 1) {
          const roots = includeDialogs ? buildRoots() : [document];
          const clicked = clickByLabels(kind, targetLabels, roots);
          if (clicked) return clicked;
          await sleep(delayMs);
        }
        return '';
      };

      tracePush('start', window.location.href);
      let exportDocsBtn = await clickWithRetry('export-docs', labelsNormalized.exportDocs, 2, 250, true);
      let share = '';
      if (!exportDocsBtn) {
        share = await clickWithRetry('share', labelsNormalized.share, 4, 280, true);
      }
      if (!exportDocsBtn && !share) {
        await clickWithRetry('action-menu', labelsNormalized.actionMenu, 2, 250, false);
        await clickWithRetry('share-conversation', labelsNormalized.shareConversation, 2, 250, true);
        share = await clickWithRetry('share', labelsNormalized.share, 4, 280, true);
      }
      if (!exportDocsBtn) {
        await sleep(350);
        exportDocsBtn = await clickWithRetry('export-docs', labelsNormalized.exportDocs, 8, 280, true);
      }
      if (!exportDocsBtn) {
        const exportEntry = await clickWithRetry('export', labelsNormalized.export, 2, 220, true);
        if (exportEntry) {
          await sleep(240);
          exportDocsBtn = await clickWithRetry('export-docs', labelsNormalized.exportDocs, 6, 280, true);
        }
      }

      if (!share && !exportDocsBtn) {
        return { ok: false, step: 'share', currentUrl: window.location.href, trace, urls: collectUrls() };
      }
      if (!exportDocsBtn) {
        return { ok: false, step: 'export-docs', currentUrl: window.location.href, share, trace, urls: collectUrls() };
      }

      const deadline = Date.now() + ${Math.max(5000, Math.min(maxWaitMs, 180000))};
      while (Date.now() < deadline) {
        const urls = collectUrls();
        const hasDocsSignal = urls.some((value) => /docs\\.google\\.com\\/document\\//i.test(String(value || '')));
        const sameTabDocs = /docs\\.google\\.com\\/document\\//i.test(window.location.href || '');
        if (hasDocsSignal) {
          return { ok: true, step: 'done', currentUrl: window.location.href, share, exportDocs: exportDocsBtn, trace, urls };
        }
        if (sameTabDocs) {
          urls.push('open::' + window.location.href);
          return { ok: true, step: 'same-tab-docs', currentUrl: window.location.href, share, exportDocs: exportDocsBtn, trace, urls };
        }
        await sleep(300);
      }

      return { ok: true, step: 'timeout', currentUrl: window.location.href, share, exportDocs: exportDocsBtn, trace, urls: collectUrls() };
    })()
  `;
}

function extractDocsUrlFromTabs(tabs: unknown): string {
  if (!Array.isArray(tabs)) return '';
  for (const tab of tabs) {
    if (!tab || typeof tab !== 'object') continue;
    const url = String((tab as Record<string, unknown>).url ?? '').trim();
    if (/^https:\/\/docs\.google\.com\/document\//i.test(url)) return url;
  }
  return '';
}

export async function exportGeminiDeepResearchReport(
  page: IPage,
  timeoutSeconds: number = 120,
): Promise<GeminiDeepResearchExportResult> {
  await ensureGeminiPage(page);
  const timeoutMs = Math.max(1, timeoutSeconds) * 1000;
  const tabsBefore = await page.tabs().catch(() => []);
  const exportScript = exportGeminiDeepResearchReportScript(timeoutMs);

  const raw = await page.evaluate(exportScript).catch(() => null) as {
    urls?: unknown;
    currentUrl?: unknown;
  } | null;

  const tabsAfter = await page.tabs().catch(() => []);
  const docsUrlFromTabs = extractDocsUrlFromTabs(tabsAfter) || extractDocsUrlFromTabs(tabsBefore);
  if (docsUrlFromTabs) {
    return { url: docsUrlFromTabs, source: 'tab' };
  }

  const docsUrlFromCurrent = typeof raw?.currentUrl === 'string' && /^https:\/\/docs\.google\.com\/document\//i.test(raw.currentUrl)
    ? raw.currentUrl
    : '';
  if (docsUrlFromCurrent) {
    return { url: docsUrlFromCurrent, source: 'window-open' };
  }

  const urls = normalizeGeminiExportUrls(raw?.urls);
  const currentUrl = typeof raw?.currentUrl === 'string' && raw.currentUrl
    ? raw.currentUrl
    : await getCurrentGeminiUrl(page);

  return pickGeminiDeepResearchExportUrl(urls, currentUrl);
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
