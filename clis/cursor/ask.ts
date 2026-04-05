import { cli, Strategy } from '@jackwener/opencli/registry';
import { SelectorError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

export const askCommand = cli({
  site: 'cursor',
  name: 'ask',
  description: 'Send a prompt and wait for the AI response (send + wait + read)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', required: true, positional: true, help: 'Prompt to send' },
    { name: 'timeout', required: false, help: 'Max seconds to wait for response (default: 30)', default: '30' },
  ],
  columns: ['Role', 'Text'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;
    const timeout = parseInt(kwargs.timeout as string, 10) || 30;

    // Count existing messages before sending
    const beforeCount = await page.evaluate(`
      document.querySelectorAll('[data-message-role]').length
    `);

    // Inject text into the active editor and submit
    const injected = await page.evaluate(
      `(function(text) {
        let editor = document.querySelector('.aislash-editor-input, [data-lexical-editor="true"], [contenteditable="true"]');
        if (!editor) return false;
        editor.focus();
        document.execCommand('insertText', false, text);
        return true;
      })(${JSON.stringify(text)})`
    );

    if (!injected) throw new SelectorError('Cursor input element');
    await page.wait(0.5);
    await page.pressKey('Enter');

    // Poll until a new assistant message appears or timeout
    const pollInterval = 2; // seconds
    const maxPolls = Math.ceil(timeout / pollInterval);
    let response = '';

    for (let i = 0; i < maxPolls; i++) {
      await page.wait(pollInterval);

      const result = await page.evaluate(`
        (function(prevCount) {
          const msgs = document.querySelectorAll('[data-message-role]');
          if (msgs.length <= prevCount) return null;
          
          const lastMsg = msgs[msgs.length - 1];
          const role = lastMsg.getAttribute('data-message-role');
          if (role === 'human') return null; // Still waiting for assistant
          
          const root = lastMsg.querySelector('.markdown-root');
          const text = root ? root.innerText : lastMsg.innerText;
          return text ? text.trim() : null;
        })(${beforeCount})
      `);

      if (result) {
        response = result;
        break;
      }
    }

    if (!response) {
      return [
        { Role: 'User', Text: text },
        { Role: 'System', Text: `No response received within ${timeout}s. The AI may still be generating.` },
      ];
    }

    return [
      { Role: 'User', Text: text },
      { Role: 'Assistant', Text: response },
    ];
  },
});
