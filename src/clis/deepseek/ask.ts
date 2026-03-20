import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const askCommand = cli({
  site: 'deepseek',
  name: 'ask',
  description: 'Send a message to DeepSeek and get response',
  domain: 'chat.deepseek.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'prompt', type: 'string', required: true },
    { name: 'timeout', type: 'int', default: 120 },
    { name: 'think', type: 'boolean', default: false, help: 'Enable DeepThink (R1) mode' },
  ],
  columns: ['response'],
  func: async (page: IPage, kwargs: Record<string, any>) => {
    const prompt = kwargs.prompt as string;
    const timeoutMs = ((kwargs.timeout as number) || 120) * 1000;

    await page.goto('https://chat.deepseek.com');
    await page.wait(3);

    if (kwargs.think) {
      await page.evaluate(`(() => {
        const toggle = [...document.querySelectorAll('div[role="button"], button')].find(b =>
          (b.textContent || '').includes('DeepThink') || (b.textContent || '').includes('深度思考'));
        if (toggle) toggle.click();
      })()`);
      await page.wait(1);
    }

    const promptJson = JSON.stringify(prompt);

    const sendResult = await page.evaluate(`(async () => {
      try {
        const ta = document.querySelector('textarea');
        if (!ta) return { ok: false, msg: 'no textarea' };
        ta.focus(); ta.value = '';
        document.execCommand('selectAll');
        document.execCommand('insertText', false, ${promptJson});
        await new Promise(r => setTimeout(r, 1500));
        const btn = [...document.querySelectorAll('button')].find(b =>
          !b.disabled && b.querySelector('svg') && (
            b.closest('[class*="input"]') || b.closest('[class*="chat"]') || b.closest('form')));
        if (btn) { btn.click(); return { ok: true, msg: 'clicked' }; }
        const sub = [...document.querySelectorAll('button[type="submit"]')].find(b => !b.disabled);
        if (sub) { sub.click(); return { ok: true, msg: 'clicked-submit' }; }
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
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
        const msgs = document.querySelectorAll('[class*="markdown"], [class*="message-content"], [class*="assistant"]');
        if (msgs.length) {
          const last = msgs[msgs.length - 1];
          const text = (last.innerText || '').trim();
          if (text && text.length > 2) return text;
        }
        return '';
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
