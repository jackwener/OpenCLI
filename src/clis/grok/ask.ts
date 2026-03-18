import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const askCommand = cli({
  site: 'grok',
  name: 'ask',
  description: 'Send a message to Grok and get response',
  domain: 'grok.com',
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
    const newChat = kwargs.new as boolean;

    if (newChat) {
      await page.goto('https://grok.com');
      await page.wait(2);
      await page.evaluate(`(() => {
        const btn = [...document.querySelectorAll('a, button')].find(b => {
          const t = (b.textContent || '').trim().toLowerCase();
          return t.includes('new') || b.getAttribute('href') === '/';
        });
        if (btn) btn.click();
      })()`);
      await page.wait(2);
    }

    await page.goto('https://grok.com');
    await page.wait(3);

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
