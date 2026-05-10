import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, selectorError } from '@jackwener/opencli/errors';
import { conversationSelectionArgs, openCodexConversation } from './sidebar.js';
export const askCommand = cli({
    site: 'codex',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to the current or selected Codex conversation and wait for the AI response',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', required: true, positional: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', required: false, help: 'Max seconds to wait for response (default: 60)', default: 60 },
        ...conversationSelectionArgs,
    ],
    columns: ['Role', 'Project', 'Conversation', 'Text'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        const timeout = kwargs.timeout;
        if (!Number.isInteger(timeout) || timeout < 1) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }
        const selected = await openCodexConversation(page, kwargs);
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
                { Role: 'User', Project: selected?.project || '', Conversation: selected?.conversation || '', Text: text },
                { Role: 'System', Project: selected?.project || '', Conversation: selected?.conversation || '', Text: `No response within ${timeout}s. The agent may still be working.` },
            ];
        }
        return [
            { Role: 'User', Project: selected?.project || '', Conversation: selected?.conversation || '', Text: text },
            { Role: 'Assistant', Project: selected?.project || '', Conversation: selected?.conversation || '', Text: response },
        ];
    },
});
