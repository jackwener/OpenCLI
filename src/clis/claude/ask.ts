import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const askCommand = cli({
  site: 'claude',
  name: 'ask',
  description: 'Send a message to Claude and get response',
  domain: 'claude.ai',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'prompt', type: 'string', required: true },
    { name: 'timeout', type: 'int', default: 120 },
    { name: 'new', type: 'boolean', default: false },
  ],
  columns: ['response'],
  func: async (page: IPage, kwargs: Record<string, any>) => {
    const prompt = kwargs.prompt as string;
    const timeoutMs = ((kwargs.timeout as number) || 120) * 1000;
    const startUrl = kwargs.new ? 'https://claude.ai/new' : 'https://claude.ai';

    await page.goto(startUrl);
    await page.wait(3);

    const promptJson = JSON.stringify(prompt);

    const sendResult = await page.evaluate(`(async () => {
      try {
        const ce = document.querySelector('div[contenteditable="true"]');
        const ta = document.querySelector('textarea');
        const input = ce || ta;
        if (!input) return { ok: false, msg: 'no input found' };
        input.focus();
        if (ce) {
          ce.innerHTML = '';
          document.execCommand('insertText', false, ${promptJson});
        } else {
          ta.value = '';
          document.execCommand('selectAll');
          document.execCommand('insertText', false, ${promptJson});
        }
        await new Promise(r => setTimeout(r, 1500));
        const btn = document.querySelector('button[aria-label="Send Message"]')
          || document.querySelector('button[aria-label="Send"]')
          || [...document.querySelectorAll('button[type="button"]')].find(b =>
            !b.disabled && b.querySelector('svg') && b.closest('[class*="input"]'));
        if (btn && !btn.disabled) { btn.click(); return { ok: true, msg: 'clicked' }; }
        const sub = [...document.querySelectorAll('button[type="submit"]')].find(b => !b.disabled);
        if (sub) { sub.click(); return { ok: true, msg: 'clicked-submit' }; }
        (input).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
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
        const msgs = document.querySelectorAll('[data-is-streaming], .font-claude-message, [class*="response"], [class*="assistant-message"]');
        if (msgs.length) {
          const last = msgs[msgs.length - 1];
          const text = (last.innerText || '').trim();
          if (text && text.length > 2) return text;
        }
        const all = [...document.querySelectorAll('[class*="message"]')];
        if (all.length < 2) return '';
        const last = all[all.length - 1];
        return (last.innerText || '').trim();
      })()`);

      if (response && response.length > 2) {
        if (response === lastText) {
          stableCount++;
          if (stableCount >= 2) return [{ response }];
        } else {
          stableCount = 0;
        }
      }
      lastText = response || '';
    }

    if (lastText) return [{ response: lastText }];
    return [{ response: '[NO RESPONSE]' }];
  },
});
