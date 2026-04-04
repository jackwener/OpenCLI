import { cli, Strategy } from '../../src/registry.js';
import { EmptyResultError } from '../../src/errors.js';
import type { IPage } from '../../src/types.js';

export const readCommand = cli({
  site: 'cursor',
  name: 'read',
  description: 'Read the current Cursor chat/composer conversation history',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  columns: ['Role', 'Text'],
  func: async (page: IPage) => {
    const history = await page.evaluate(`
      (function() {
        const messages = Array.from(document.querySelectorAll('[data-message-role]'));
        
        if (messages.length === 0) {
            return [];
        }

        return messages.map(msg => {
            const role = msg.getAttribute('data-message-role');
            let text = '';
            
            // Try to get structured markdown root for AI, or lexical text for human
            const markdownRoot = msg.querySelector('.markdown-root');
            if (markdownRoot) {
                text = markdownRoot.innerText || markdownRoot.textContent;
            } else {
                text = msg.innerText || msg.textContent;
            }

            return {
                Role: role === 'human' ? 'User' : 'Assistant',
                Text: text.trim()
            };
        });
      })()
    `);

    if (!history || history.length === 0) {
      throw new EmptyResultError('cursor read', 'No conversation history found in Cursor.');
    }

    return history;
  },
});
