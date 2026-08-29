import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

/** Shared selectors for current and legacy Doubao desktop renderers. */
export const SEL = {
  INPUT_ROOT: '[data-testid="chat_input_input"]',
  INPUT: 'textarea[data-testid="chat_input_input"], input[data-testid="chat_input_input"], [data-testid="chat_input_input"][contenteditable="true"], [data-testid="chat_input_input"] [contenteditable="true"]',
  SEND_BTN: '[data-testid="chat_input_send_button"]',
  MESSAGE: '[data-testid="message_content"]',
  MESSAGE_TEXT: '[data-testid="message_text_content"]',
  MESSAGE_ROOT: '[data-testid="union_message"]',
  USER_MESSAGE: '[data-testid="send_message"]',
  ASSISTANT_MESSAGE: '[data-testid="receive_message"]',
  MESSAGE_ACTIONS: '[data-testid="message_action_bar"]',
  INDICATOR: '[data-testid="indicator"]',
  GENERATING: '[data-testid="chat_input_local_break_button"], [data-testid="chat_input_end_button"]',
  NEW_CHAT: '[data-testid="new_chat_button"]',
  NEW_CHAT_SIDEBAR: '[data-testid="app-open-newChat"]',
};

export function ensureMessageText(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text.trim()) throw new ArgumentError('text must not be empty');
  if (text.length > 100_000) throw new ArgumentError('text must not exceed 100000 characters');
  return text;
}

export function normalizeTimeout(value, fallback = 30) {
  const timeout = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new ArgumentError('--timeout must be a positive integer (seconds)');
  }
  return timeout;
}

