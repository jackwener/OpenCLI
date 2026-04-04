import * as fs from 'node:fs';
import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

function makeExportCommand(site: string, readSelector: string) {
  return cli({
    site,
    name: 'export',
    description: `Export the current ${site} conversation to a Markdown file`,
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
      { name: 'output', required: false,  help: `Output file (default: /tmp/${site}-export.md)` },
    ],
    columns: ['Status', 'File', 'Messages'],
    func: async (page: IPage, kwargs: any) => {
      const outputPath = (kwargs.output as string) || `/tmp/${site}-export.md`;

      const md = await page.evaluate(`
        (function() {
          const selectors = ${JSON.stringify(readSelector)}.split(',');
          let messages = [];
          
          for (const sel of selectors) {
            const nodes = document.querySelectorAll(sel.trim());
            if (nodes.length > 0) {
              messages = Array.from(nodes).map(n => n.innerText || n.textContent);
              break;
            }
          }

          if (messages.length === 0) {
            const main = document.querySelector('main, [role="main"], .messages-list, [role="log"]');
            if (main) messages = [main.innerText || main.textContent];
          }

          if (messages.length === 0) messages = [document.body.innerText];
          
          return messages.map((m, i) => '## Message ' + (i + 1) + '\\n\\n' + m.trim()).join('\\n\\n---\\n\\n');
        })()
      `);

      fs.writeFileSync(outputPath, `# ${site} Conversation Export\\n\\n` + md);

      return [
        {
          Status: 'Success',
          File: outputPath,
          Messages: md.split('## Message').length - 1,
        },
      ];
    },
  });
}

export const cursorExport = makeExportCommand('cursor', '[data-message-role]');
