import * as fs from 'node:fs';
import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

export const exportCommand = cli({
  site: 'notion',
  name: 'export',
  description: 'Export the current Notion page as Markdown',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'output', required: false,  help: 'Output file (default: /tmp/notion-export.md)' },
  ],
  columns: ['Status', 'File'],
  func: async (page: IPage, kwargs: any) => {
    const outputPath = (kwargs.output as string) || '/tmp/notion-export.md';

    const result = await page.evaluate(`
      (function() {
        const titleEl = document.querySelector('[data-block-id] [placeholder="Untitled"], h1.notion-title, [class*="title"]');
        const title = titleEl ? (titleEl.textContent || '').trim() : document.title;
        
        const frame = document.querySelector('.notion-page-content, [class*="page-content"], main');
        const content = frame ? (frame.innerText || '').trim() : document.body.innerText;
        
        return { title, content };
      })()
    `);

    const md = `# ${result.title}\n\n${result.content}`;
    fs.writeFileSync(outputPath, md);

    return [{ Status: 'Success', File: outputPath }];
  },
});
