import { CommandExecutionError } from '@jackwener/opencli/errors';
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
function isObjectRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function unwrapGeminiEvaluateResult(value, context) {
    if (isObjectRecord(value) && Object.prototype.hasOwnProperty.call(value, 'session')) {
        if (Object.prototype.hasOwnProperty.call(value, 'data')) {
            return value.data;
        }
        throw new CommandExecutionError(`${context} returned a malformed Browser Bridge envelope`);
    }
    return value;
}
function requireGeminiArrayResult(value, context) {
    const unwrapped = unwrapGeminiEvaluateResult(value, context);
    if (!Array.isArray(unwrapped)) {
        throw new CommandExecutionError(`${context} returned a malformed result`);
    }
    return unwrapped;
}
function requireGeminiObjectResult(value, context) {
    const unwrapped = unwrapGeminiEvaluateResult(value, context);
    if (!isObjectRecord(unwrapped)) {
        throw new CommandExecutionError(`${context} returned a malformed result`);
    }
    return unwrapped;
}
function buildGeminiComposerLocatorScript() {
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
export function resolveGeminiLabels(value, fallback) {
    const label = String(value ?? '').trim();
    return label ? [label] : fallback;
}
export function parseGeminiTitleMatchMode(value, fallback = 'contains') {
    const raw = String(value ?? fallback).trim().toLowerCase();
    if (raw === 'contains' || raw === 'exact')
        return raw;
    return null;
}
export function parseGeminiConversationUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw)
        return null;
    try {
        const url = new URL(raw);
        if (url.hostname !== GEMINI_DOMAIN && !url.hostname.endsWith(`.${GEMINI_DOMAIN}`))
            return null;
        if (!url.pathname.startsWith('/app/'))
            return null;
        return url.href;
    }
    catch {
        return null;
    }
}
export function normalizeGeminiTitle(value) {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
}
export function pickGeminiConversationByTitle(conversations, query, mode = 'contains') {
    const normalizedQuery = normalizeGeminiTitle(query);
    if (!normalizedQuery)
        return null;
    for (const conversation of conversations) {
        const normalizedTitle = normalizeGeminiTitle(conversation.Title);
        if (!normalizedTitle)
            continue;
        if (mode === 'exact') {
            if (normalizedTitle === normalizedQuery)
                return conversation;
            continue;
        }
        if (normalizedTitle.includes(normalizedQuery))
            return conversation;
    }
    return null;
}
export function resolveGeminiConversationForQuery(conversations, query, mode) {
    const normalizedQuery = String(query ?? '').trim();
    if (!normalizedQuery)
        return conversations[0] ?? null;
    const exact = pickGeminiConversationByTitle(conversations, normalizedQuery, 'exact');
    if (exact)
        return exact;
    if (mode === 'contains')
        return pickGeminiConversationByTitle(conversations, normalizedQuery, 'contains');
    return null;
}
export function sanitizeGeminiResponseText(value, promptText) {
    let sanitized = value;
    for (const pattern of GEMINI_RESPONSE_NOISE_PATTERNS) {
        sanitized = sanitized.replace(pattern, '');
    }
    sanitized = sanitized.trim();
    const prompt = promptText.trim();
    if (!prompt)
        return sanitized;
    if (sanitized === prompt)
        return '';
    for (const separator of ['\n\n', '\n', '\r\n\r\n', '\r\n']) {
        const prefix = `${prompt}${separator}`;
        if (sanitized.startsWith(prefix)) {
            return sanitized.slice(prefix.length).trim();
        }
    }
    return sanitized;
}
export function collectGeminiTranscriptAdditions(beforeLines, currentLines, promptText) {
    const beforeSet = new Set(beforeLines);
    const additions = currentLines
        .filter((line) => !beforeSet.has(line))
        .map((line) => extractGeminiTranscriptLineCandidate(line, promptText))
        .filter((line) => line && line !== promptText);
    return additions.join('\n').trim();
}
export function collapseAdjacentGeminiTurns(turns) {
    const collapsed = [];
    for (const turn of turns) {
        if (!turn || typeof turn.Role !== 'string' || typeof turn.Text !== 'string')
            continue;
        const previous = collapsed.at(-1);
        if (previous?.Role === turn.Role && previous.Text === turn.Text)
            continue;
        collapsed.push(turn);
    }
    return collapsed;
}
function hasGeminiTurnPrefix(before, current) {
    if (before.length > current.length)
        return false;
    return before.every((turn, index) => (turn.Role === current[index]?.Role
        && turn.Text === current[index]?.Text));
}
function findLastMatchingGeminiTurnIndex(turns, target) {
    if (!target)
        return null;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
        const turn = turns[index];
        if (turn?.Role === target.Role && turn.Text === target.Text) {
            return index;
        }
    }
    return null;
}
function diffTrustedStructuredTurns(before, current) {
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
function diffTranscriptLines(before, current) {
    const beforeLines = new Set(before.transcriptLines);
    return current.transcriptLines.filter((line) => !beforeLines.has(line));
}
function isLikelyGeminiTranscriptChrome(line) {
    const lower = line.toLowerCase();
    const markerHits = GEMINI_TRANSCRIPT_CHROME_MARKERS.filter((marker) => lower.includes(marker)).length;
    return markerHits >= 2;
}
function extractGeminiTranscriptLineCandidate(transcriptLine, promptText) {
    const candidate = transcriptLine.trim();
    if (!candidate)
        return '';
    const prompt = promptText.trim();
    const sanitized = sanitizeGeminiResponseText(candidate, promptText);
    if (!prompt)
        return sanitized;
    if (!candidate.includes(prompt))
        return sanitized;
    if (sanitized && sanitized !== prompt && sanitized !== candidate)
        return sanitized;
    if (isLikelyGeminiTranscriptChrome(candidate))
        return '';
    // Some transcript snapshots flatten "prompt + answer" into a single line.
    // Recover the answer only when the line starts with the current prompt.
    if (candidate.startsWith(prompt)) {
        const tail = candidate.slice(prompt.length).replace(/^[\s:：,，-]+/, '').trim();
        return tail ? sanitizeGeminiResponseText(tail, '') : '';
    }
    return sanitized;
}
function getStateScript() {
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
function readGeminiSnapshotScript() {
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
function isGeminiConversationUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== GEMINI_DOMAIN && !parsed.hostname.endsWith(`.${GEMINI_DOMAIN}`))
            return false;
        const pathname = parsed.pathname.replace(/\/+$/, '');
        return pathname.startsWith('/app/') && pathname !== '/app';
    }
    catch {
        return false;
    }
}
function getTranscriptLinesScript() {
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
function prepareComposerScript() {
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
function composerHasTextScript() {
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
function insertComposerTextFallbackScript(text) {
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
function submitComposerScript() {
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
      const submitPattern = /send|发送|傳送|submit|提交/i;
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
function dispatchComposerEnterScript() {
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
function openGeminiToolsMenuScript() {
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
function selectGeminiToolScript(labels) {
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
function clickGeminiConfirmButtonScript(labels) {
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
function getGeminiConversationListScript() {
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

// Gemini collapses the sidebar's "最近" / "Recents" section by default, so the
// /app/<id> conversation anchors are not present in the DOM (or are hidden)
// until that section is expanded. The script below opens the sidebar if it is
// collapsed and expands the Recents toggle, returning true if it likely
// changed the DOM and the caller should retry extraction.
function expandGeminiRecentScript() {
    return `
    (() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = (el.getAttribute('aria-hidden') || '').toLowerCase();
        if (ariaHidden === 'true' || el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      let changed = false;
      const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);

      // 1. Open the sidebar if it is collapsed (button only renders when closed).
      const openSidebar = buttons.find((b) => {
        const label = normalize(b.getAttribute('aria-label') || '');
        return /打开边栏|open sidebar|open navigation|展开边栏/i.test(label);
      });
      if (openSidebar) { openSidebar.click(); changed = true; }

      // 2. Expand the "最近" / "Recents" toggle if it is currently collapsed.
      const recentToggle = buttons.find((b) => {
        const label = normalize(b.getAttribute('aria-label') || '');
        const expanded = (b.getAttribute('aria-expanded') || '').toLowerCase();
        return /最近|recent/i.test(label) && (
          /展开|收起|expand|collapse|toggle|show|hide/i.test(label)
          || expanded === 'false'
          || expanded === 'true'
        );
      });
      if (recentToggle) {
        const label = normalize(recentToggle.getAttribute('aria-label') || '');
        const expanded = (recentToggle.getAttribute('aria-expanded') || '').toLowerCase();
        const explicitExpandLabel = /展开|显示|expand|show/i.test(label) && !/收起|collapse|hide/i.test(label);
        if (expanded === 'false' || (expanded !== 'true' && explicitExpandLabel)) {
          recentToggle.click();
          changed = true;
        }
      }

      return changed;
    })()
  `;
}
function clickGeminiConversationByTitleScript(query) {
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
function currentUrlScript() {
    return 'window.location.href';
}
export async function isOnGemini(page) {
    const url = await page.evaluate(currentUrlScript()).catch(() => '');
    if (typeof url !== 'string' || !url)
        return false;
    try {
        const hostname = new URL(url).hostname;
        return hostname === GEMINI_DOMAIN || hostname.endsWith(`.${GEMINI_DOMAIN}`);
    }
    catch {
        return false;
    }
}
export async function ensureGeminiPage(page) {
    if (!(await isOnGemini(page))) {
        await page.goto(GEMINI_APP_URL, { waitUntil: 'load', settleMs: 2500 });
        await page.wait(1);
    }
}
export async function getCurrentGeminiUrl(page) {
    await ensureGeminiPage(page);
    const url = await page.evaluate(currentUrlScript()).catch(() => '');
    if (typeof url === 'string' && url.trim())
        return url;
    return GEMINI_APP_URL;
}
export async function openGeminiToolsMenu(page) {
    await ensureGeminiPage(page);
    const opened = await page.evaluate(openGeminiToolsMenuScript());
    if (opened) {
        await page.wait(0.5);
        return true;
    }
    return false;
}
export async function selectGeminiTool(page, labels) {
    await ensureGeminiPage(page);
    await openGeminiToolsMenu(page);
    const matched = await page.evaluate(selectGeminiToolScript(labels));
    return typeof matched === 'string' ? matched : '';
}
export async function waitForGeminiConfirmButton(page, labels, timeoutSeconds) {
    await ensureGeminiPage(page);
    const pollIntervalSeconds = 1;
    const maxPolls = Math.max(1, Math.ceil(timeoutSeconds / pollIntervalSeconds));
    for (let index = 0; index < maxPolls; index += 1) {
        await page.wait(index === 0 ? 0.5 : pollIntervalSeconds);
        const matched = await page.evaluate(clickGeminiConfirmButtonScript(labels));
        if (typeof matched === 'string' && matched)
            return matched;
    }
    return '';
}
export async function getGeminiPageState(page) {
    await ensureGeminiPage(page);
    return requireGeminiObjectResult(await page.evaluate(getStateScript()), 'Gemini status');
}
export async function startNewGeminiChat(page) {
    await ensureGeminiPage(page);
    const action = await page.evaluate(clickNewChatScript());
    if (action === 'navigate') {
        await page.goto(GEMINI_APP_URL, { waitUntil: 'load', settleMs: 2500 });
    }
    await page.wait(1);
    return action;
}
export async function getGeminiConversationList(page) {
    await ensureGeminiPage(page);
    let rows = [];
    // Gemini collapses the sidebar "最近"/Recents section by default, hiding
    // the conversation anchors. Retry extraction after expanding it.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const raw = requireGeminiArrayResult(await page.evaluate(getGeminiConversationListScript()), 'Gemini conversation list');
        rows = raw.flatMap((item) => {
            if (!isObjectRecord(item) || typeof item.title !== 'string' || typeof item.url !== 'string') {
                throw new CommandExecutionError('Gemini conversation list returned a malformed row');
            }
            if (!isGeminiConversationUrl(item.url))
                return [];
            return { Title: item.title, Url: item.url };
        });
        if (rows.length > 0)
            break;
        const changedRaw = unwrapGeminiEvaluateResult(await page.evaluate(expandGeminiRecentScript()), 'Gemini sidebar expand');
        const changed = changedRaw === true;
        // Give the React sidebar a moment to render the expanded anchors,
        // longer on the first expansion (sidebar slide-in is async).
        await page.wait(attempt === 0 ? 1.2 : 0.6);
        if (!changed && attempt > 0)
            break;
    }
    return rows;
}
export async function clickGeminiConversationByTitle(page, query) {
    await ensureGeminiPage(page);
    const normalizedQuery = normalizeGeminiTitle(query);
    if (!normalizedQuery)
        return false;
    const clicked = await page.evaluate(clickGeminiConversationByTitleScript(normalizedQuery));
    if (clicked)
        await page.wait(1);
    return !!clicked;
}
export async function getGeminiVisibleTurns(page) {
    const turns = await getGeminiStructuredTurns(page);
    if (Array.isArray(turns) && turns.length > 0)
        return turns;
    const lines = await getGeminiTranscriptLines(page);
    return lines.map((line) => ({ Role: 'System', Text: line }));
}
async function getGeminiStructuredTurns(page) {
    await ensureGeminiPage(page);
    const raw = requireGeminiArrayResult(await page.evaluate(getTurnsScript()), 'Gemini visible turns');
    for (const turn of raw) {
        if (!isObjectRecord(turn) || typeof turn.Role !== 'string' || typeof turn.Text !== 'string') {
            throw new CommandExecutionError('Gemini visible turns returned a malformed row');
        }
    }
    const turns = collapseAdjacentGeminiTurns(raw);
    return Array.isArray(turns) ? turns : [];
}
export async function getGeminiTranscriptLines(page) {
    await ensureGeminiPage(page);
    const lines = requireGeminiArrayResult(await page.evaluate(getTranscriptLinesScript()), 'Gemini transcript lines');
    if (!lines.every((line) => typeof line === 'string')) {
        throw new CommandExecutionError('Gemini transcript lines returned a malformed row');
    }
    return lines;
}
export async function waitForGeminiTranscript(page, attempts = 5) {
    let lines = [];
    for (let index = 0; index < attempts; index += 1) {
        lines = await getGeminiTranscriptLines(page);
        if (lines.length > 0)
            return lines;
        if (index < attempts - 1)
            await page.wait(1);
    }
    return lines;
}
export async function getLatestGeminiAssistantResponse(page) {
    await ensureGeminiPage(page);
    const turns = await getGeminiVisibleTurns(page);
    const assistantTurn = [...turns].reverse().find((turn) => turn.Role === 'Assistant');
    if (assistantTurn?.Text) {
        return sanitizeGeminiResponseText(assistantTurn.Text, '');
    }
    const lines = await getGeminiTranscriptLines(page);
    return lines.join('\n').trim();
}
export async function readGeminiSnapshot(page) {
    await ensureGeminiPage(page);
    const snapshot = requireGeminiObjectResult(await page.evaluate(readGeminiSnapshotScript()), 'Gemini page snapshot');
    if (!Array.isArray(snapshot.turns) ||
        !Array.isArray(snapshot.transcriptLines) ||
        typeof snapshot.composerHasText !== 'boolean' ||
        typeof snapshot.isGenerating !== 'boolean' ||
        typeof snapshot.structuredTurnsTrusted !== 'boolean') {
        throw new CommandExecutionError('Gemini page snapshot returned a malformed result');
    }
    return snapshot;
}
function findLastUserTurnIndex(turns) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
        if (turns[index]?.Role === 'User')
            return index;
    }
    return null;
}
function findLastUserTurn(turns) {
    const index = findLastUserTurnIndex(turns);
    return index === null ? null : turns[index] ?? null;
}
export async function waitForGeminiSubmission(page, before, timeoutSeconds) {
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
export async function sendGeminiMessage(page, text) {
    await ensureGeminiPage(page);
    let prepared;
    for (let attempt = 0; attempt < GEMINI_COMPOSER_PREPARE_ATTEMPTS; attempt += 1) {
        prepared = await page.evaluate(prepareComposerScript());
        if (prepared?.ok)
            break;
        if (attempt < GEMINI_COMPOSER_PREPARE_ATTEMPTS - 1)
            await page.wait(GEMINI_COMPOSER_PREPARE_WAIT_SECONDS);
    }
    if (!prepared?.ok) {
        throw new CommandExecutionError(prepared?.reason || 'Could not find Gemini composer');
    }
    let hasText = false;
    if (page.nativeType) {
        try {
            await page.nativeType(text);
            await page.wait(0.2);
            const nativeState = await page.evaluate(composerHasTextScript());
            hasText = !!nativeState?.hasText;
        }
        catch { }
    }
    if (!hasText) {
        const fallbackState = await page.evaluate(insertComposerTextFallbackScript(text));
        hasText = !!fallbackState?.hasText;
    }
    if (!hasText) {
        throw new CommandExecutionError('Failed to insert text into Gemini composer');
    }
    const submitAction = await page.evaluate(submitComposerScript());
    if (submitAction === 'button') {
        await page.wait(1);
        return 'button';
    }
    if (page.nativeKeyPress) {
        try {
            await page.nativeKeyPress('Enter');
        }
        catch {
            await page.evaluate(dispatchComposerEnterScript());
        }
    }
    else {
        await page.evaluate(dispatchComposerEnterScript());
    }
    await page.wait(1);
    return 'enter';
}
function normalizeGeminiExportUrls(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const urls = [];
    for (const item of value) {
        const raw = String(item ?? '').trim();
        if (!raw || seen.has(raw))
            continue;
        seen.add(raw);
        urls.push(raw);
    }
    return urls;
}
export function pickGeminiDeepResearchExportUrl(rawUrls, currentUrl) {
    let bestScore = -Infinity;
    let bestUrl = '';
    let bestSource = 'none';
    const sourceWeight = {
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
        if (!rawUrl)
            continue;
        let parsedUrl = rawUrl;
        let isBlob = false;
        if (rawUrl.startsWith('blob:')) {
            isBlob = true;
        }
        else {
            try {
                parsedUrl = new URL(rawUrl, currentUrl).href;
            }
            catch {
                continue;
            }
        }
        if (!isBlob) {
            try {
                const parsed = new URL(parsedUrl);
                if (!['http:', 'https:'].includes(parsed.protocol))
                    continue;
            }
            catch {
                continue;
            }
        }
        const hasMarkdownSignal = /\.md(?:$|[?#])/i.test(parsedUrl) || /markdown/i.test(parsedUrl);
        const hasExportSignal = /export|download|attachment|file|save-report/i.test(parsedUrl);
        const isGoogleDocUrl = /docs\.google\.com\/document\//i.test(parsedUrl);
        const isGoogleSheetUrl = /docs\.google\.com\/spreadsheets\//i.test(parsedUrl);
        const isNoiseEndpoint = /cspreport|allowlist|gen_204|telemetry|metrics|analytics|doubleclick|logging|collect|favicon/i.test(parsedUrl);
        let score = sourceWeight[sourceKey] ?? 20;
        if (hasMarkdownSignal)
            score += 45;
        if (hasExportSignal)
            score += 25;
        if (isGoogleDocUrl)
            score += 100;
        if (isGoogleSheetUrl)
            score -= 160;
        if (/gemini\.google\.com\/app\//i.test(parsedUrl))
            score -= 60;
        if (/googleapis\.com|gstatic\.com|doubleclick\.net|google-analytics/i.test(parsedUrl))
            score -= 40;
        if (!hasMarkdownSignal && !hasExportSignal && !isBlob)
            score -= 40;
        if (isNoiseEndpoint)
            score -= 120;
        if (parsedUrl === currentUrl)
            score -= 80;
        if (isBlob)
            score += 25;
        if (score > bestScore) {
            bestScore = score;
            bestUrl = parsedUrl;
            if (isBlob)
                bestSource = 'blob';
            else if (sourceKey === 'open')
                bestSource = 'window-open';
            else if (sourceKey === 'anchor')
                bestSource = 'anchor';
            else if (sourceKey === 'performance')
                bestSource = 'performance';
            else
                bestSource = 'network';
        }
    }
    if (!bestUrl || bestScore < 60) {
        return { url: '', source: 'none' };
    }
    return { url: bestUrl, source: bestSource };
}
function exportGeminiDeepResearchReportScript(maxWaitMs) {
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
function extractDocsUrlFromTabs(tabs) {
    if (!Array.isArray(tabs))
        return '';
    for (const tab of tabs) {
        if (!tab || typeof tab !== 'object')
            continue;
        const url = String(tab.url ?? '').trim();
        if (/^https:\/\/docs\.google\.com\/document\//i.test(url))
            return url;
    }
    return '';
}
export async function exportGeminiDeepResearchReport(page, timeoutSeconds = 120) {
    await ensureGeminiPage(page);
    const timeoutMs = Math.max(1, timeoutSeconds) * 1000;
    const tabsBefore = await page.tabs().catch(() => []);
    const exportScript = exportGeminiDeepResearchReportScript(timeoutMs);
    const raw = await page.evaluate(exportScript).catch(() => null);
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
// ── Thinking-level selection ─────────────────────────────────────────

/**
 * Browser evaluate script that opens the Gemini model-picker menu.
 * Returns { ok: true } on success, { ok: false } on failure.
 */
function openModelPickerForThinkingScript() {
    return `
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = el.getAttribute('aria-hidden');
        if (ariaHidden && ariaHidden.toLowerCase() === 'true') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0 || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const VERSION_LABEL_RE = /\\d+\\.\\d+/;

      const MODE_SELECTOR_PATTERNS = [
        /模式选择器/i,
        /mode[\\s-]*selector/i,
        /model[\\s-]*selector/i,
        /model[\\s-]*picker/i,
        /选择模型/i,
        /select[\\s-]+model/i,
        /choose[\\s-]+model/i,
        /switch[\\s-]+model/i,
        /change[\\s-]+model/i,
      ];

      const MODEL_VARIANT_RE = /^(?:gemini\\s+)?(flash|lite|pro|ultra|nano|flash-lite|flash[\\s-]*thinking)$/i;

      const findModelPicker = () => {
        const buttons = Array.from(
          document.querySelectorAll('button, [role="button"]')
        ).filter(isVisible);

        // Method 1: Detect model/mode selector via aria-label patterns.
        for (const button of buttons) {
          const aria = normalize(button.getAttribute('aria-label') || '');
          for (const pattern of MODE_SELECTOR_PATTERNS) {
            if (pattern.test(aria)) return button;
          }
        }

        // Method 2: Detect buttons whose text contains a model-version pattern.
        const versionCandidates = buttons.filter((b) => {
          const text = normalize(b.textContent || '') || normalize(b.getAttribute('aria-label') || '');
          return VERSION_LABEL_RE.test(text) && text.length < 80;
        });
        versionCandidates.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.top - bRect.top || aRect.left - bRect.left;
        });
        if (versionCandidates.length > 0) return versionCandidates[0];

        // Method 3: Detect buttons showing a known model variant as their
        // sole text (e.g. "Pro", "Flash", "Flash-Lite").
        const variantCandidates = buttons.filter((b) => {
          const text = normalize(b.textContent || '');
          return MODEL_VARIANT_RE.test(text) && text.length < 30;
        });
        variantCandidates.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.top - bRect.top || aRect.left - bRect.left;
        });
        if (variantCandidates.length > 0) return variantCandidates[0];

        // Method 4: Fallback — look for any element with model-related attributes.
        const attrEls = Array.from(
          document.querySelectorAll('[data-model-selector], [aria-label*="model" i], [aria-label*="模式" i]')
        ).filter(isVisible);
        if (attrEls.length > 0) return attrEls[0];

        return null;
      };

      const picker = findModelPicker();
      if (!picker) return { ok: false, reason: 'Model picker not found' };

      try {
        picker.click();
        return { ok: true };
      } catch (_) {
        return { ok: false, reason: 'Failed to click model picker' };
      }
    })()
    `;
}

/**
 * Browser evaluate script that clicks the "思考等级" / "Thinking level"
 * toggle inside an already-open model-picker menu to expand thinking options.
 * Returns true if the toggle was found and clicked.
 */
function clickThinkingToggleInMenuScript() {
    return `
    (() => {
      const isVisible = (el) => {
        if (!el) return false;
        if (!(el instanceof HTMLElement) && !(el instanceof Element)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const MENU_SELECTORS = [
        '[role="menu"] [role="menuitem"]',
        '[role="menu"] [role="menuitemradio"]',
        '[role="listbox"] [role="option"]',
        '[role="menu"] button',
        '[role="listbox"] button',
        '[role="menu"] li',
        '[role="listbox"] li',
        '[role="dialog"] [role="menuitem"]',
        '[role="dialog"] [role="option"]',
        '[aria-modal="true"] [role="menuitem"]',
        '[aria-modal="true"] [role="option"]',
        'gem-menu-item',
        'GEM-MENU-ITEM',
      ];

      let menuItems = [];
      for (const sel of MENU_SELECTORS) {
        const items = Array.from(document.querySelectorAll(sel)).filter(isVisible);
        if (items.length >= 2) { menuItems = items; break; }
      }

      if (menuItems.length === 0) {
        const containers = Array.from(
          document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]')
        ).filter(isVisible);
        for (const container of containers) {
          const children = Array.from(
            container.querySelectorAll('button, [role="button"], li, [role="menuitem"], [role="option"], gem-menu-item, GEM-MENU-ITEM, :not(script):not(style)')
          ).filter(isVisible);
          if (children.length >= 2) { menuItems = children; break; }
        }
      }

      const thinkingToggle = menuItems.find((item) => {
        const text = (item.textContent || '').replace(/\\s+/g, ' ').trim();
        return /思考等级|thinking level|thinking mode/i.test(text);
      });

      if (thinkingToggle) {
        try { thinkingToggle.click(); } catch (_) { return false; }
        return true;
      }
      return false;
    })()
    `;
}

/**
 * Browser evaluate script that selects a specific thinking level from an
 * already-open model-picker menu (after the thinking section has been
 * expanded).  Closes the menu after selection (or on failure).
 *
 * @param {string} thinkingValue - 'standard' or 'extended'
 * @returns a function string for page.evaluate() that returns the matched
 *          label text, or empty string on failure
 */
function selectThinkingInMenuScript(thinkingValue) {
    const normalizedValue = String(thinkingValue || '').trim().toLowerCase();
    if (!normalizedValue) return '(() => "")';
    const labelMap = JSON.stringify({
        standard: ['standard', '标准', '標準'],
        extended: ['extended', '扩展', '擴展', '拡張'],
    });
    return `
    (() => {
      const LABEL_MAP = ${labelMap};
      const candidateLabels = LABEL_MAP['${normalizedValue}'] || ['${normalizedValue}'];

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = el.getAttribute('aria-hidden');
        if (ariaHidden && ariaHidden.toLowerCase() === 'true') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0 || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();

      const textOf = (node) => [
        node?.textContent || '',
        node instanceof HTMLElement ? (node.innerText || '') : '',
        node?.getAttribute?.('aria-label') || '',
        node?.getAttribute?.('title') || '',
        node?.getAttribute?.('data-tooltip') || '',
      ].join(' ');

      const matchesThinking = (node) => {
        const combined = normalize(textOf(node));
        if (!combined) return false;
        return candidateLabels.some((label) => combined.includes(label));
      };

      // Search inside visible menu containers first.
      const containers = Array.from(
        document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]')
      ).filter(isVisible);

      const SELECTORS = [
        'button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]',
        '[role="option"]', '[role="radio"]', '[role="switch"]', 'li',
      ];

      let candidates = [];
      for (const container of containers) {
        for (const sel of SELECTORS) {
          const nodes = Array.from(container.querySelectorAll(sel))
            .filter((node) => isVisible(node) && matchesThinking(node));
          candidates.push(...nodes);
        }
      }

      // Fallback: search the entire page.
      if (candidates.length === 0) {
        for (const sel of SELECTORS) {
          const nodes = Array.from(document.querySelectorAll(sel))
            .filter((node) => isVisible(node) && matchesThinking(node));
          candidates.push(...nodes);
        }
      }

      if (candidates.length === 0) {
        try { document.body.click(); } catch (_) {}
        return '';
      }

      // Prefer exact match over substring.
      candidates.sort((a, b) => {
        const aText = normalize(textOf(a));
        const bText = normalize(textOf(b));
        const aExact = candidateLabels.some((l) => aText === l);
        const bExact = candidateLabels.some((l) => bText === l);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return 0;
      });

      const target = candidates[0];
      let matchedLabel = '';
      try {
        target.click();
        matchedLabel = (target.textContent || '').trim();
      } catch (_) {
        try { document.body.click(); } catch (_) {}
        return '';
      }

      // Close the menu after successful selection.
      try { document.body.click(); } catch (_) {}

      return matchedLabel;
    })()
    `;
}

/**
 * Select a Gemini thinking level in the web UI.
 *
 * Multi-step approach matching modelsCommand.func:
 *  1. Open the model-picker menu.
 *  2. Wait for React to render the menu.
 *  3. Click the "思考等级"/"Thinking level" toggle to expand thinking options.
 *  4. Wait for the expanded items to render.
 *  5. Select the requested thinking level.
 *  6. Close the menu.
 *
 * @param {object} page - Puppeteer page object
 * @param {string} thinkingValue - 'standard' or 'extended'
 * @returns {Promise<string>} matched label text, or empty string on failure
 */
export async function selectGeminiThinking(page, thinkingValue) {
    await ensureGeminiPage(page);

    // Step 1: Open the picker menu.
    const pickerRaw = await page.evaluate(openModelPickerForThinkingScript()).catch(() => null);
    const pickerResult = unwrapGeminiEvaluateResult(pickerRaw, 'Gemini thinking model picker');
    if (!pickerResult || !pickerResult.ok) return '';

    // Step 2: Wait for React to render the menu.
    await page.wait(0.8);

    // Step 3: Click the thinking toggle to expand thinking options.
    const toggleRaw = await page.evaluate(clickThinkingToggleInMenuScript()).catch(() => false);
    const toggleClicked = unwrapGeminiEvaluateResult(toggleRaw, 'Gemini thinking toggle');

    if (toggleClicked) {
        // Step 4: Wait for the expanded thinking items to render.
        await page.wait(0.5);
    }

    // Step 5: Select the requested thinking level (also closes the menu).
    const matchedRaw = await page.evaluate(selectThinkingInMenuScript(thinkingValue)).catch(() => '');
    const matched = unwrapGeminiEvaluateResult(matchedRaw, 'Gemini thinking selection');

    if (typeof matched === 'string' && matched) {
        await page.wait(0.3);
        return matched;
    }

    return '';
}

// ── Current model detection ─────────────────────────────────────────

/**
 * Browser evaluate script that reads the currently selected model from the
 * Gemini model-picker button and returns its canonical model ID.
 *
 * Uses the same canonicalModelId logic as discoverModelsScript so that
 * the returned ID can be matched against discovered model entries.
 *
 * @returns a function string for page.evaluate()
 */
function getCurrentGeminiModelScript() {
    return `
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = el.getAttribute('aria-hidden');
        if (ariaHidden && ariaHidden.toLowerCase() === 'true') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0 || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();

      const VERSION_LABEL_RE = /\\d+\\.\\d+/;

      const MODE_SELECTOR_PATTERNS = [
        /模式选择器/i,
        /mode[\\s-]*selector/i,
        /model[\\s-]*selector/i,
        /model[\\s-]*picker/i,
        /选择模型/i,
        /select[\\s-]+model/i,
        /choose[\\s-]+model/i,
        /switch[\\s-]+model/i,
        /change[\\s-]+model/i,
      ];

      const MODEL_VARIANT_RE = /^(?:gemini\\s+)?(flash|lite|pro|ultra|nano|flash-lite|flash[\\s-]*thinking)$/i;

      const findModelPicker = () => {
        const buttons = Array.from(
          document.querySelectorAll('button, [role="button"]')
        ).filter(isVisible);

        // Method 1: Detect model/mode selector via aria-label patterns.
        for (const button of buttons) {
          const aria = normalize(button.getAttribute('aria-label') || '');
          for (const pattern of MODE_SELECTOR_PATTERNS) {
            if (pattern.test(aria)) return button;
          }
        }

        // Method 2: Detect buttons whose text contains a model-version pattern.
        const versionCandidates = buttons.filter((b) => {
          const text = normalize(b.textContent || '') || normalize(b.getAttribute('aria-label') || '');
          return VERSION_LABEL_RE.test(text) && text.length < 80;
        });
        versionCandidates.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.top - bRect.top || aRect.left - bRect.left;
        });
        if (versionCandidates.length > 0) return versionCandidates[0];

        // Method 3: Detect buttons showing a known model variant as their
        // sole text (e.g. "Pro", "Flash", "Flash-Lite").
        const variantCandidates = buttons.filter((b) => {
          const text = normalize(b.textContent || '');
          return MODEL_VARIANT_RE.test(text) && text.length < 30;
        });
        variantCandidates.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return aRect.top - bRect.top || aRect.left - bRect.left;
        });
        if (variantCandidates.length > 0) return variantCandidates[0];

        // Method 4: Fallback — look for any element with model-related attributes.
        const attrEls = Array.from(
          document.querySelectorAll('[data-model-selector], [aria-label*="model" i], [aria-label*="模式" i]')
        ).filter(isVisible);
        if (attrEls.length > 0) return attrEls[0];

        return null;
      };

      const canonicalModelId = (raw) => {
        const text = normalize(raw);
        if (!text) return '';
        const cleaned = text.replace(/^[^a-z0-9]+/i, '').trim();
        const versionRe = /^((?:gemini[\\s-]*)?(\\d+(?:\\.\\d+)?)(?:[\\s-]+(flash|pro|lite|ultra|nano|thinking|experimental))(?:[\\s-]*(flash|pro|lite|ultra|nano|thinking|experimental))?)/i;
        const match = cleaned.match(versionRe);
        if (match) {
          const version = match[2];
          let variant = (match[3] || '').toLowerCase();
          const extra = (match[4] || '').toLowerCase();
          if (extra) variant = variant + '-' + extra;
          return version + '-' + variant;
        }
        const fallbackRe = /(\\d+(?:\\.\\d+)?)\\s*(flash|pro|lite|ultra|nano|thinking|experimental)/i;
        const fallbackMatch = cleaned.match(fallbackRe);
        if (fallbackMatch) {
          return fallbackMatch[1] + '-' + fallbackMatch[2].toLowerCase();
        }
        if (/\\d+(?:\\.\\d+)?/.test(cleaned) && cleaned.length < 60) {
          return cleaned.replace(/\\s+/g, '-').replace(/[^a-z0-9.-]/g, '');
        }
        return '';
      };

      const picker = findModelPicker();
      if (!picker) return '';

      const combined = normalize(picker.textContent || '') + ' ' + normalize(picker.getAttribute('aria-label') || '');
      return canonicalModelId(combined);
    })()
    `;
}

/**
 * Get the canonical ID of the currently selected Gemini model from the
 * model-picker button in the web UI.
 *
 * @param {object} page - Puppeteer page object
 * @returns {Promise<string>} canonical model ID, or empty string on failure
 */
export async function getCurrentGeminiModel(page) {
    await ensureGeminiPage(page);
    const modelId = await page.evaluate(getCurrentGeminiModelScript()).catch(() => '');
    return typeof modelId === 'string' ? modelId : '';
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
    expandGeminiRecentScript,
    submitComposerScript,
    insertComposerTextFallbackScript,
    openModelPickerForThinkingScript,
    clickThinkingToggleInMenuScript,
    selectThinkingInMenuScript,
    selectGeminiModelScript,
    getCurrentGeminiModelScript,
};
export async function getGeminiVisibleImageUrls(page) {
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
  `);
}
export async function waitForGeminiImages(page, beforeUrls, timeoutSeconds) {
    const beforeSet = new Set(beforeUrls);
    const pollIntervalSeconds = 3;
    const maxPolls = Math.max(1, Math.ceil(timeoutSeconds / pollIntervalSeconds));
    let lastUrls = [];
    let stableCount = 0;
    for (let index = 0; index < maxPolls; index += 1) {
        await page.wait(index === 0 ? 2 : pollIntervalSeconds);
        const urls = (await getGeminiVisibleImageUrls(page)).filter((url) => !beforeSet.has(url));
        if (urls.length === 0)
            continue;
        const key = urls.join('\n');
        const prevKey = lastUrls.join('\n');
        if (key == prevKey)
            stableCount += 1;
        else {
            lastUrls = urls;
            stableCount = 1;
        }
        if (stableCount >= 2 || index === maxPolls - 1)
            return lastUrls;
    }
    return lastUrls;
}
export async function exportGeminiImages(page, urls) {
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
  `);
}
export async function waitForGeminiResponse(page, baseline, promptText, timeoutSeconds) {
    if (timeoutSeconds <= 0)
        return '';
    // Reply ownership must survive Gemini prepending older history later.
    // Re-anchor on the submitted user turn when possible, and otherwise only
    // accept assistants that are appended to the exact submission snapshot.
    const pickStructuredReplyCandidate = (current) => {
        if (!current.structuredTurnsTrusted)
            return '';
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
    const pickFallbackGeminiTranscriptReply = (current) => current.transcriptLines
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
            if (structuredCandidate === lastStructured)
                structuredStableCount += 1;
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
        if (transcriptMissCount < 2)
            continue;
        const transcriptCandidate = pickFallbackGeminiTranscriptReply(current);
        if (!transcriptCandidate)
            continue;
        if (transcriptCandidate === lastTranscript)
            transcriptStableCount += 1;
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

/**
 * Evaluate script that selects a specific Gemini model from the web UI
 * model picker by canonical model id (e.g. "2.5-flash").
 *
 * Returns { ok: true } on success, or { ok: false, reason: "..." }
 * when the picker or model item could not be found / clicked.
 */
/**
 * Browser evaluate script that finds and clicks a model entry in an
 * already-open Gemini model-picker menu.  Does NOT open the picker.
 */
function selectModelInMenuScript(modelId) {
    return `
    (() => {
      const targetModelId = ${JSON.stringify(modelId)};
      if (!targetModelId) return { ok: false, reason: 'No model id provided' };

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement) && !(el instanceof Element)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        const ariaHidden = el.getAttribute('aria-hidden');
        if (ariaHidden && ariaHidden.toLowerCase() === 'true') return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0 || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();

      const canonicalModelId = (raw) => {
        const text = normalize(raw);
        if (!text) return '';
        const cleaned = text.replace(/^[^a-z0-9]+/i, '').trim();
        const versionRe = /^((?:gemini[\\s-]*)?(\\d+(?:\\.\\d+)?)(?:[\\s-]+(flash|pro|lite|ultra|nano|thinking|experimental))(?:[\\s-]*(flash|pro|lite|ultra|nano|thinking|experimental))?)/i;
        const match = cleaned.match(versionRe);
        if (match) {
          const version = match[2];
          let variant = (match[3] || '').toLowerCase();
          const extra = (match[4] || '').toLowerCase();
          if (extra) variant = variant + '-' + extra;
          return version + '-' + variant;
        }
        const fallbackRe = /(\\d+(?:\\.\\d+)?)\\s*(flash|pro|lite|ultra|nano|thinking|experimental)/i;
        const fallbackMatch = cleaned.match(fallbackRe);
        if (fallbackMatch) {
          return fallbackMatch[1] + '-' + fallbackMatch[2].toLowerCase();
        }
        if (/\\d+(?:\\.\\d+)?/.test(cleaned) && cleaned.length < 60) {
          return cleaned.replace(/\\s+/g, '-').replace(/[^a-z0-9.-]/g, '');
        }
        return '';
      };

      const MENU_SELECTORS = [
        '[role="menu"] [role="menuitem"]',
        '[role="menu"] [role="menuitemradio"]',
        '[role="listbox"] [role="option"]',
        '[role="menu"] button',
        '[role="listbox"] button',
        '[role="menu"] li',
        '[role="listbox"] li',
        '[role="dialog"] [role="menuitem"]',
        '[role="dialog"] [role="option"]',
        '[aria-modal="true"] [role="menuitem"]',
        '[aria-modal="true"] [role="option"]',
        'gem-menu-item',
        'GEM-MENU-ITEM',
      ];

      let menuItems = [];
      for (const sel of MENU_SELECTORS) {
        const items = Array.from(document.querySelectorAll(sel)).filter(isVisible);
        if (items.length >= 2) { menuItems = items; break; }
      }

      if (menuItems.length === 0) {
        const containers = Array.from(
          document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]')
        ).filter(isVisible);
        for (const container of containers) {
          const children = Array.from(
            container.querySelectorAll('button, [role="button"], li, [role="menuitem"], [role="option"], gem-menu-item, GEM-MENU-ITEM, :not(script):not(style)')
          ).filter(isVisible);
          if (children.length >= 2) { menuItems = children; break; }
        }
      }

      let matched = null;
      for (const item of menuItems) {
        const id = canonicalModelId(item.textContent || '');
        if (id === targetModelId) {
          matched = item;
          break;
        }
      }

      if (!matched) {
        try { document.body.click(); } catch (_) {}
        return { ok: false, reason: 'Model "' + targetModelId + '" not found in picker menu' };
      }

      try {
        matched.click();
      } catch (_) {
        try { document.body.click(); } catch (_) {}
        return { ok: false, reason: 'Failed to click model menu item' };
      }

      return { ok: true };
    })()
    `;
}

/**
 * Legacy wrapper kept for test compatibility — delegates to
 * selectModelInMenuScript.  New callers should prefer the split
 * openModelPickerForThinkingScript + selectModelInMenuScript
 * pattern with an explicit page.wait between them.
 */
export function selectGeminiModelScript(modelId) {
    return selectModelInMenuScript(modelId);
}

/**
 * Select a Gemini model by canonical id (e.g. "2.5-flash") in the
 * web UI model picker.  Opens the picker, waits for React, then clicks
 * the matching entry.  Throws CommandExecutionError on failure.
 */
export async function selectGeminiModel(page, modelId) {
    await ensureGeminiPage(page);

    // Open the picker menu.
    const pickerRaw = await page.evaluate(openModelPickerForThinkingScript());
    const pickerResult = unwrapGeminiEvaluateResult(pickerRaw, 'Gemini model picker');
    if (!pickerResult || !pickerResult.ok) {
        throw new CommandExecutionError(
            pickerResult?.reason || 'Failed to open model picker for model selection'
        );
    }

    // Wait for React to render the menu.
    await page.wait(0.8);

    // Find and click the matching menu item.
    const raw = await page.evaluate(selectModelInMenuScript(modelId));
    const result = unwrapGeminiEvaluateResult(raw, 'Gemini model selection');
    if (!result || !result.ok) {
        throw new CommandExecutionError(
            result?.reason || 'Failed to select Gemini model "' + modelId + '"'
        );
    }

    await page.wait(0.5);
    const selectedModelId = await getCurrentGeminiModel(page);
    if (selectedModelId !== modelId) {
        throw new CommandExecutionError(
            selectedModelId
                ? `Gemini model selection read-back returned "${selectedModelId}", expected "${modelId}"`
                : `Gemini model selection did not expose selected model "${modelId}" after click`
        );
    }
}
