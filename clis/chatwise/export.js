import * as fs from 'node:fs';
import { cli, Strategy } from '@jackwener/opencli/registry';
export const exportCommand = cli({
    site: 'chatwise',
    name: 'export',
    description: 'Export the current ChatWise conversation to a Markdown file',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'output', required: false, help: 'Output file (default: /tmp/chatwise-export.md)' },
    ],
    columns: ['Status', 'File', 'Messages'],
    func: async (page, kwargs) => {
        const outputPath = kwargs.output || '/tmp/chatwise-export.md';
        const md = await page.evaluate(`
      (function() {
        const selectors = [
          '[data-message-id]',
          '[class*="message"]',
          '[class*="chat-item"]',
          '[class*="bubble"]',
        ];
        
        for (const sel of selectors) {
          const nodes = document.querySelectorAll(sel);
          if (nodes.length > 0) {
            return Array.from(nodes).map((n, i) => '## Message ' + (i + 1) + '\\n\\n' + (n.innerText || n.textContent).trim()).join('\\n\\n---\\n\\n');
          }
        }
        
        const main = document.querySelector('main, [role="main"], [class*="chat-container"]');
        if (main) return main.innerText || main.textContent;
        return document.body.innerText;
      })()
    `);
        fs.writeFileSync(outputPath, '# ChatWise Conversation Export\\n\\n' + md);
        return [
            {
                Status: 'Success',
                File: outputPath,
                Messages: md.split('## Message').length - 1,
            },
        ];
    },
});
