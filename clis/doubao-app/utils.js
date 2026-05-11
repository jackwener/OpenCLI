/**
 * Shared constants and helpers for Doubao desktop app (Electron + CDP).
 *
 * Requires: Doubao launched with --remote-debugging-port=9226
 */
/** Selectors discovered via data-testid attributes */
export const SEL = {
    INPUT: '[data-testid="chat_input_input"]',
    SEND_BTN: '[data-testid="chat_input_send_button"]',
    MESSAGE: '[data-testid="message_content"]',
    MESSAGE_TEXT: '[data-testid="message_text_content"]',
    INDICATOR: '[data-testid="indicator"]',
    NEW_CHAT: '[data-testid="new_chat_button"]',
    NEW_CHAT_SIDEBAR: '[data-testid="app-open-newChat"]',
};
/**
 * Inject text into the Doubao chat textarea via React-compatible value setter.
 * Returns an evaluate script string.
 */
export function injectTextScript(text) {
    return `(function(t) {
    const textarea = document.querySelector('${SEL.INPUT}');
    if (!textarea) return { ok: false, error: 'No textarea found' };
    textarea.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    if (setter) setter.call(textarea, t);
    else textarea.value = t;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })(${JSON.stringify(text)})`;
}
/**
 * Click the send button. Returns an evaluate script string.
 */
export function clickSendScript() {
    return `(function() {
    const btn = document.querySelector('${SEL.SEND_BTN}');
    if (!btn) return false;
    btn.click();
    return true;
  })()`;
}
/**
 * Read all chat messages from the DOM. Returns an evaluate script string.
 */
export function readMessagesScript() {
    return `(function() {
    const results = [];
    const containers = document.querySelectorAll('${SEL.MESSAGE}');
    for (const container of containers) {
      const textEl = container.querySelector('${SEL.MESSAGE_TEXT}');
      if (!textEl) continue;
      // Skip streaming messages
      if (textEl.querySelector('${SEL.INDICATOR}') ||
          textEl.getAttribute('data-show-indicator') === 'true') continue;
      const isUser = container.classList.contains('justify-end');
      let text = '';
      const children = textEl.querySelectorAll('div[dir]');
      if (children.length > 0) {
        text = Array.from(children).map(c => c.innerText || c.textContent || '').join('');
      } else {
        text = textEl.innerText?.trim() || textEl.textContent?.trim() || '';
      }
      if (!text) continue;
      results.push({ role: isUser ? 'User' : 'Assistant', text: text.substring(0, 2000) });
    }
    return results;
  })()`;
}
/**
 * Click the new-chat button. Returns an evaluate script string.
 */
export function clickNewChatScript() {
    return `(function() {
    let btn = document.querySelector('${SEL.NEW_CHAT}');
    if (btn) { btn.click(); return true; }
    btn = document.querySelector('${SEL.NEW_CHAT_SIDEBAR}');
    if (btn) { btn.click(); return true; }
    return false;
  })()`;
}
/**
 * Poll for a new assistant response after sending.
 * Returns evaluate script that checks message count vs baseline.
 */
export function pollResponseScript(beforeCount) {
    return `(function(prevCount) {
    const msgs = document.querySelectorAll('${SEL.MESSAGE}');
    if (msgs.length <= prevCount) return { phase: 'waiting', text: null };
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.classList.contains('justify-end')) return { phase: 'waiting', text: null };
    const textEl = lastMsg.querySelector('${SEL.MESSAGE_TEXT}');
    if (!textEl) return { phase: 'waiting', text: null };
    if (textEl.querySelector('${SEL.INDICATOR}') ||
        textEl.getAttribute('data-show-indicator') === 'true') {
      return { phase: 'streaming', text: null };
    }
    let text = '';
    const children = textEl.querySelectorAll('div[dir]');
    if (children.length > 0) {
      text = Array.from(children).map(c => c.innerText || c.textContent || '').join('');
    } else {
      text = textEl.innerText?.trim() || textEl.textContent?.trim() || '';
    }
    return { phase: 'done', text };
  })(${beforeCount})`;
}
