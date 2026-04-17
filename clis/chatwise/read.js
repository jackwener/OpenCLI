import { cli, Strategy } from '@jackwener/opencli/registry';
export const readCommand = cli({
    site: 'chatwise',
    name: 'read',
    description: 'Read the current ChatWise conversation history',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Content'],
    func: async (page) => {
        const content = await page.evaluate(`
      (function() {
        // Try common chat message selectors
        const selectors = [
          '[data-message-id]',
          '[class*="message"]',
          '[class*="chat-item"]',
          '[class*="bubble"]',
          '[role="log"] > *',
        ];
        
        for (const sel of selectors) {
          const nodes = document.querySelectorAll(sel);
          if (nodes.length > 0) {
            return Array.from(nodes).map(n => (n.innerText || n.textContent).trim()).filter(Boolean).join('\\n\\n---\\n\\n');
          }
        }
        
        // Fallback: main content area
        const main = document.querySelector('main, [role="main"], [class*="chat-container"], [class*="conversation"]');
        if (main) return main.innerText || main.textContent;
        
        return document.body.innerText;
      })()
    `);
        return [{ Content: content }];
    },
});
