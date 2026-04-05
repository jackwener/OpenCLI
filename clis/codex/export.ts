import * as fs from 'node:fs';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';

export const exportCommand = cli({
  site: 'codex',
  name: 'export',
  description: 'Export the current Codex conversation to a Markdown file',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'output', required: false,  help: 'Output file (default: /tmp/codex-export.md)' },
  ],
  columns: ['Status', 'File', 'Messages'],
  func: async (page: IPage, kwargs: any) => {
    const outputPath = (kwargs.output as string) || '/tmp/codex-export.md';

    const md = await page.evaluate(`
      (function() {
        const turns = document.querySelectorAll('[data-content-search-turn-key]');
        if (turns.length > 0) {
          return Array.from(turns).map((t, i) => '## Turn ' + (i + 1) + '\\n\\n' + (t.innerText || t.textContent).trim()).join('\\n\\n---\\n\\n');
        }
        
        const main = document.querySelector('main, [role="main"], [role="log"]');
        if (main) return main.innerText || main.textContent;
        return document.body.innerText;
      })()
    `);

    fs.writeFileSync(outputPath, '# Codex Conversation Export\\n\\n' + md);

    return [
      {
        Status: 'Success',
        File: outputPath,
        Messages: md.split('## Turn').length - 1,
      },
    ];
  },
});
