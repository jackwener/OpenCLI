import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

export const readCommand = cli({
  site: 'codex',
  name: 'read',
  description: 'Read the contents of the current Codex conversation thread',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Content'],
  func: async (page: IPage) => {
    const historyText = await page.evaluate(`
      (function() {
        const turns = Array.from(document.querySelectorAll('[data-content-search-turn-key]'));
        if (turns.length > 0) {
            return turns.map(t => t.innerText || t.textContent).join('\\n\\n---\\n\\n');
        }
        
        const threadContainer = document.querySelector('[role="log"], [data-testid="conversation"], .thread-container, .messages-list, main');
        
        if (threadContainer) {
          return threadContainer.innerText || threadContainer.textContent;
        }
        
        return document.body.innerText;
      })()
    `);

    return [
      {
        Content: historyText,
      },
    ];
  },
});
