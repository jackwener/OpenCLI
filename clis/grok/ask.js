import { cli, Strategy } from '@jackwener/opencli/registry';
const GROK_URL = 'https://grok.com/';
const RESPONSE_SELECTOR = 'div.message-bubble, [data-testid="message-bubble"]';
const BLOCKED_PREFIX = '[BLOCKED]';
const NO_RESPONSE_PREFIX = '[NO RESPONSE]';
const SESSION_HINT = 'Likely login/auth/challenge/session issue in the existing grok.com browser session.';
function blocked(message) {
    return [{ response: `${BLOCKED_PREFIX} ${message} ${SESSION_HINT}` }];
}
function normalizeBubbleText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeBooleanFlag(value) {
    if (typeof value === 'boolean')
        return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
function pickLatestAssistantCandidate(bubbles, baselineCount, prompt) {
    const normalizedPrompt = prompt.trim();
    const freshBubbles = bubbles
        .slice(Math.max(0, baselineCount))
        .map(normalizeBubbleText)
        .filter(Boolean);
    for (let i = freshBubbles.length - 1; i >= 0; i -= 1) {
        if (freshBubbles[i] !== normalizedPrompt)
            return freshBubbles[i];
    }
    return '';
}
function updateStableState(previousText, stableCount, nextText) {
    if (!nextText)
        return { previousText: '', stableCount: 0 };
    if (nextText === previousText)
        return { previousText, stableCount: stableCount + 1 };
    return { previousText: nextText, stableCount: 0 };
}
/** Check whether the tab is already on grok.com (any path). */
async function isOnGrok(page) {
    // catch handles blank tabs (about:blank) or detached pages
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string' || !url)
        return false;
    try {
        const hostname = new URL(url).hostname;
        return hostname === 'grok.com' || hostname.endsWith('.grok.com');
    }
    catch {
        return false;
    }
}
async function runDefaultAsk(page, prompt, timeoutMs, newChat) {
    if (newChat) {
        // Explicitly start a fresh conversation via the homepage
        await page.goto(GROK_URL);
        await page.wait(2);
        await tryStartFreshChat(page);
        await page.wait(2);
    }
    else if (!(await isOnGrok(page))) {
        // First invocation or tab was recycled — navigate to Grok
        await page.goto(GROK_URL);
        await page.wait(3);
    }
    const promptJson = JSON.stringify(prompt);
    const sendResult = await page.evaluate(`(async () => {
    try {
      const box = document.querySelector('textarea');
      if (!box) return { ok: false, msg: 'no textarea' };
      box.focus(); box.value = '';
      document.execCommand('selectAll');
      document.execCommand('insertText', false, ${promptJson});
      await new Promise(r => setTimeout(r, 1500));
      const btn = document.querySelector('button[aria-label="\\u63d0\\u4ea4"]');
      if (btn && !btn.disabled) { btn.click(); return { ok: true, msg: 'clicked' }; }
      const sub = [...document.querySelectorAll('button[type="submit"]')].find(b => !b.disabled);
      if (sub) { sub.click(); return { ok: true, msg: 'clicked-submit' }; }
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      return { ok: true, msg: 'enter' };
    } catch (e) { return { ok: false, msg: e.toString() }; }
  })()`);
    if (!sendResult || !sendResult.ok) {
        return [{ response: '[SEND FAILED] ' + JSON.stringify(sendResult) }];
    }
    const startTime = Date.now();
    let lastText = '';
    let stableCount = 0;
    while (Date.now() - startTime < timeoutMs) {
        await page.wait(3);
        const response = await page.evaluate(`(() => {
      const bubbles = document.querySelectorAll('div.message-bubble, [data-testid="message-bubble"]');
      if (bubbles.length < 2) return '';
      const last = bubbles[bubbles.length - 1];
      const text = (last.innerText || '').trim();
      if (!text || text.length < 2) return '';
      return text;
    })()`);
        if (response && response.length > 2) {
            if (response === lastText) {
                stableCount++;
                if (stableCount >= 2)
                    return [{ response }];
            }
            else {
                stableCount = 0;
            }
        }
        lastText = response || '';
    }
    if (lastText)
        return [{ response: lastText }];
    return [{ response: NO_RESPONSE_PREFIX }];
}
async function getBubbleTexts(page) {
    const result = await page.evaluate(`(() => {
    return Array.from(document.querySelectorAll(${JSON.stringify(RESPONSE_SELECTOR)}))
      .map(node => (node instanceof HTMLElement ? node.innerText : node?.textContent || ''))
      .map(text => (typeof text === 'string' ? text.trim() : ''))
      .filter(Boolean);
  })()`);
    return Array.isArray(result) ? result.map(normalizeBubbleText).filter(Boolean) : [];
}
async function tryStartFreshChat(page) {
    await page.evaluate(`(() => {
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const candidates = Array.from(document.querySelectorAll('a, button')).filter(node => {
      if (!isVisible(node)) return false;
      const text = (node.textContent || '').trim().toLowerCase();
      const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
      const href = node.getAttribute('href') || '';
      return text.includes('new chat')
        || text.includes('new conversation')
        || aria.includes('new chat')
        || aria.includes('new conversation')
        || href === '/';
    });

    const target = candidates[0];
    if (target instanceof HTMLElement) target.click();
  })()`);
}
async function sendPromptViaExplicitWeb(page, prompt) {
    return page.evaluate(`(async () => {
    const waitFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const composerSelector = '.ProseMirror[contenteditable="true"]';
    let composer = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = document.querySelector(composerSelector);
      if (candidate instanceof HTMLElement) {
        composer = candidate;
        break;
      }

      await waitFor(1000);
    }

    if (!(composer instanceof HTMLElement)) {
      return {
        ok: false,
        reason: 'Grok composer was not found on grok.com.',
      };
    }

    const editor = composer.editor;
    if (!editor?.commands?.focus || !editor?.commands?.insertContent) {
      return {
        ok: false,
        reason: 'Grok composer editor API was unavailable.',
      };
    }

    const isVisibleEnabledSubmit = (node) => {
      if (!(node instanceof HTMLButtonElement)) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return !node.disabled
        && rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    };

    try {
      if (editor.commands.clearContent) editor.commands.clearContent();
      editor.commands.focus();
      editor.commands.insertContent(${JSON.stringify(prompt)});
    } catch (error) {
      return {
        ok: false,
        reason: 'Failed to insert the prompt into the Grok composer.',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    let submit = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = Array.from(document.querySelectorAll('button[aria-label="Submit"]'))
        .find(isVisibleEnabledSubmit);

      if (candidate instanceof HTMLButtonElement) {
        submit = candidate;
        break;
      }

      await waitFor(500);
    }

    if (!(submit instanceof HTMLButtonElement)) {
      return {
        ok: false,
        reason: 'Grok submit button did not reach a clickable ready state after prompt insertion.',
      };
    }

    submit.click();
    return { ok: true };
  })()`);
}
async function runExplicitWebAsk(page, prompt, timeoutMs, newChat) {
    if (newChat) {
        // Navigate to homepage and start a fresh conversation
        await page.goto(GROK_URL, { settleMs: 2000 });
        await tryStartFreshChat(page);
        await page.wait(2);
    }
    else if (!(await isOnGrok(page))) {
        // First invocation or tab was recycled — navigate to Grok
        await page.goto(GROK_URL, { settleMs: 2000 });
    }
    const baselineBubbles = await getBubbleTexts(page);
    const sendResult = await sendPromptViaExplicitWeb(page, prompt);
    if (!sendResult?.ok) {
        const details = sendResult?.detail ? ` ${sendResult.detail}` : '';
        return blocked(`${sendResult?.reason || 'Unable to send the prompt to Grok.'}${details}`);
    }
    const startTime = Date.now();
    let lastText = '';
    let stableCount = 0;
    while (Date.now() - startTime < timeoutMs) {
        await page.wait(2);
        const bubbleTexts = await getBubbleTexts(page);
        const candidate = pickLatestAssistantCandidate(bubbleTexts, baselineBubbles.length, prompt);
        const nextState = updateStableState(lastText, stableCount, candidate);
        lastText = nextState.previousText;
        stableCount = nextState.stableCount;
        if (candidate && stableCount >= 2) {
            return [{ response: candidate }];
        }
    }
    if (lastText)
        return [{ response: lastText }];
    return [{ response: `${NO_RESPONSE_PREFIX} No new assistant message bubble appeared within ${Math.round(timeoutMs / 1000)}s.` }];
}
export const askCommand = cli({
    site: 'grok',
    name: 'ask',
    access: 'write',
    description: 'Send a message to Grok and get response',
    domain: 'grok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'prompt', positional: true, type: 'string', required: true, help: 'Prompt to send to Grok' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response (default: 120)' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending (default: false)' },
        { name: 'web', type: 'boolean', default: false, help: 'Use the explicit grok.com consumer web flow (default: false)' },
    ],
    columns: ['response'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeoutMs = (kwargs.timeout || 120) * 1000;
        const newChat = normalizeBooleanFlag(kwargs.new);
        const useExplicitWeb = normalizeBooleanFlag(kwargs.web);
        if (useExplicitWeb) {
            return runExplicitWebAsk(page, prompt, timeoutMs, newChat);
        }
        return runDefaultAsk(page, prompt, timeoutMs, newChat);
    },
});
export const __test__ = {
    pickLatestAssistantCandidate,
    updateStableState,
    normalizeBooleanFlag,
    normalizeBubbleText,
    isOnGrok,
};