export function isDoubaoChatUrl(url) {
  return /^(?:chrome|doubao):\/\/doubao-chat\/chat(?:[/?#]|$)/i.test(String(url || ''));
}

export function inspectSurfaceScript() {
  return `(function() {
    return {
      url: window.location.href,
      title: document.title,
      composerReady: Boolean(document.querySelector('${SEL.INPUT}')),
      messageSurfaceReady: Boolean(document.querySelector('${SEL.MESSAGE_ROOT}, ${SEL.MESSAGE}'))
    };
  })()`;
}

/** Inject text and verify the exact draft in textarea and contenteditable renderers. */
export function injectTextScript(text) {
  return `(function(t) {
    const editor = document.querySelector('${SEL.INPUT}');
    if (!editor) return { ok: false, error: 'Message editor was not found' };
    editor.focus();
    const isTextControl = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement;
    if (isTextControl) {
      const prototype = editor instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(editor, t);
      else editor.value = t;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      let inserted = false;
      if (typeof document.execCommand === 'function') {
        document.execCommand('selectAll', false, null);
        inserted = document.execCommand('insertText', false, t);
      }
      if (!inserted) {
        editor.textContent = t;
        const event = typeof InputEvent === 'function'
          ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: t })
          : new Event('input', { bubbles: true });
        editor.dispatchEvent(event);
      }
    }
    const draft = isTextControl
      ? editor.value
      : String(editor.innerText ?? editor.textContent ?? '').replace(/\\n$/, '');
    return draft === t
      ? { ok: true, text: draft }
      : { ok: false, error: 'Message editor did not accept the complete text', text: draft };
  })(${JSON.stringify(text)})`;
}

/** Click the enabled send button. */
export function clickSendScript() {
  return `(function() {
    const button = document.querySelector('${SEL.SEND_BTN}');
    if (!button) return { ok: false, error: 'Send button was not found' };
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return { ok: false, error: 'Send button is disabled' };
    }
    button.click();
    return { ok: true };
  })()`;
}

/** Read the currently rendered turns, using explicit role markers where available. */
export function readMessagesScript() {
  return `(function() {
    const textOf = (root) => {
      const parts = Array.from(root.querySelectorAll('${SEL.MESSAGE_TEXT}'))
        .filter((part) => !part.querySelector('${SEL.INDICATOR}') && part.getAttribute('data-show-indicator') !== 'true')
        .map((part) => String(part.innerText || part.textContent || '').trim())
        .filter(Boolean);
      return parts.join('\\n');
    };
    const roots = Array.from(document.querySelectorAll('${SEL.MESSAGE_ROOT}'));
    if (roots.length > 0) {
      return roots.map((root) => {
        const role = root.querySelector('${SEL.USER_MESSAGE}')
          ? 'User'
          : root.querySelector('${SEL.ASSISTANT_MESSAGE}') ? 'Assistant' : null;
        const text = textOf(root);
        return role && text ? { role, text: text.substring(0, 2000) } : null;
      }).filter(Boolean);
    }
    return Array.from(document.querySelectorAll('${SEL.MESSAGE}')).map((container) => {
      const role = container.classList.contains('justify-end') ? 'User' : 'Assistant';
      const text = textOf(container);
      return text ? { role, text: text.substring(0, 2000) } : null;
    }).filter(Boolean);
  })()`;
}

/** Capture the identity of all currently mounted turns before clicking Send. */
export function prepareSubmissionScript(token) {
  return `(function(token) {
    const roots = Array.from(document.querySelectorAll('${SEL.MESSAGE_ROOT}'));
    const store = globalThis.__opencliDoubaoSubmissions ||= new Map();
    store.set(token, { initialRoots: new WeakSet(roots), promptRoot: null });
    return roots.length;
  })(${JSON.stringify(token)})`;
}

/** Confirm a newly mounted user turn and retain its DOM identity for ask. */
export function submittedMessageScript(text, token) {
  return `(function(expected, token) {
    const textOf = (root) => Array.from(root.querySelectorAll('${SEL.MESSAGE_TEXT}'))
      .map((part) => String(part.innerText || part.textContent || '').trim())
      .filter(Boolean)
      .join('\\n');
    const state = globalThis.__opencliDoubaoSubmissions?.get(token);
    if (!state) return false;
    const normalizedExpected = String(expected).trim();
    const messages = Array.from(document.querySelectorAll('${SEL.MESSAGE_ROOT}'));
    const candidates = messages.filter((root) =>
      !state.initialRoots.has(root)
      && root.querySelector('${SEL.USER_MESSAGE}')
      && textOf(root) === normalizedExpected
    );
    const promptRoot = candidates[candidates.length - 1];
    if (!promptRoot) return false;
    state.promptRoot = promptRoot;
    return true;
  })(${JSON.stringify(text)}, ${JSON.stringify(token)})`;
}

export function cleanupSubmissionScript(token) {
  return `(function(token) {
    const store = globalThis.__opencliDoubaoSubmissions;
    if (!store) return false;
    const deleted = store.delete(token);
    if (store.size === 0) delete globalThis.__opencliDoubaoSubmissions;
    return deleted;
  })(${JSON.stringify(token)})`;
}

/** Find the completed assistant turn following the confirmed user-turn identity. */
export function responseAfterPromptScript(text, token) {
  return `(function(expected, token) {
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const textOf = (root) => Array.from(root.querySelectorAll('${SEL.MESSAGE_TEXT}'))
      .filter((part) => !part.querySelector('${SEL.INDICATOR}') && part.getAttribute('data-show-indicator') !== 'true')
      .map((part) => String(part.innerText || part.textContent || '').trim())
      .filter(Boolean)
      .join('\\n');
    const state = globalThis.__opencliDoubaoSubmissions?.get(token);
    const promptRoot = state?.promptRoot;
    if (!promptRoot || textOf(promptRoot) !== String(expected).trim()) {
      return { phase: 'waiting', text: '', reason: 'prompt_not_confirmed' };
    }
    const messages = Array.from(document.querySelectorAll('${SEL.MESSAGE_ROOT}'));
    const promptIndex = messages.indexOf(promptRoot);
    if (promptIndex < 0) return { phase: 'waiting', text: '', reason: 'prompt_unmounted' };
    const reply = messages.slice(promptIndex + 1)
      .find((root) => root.querySelector('${SEL.ASSISTANT_MESSAGE}') && textOf(root));
    const generating = Array.from(document.querySelectorAll('${SEL.GENERATING}')).some(isVisible);
    const replyText = reply ? textOf(reply) : '';
    if (!replyText) return { phase: generating ? 'streaming' : 'waiting', text: '' };
    const completed = Boolean(reply.querySelector('${SEL.MESSAGE_ACTIONS}'));
    return { phase: generating || !completed ? 'streaming' : 'candidate', text: replyText };
  })(${JSON.stringify(text)}, ${JSON.stringify(token)})`;
}

export async function sendDoubaoMessage(page, value, options = {}) {
  const text = ensureMessageText(value);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const token = `opencli-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.evaluate(prepareSubmissionScript(token));
  const injected = await page.evaluate(injectTextScript(text));
  if (!injected?.ok) {
    await page.evaluate(cleanupSubmissionScript(token)).catch(() => {});
    throw new CommandExecutionError(
      injected?.error || 'Could not fill the Doubao message editor',
      'Open a Doubao chat and check that its composer is visible.',
    );
  }
  const clicked = await page.evaluate(clickSendScript());
  if (!clicked?.ok) {
    await page.evaluate(cleanupSubmissionScript(token)).catch(() => {});
    throw new CommandExecutionError(
      clicked?.error || 'Could not submit the Doubao message',
      'Wait for the current response to finish, then retry.',
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.wait(0.25);
    if (await page.evaluate(submittedMessageScript(text, token))) {
      if (!options.retainSubmission) {
        await page.evaluate(cleanupSubmissionScript(token)).catch(() => {});
      }
      return { text, token };
    }
  }
  await page.evaluate(cleanupSubmissionScript(token)).catch(() => {});
  throw new CommandExecutionError(
    `Doubao send outcome is unknown after ${Math.ceil(timeoutMs / 1000)}s`,
    'Check the current conversation before retrying; the message may already have been sent.',
  );
}

/** Click the new-chat button. */
export function clickNewChatScript() {
  return `(function() {
    let btn = document.querySelector('${SEL.NEW_CHAT}');
    if (btn) { btn.click(); return true; }
    btn = document.querySelector('${SEL.NEW_CHAT_SIDEBAR}');
    if (btn) { btn.click(); return true; }
    return false;
  })()`;
}
