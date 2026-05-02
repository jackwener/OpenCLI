import { cli, Strategy } from '@jackwener/opencli/registry';
import { selectorError } from '@jackwener/opencli/errors';
export const askCommand = cli({
    site: 'codex',
    name: 'ask',
    description: 'Send a prompt and wait for the AI response (send + wait + read)',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', required: true, positional: true, help: 'Prompt to send' },
        { name: 'timeout', required: false, help: 'Max seconds to wait for response (default: 60)', default: '60' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        const timeout = parseInt(kwargs.timeout, 10) || 60;
        // Snapshot the current content length before sending
        const beforeLen = await page.evaluate(`
      (function() {
        const turns = document.querySelectorAll('[data-content-search-turn-key]');
        return turns.length;
      })()
    `);
        // Inject and send
        const injected = await page.evaluate(`
      (function(text) {
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        const composer = editables.length > 0 ? editables[editables.length - 1] : document.querySelector('textarea');
        if (!composer) return false;
        composer.focus();
        document.execCommand('insertText', false, text);
        return true;
      })(${JSON.stringify(text)})
    `);
        if (!injected)
            throw selectorError('Codex input element');
        await page.wait(0.5);
        await page.pressKey('Enter');
        // Poll for new content
        const pollInterval = 3;
        const maxPolls = Math.ceil(timeout / pollInterval);
        let response = '';
        for (let i = 0; i < maxPolls; i++) {
            await page.wait(pollInterval);
            const result = await page.evaluate(`
        (function(prevLen) {
          const turns = document.querySelectorAll('[data-content-search-turn-key]');
          if (turns.length <= prevLen) return null;
          const lastTurn = turns[turns.length - 1];
          const text = lastTurn.innerText || lastTurn.textContent;
          return text ? text.trim() : null;
        })(${beforeLen})
      `);
            if (result) {
                response = result;
                break;
            }
        }
        if (!response) {
            return [
                { Role: 'User', Text: text },
                { Role: 'System', Text: `No response within ${timeout}s. The agent may still be working.` },
            ];
        }
        return [
            { Role: 'User', Text: text },
            { Role: 'Assistant', Text: response },
        ];
    },
});
