import { cli, Strategy } from '@jackwener/opencli/registry';
import { conversationSelectionArgs, openCodexConversation } from './sidebar.js';
export const readCommand = cli({
    site: 'codex',
    name: 'read',
    access: 'read',
    description: 'Read the contents of the current or selected Codex conversation thread',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        ...conversationSelectionArgs,
    ],
    columns: ['Project', 'Conversation', 'Content'],
    func: async (page, kwargs) => {
        const selected = await openCodexConversation(page, kwargs);
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
                Project: selected?.project || '',
                Conversation: selected?.conversation || '',
                Content: historyText,
            },
        ];
    },
});
