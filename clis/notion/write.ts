import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const writeCommand = cli({
  site: 'notion',
  name: 'write',
  description: 'Append text content to the currently open Notion page',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'text', required: true, positional: true, help: 'Text to append to the page' }],
  columns: ['Status'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;

    // Focus the page body and move to the end
    await page.evaluate(`
      (function(text) {
        // Find the editable area in Notion
        const editables = document.querySelectorAll('.notion-page-content [contenteditable="true"], [class*="page-content"] [contenteditable="true"]');
        let target = editables.length > 0 ? editables[editables.length - 1] : null;
        
        if (!target) {
          // Fallback: just find any contenteditable
          const all = document.querySelectorAll('[contenteditable="true"]');
          target = all.length > 0 ? all[all.length - 1] : null;
        }
        
        if (!target) throw new Error('Could not find editable area in Notion page');
        
        target.focus();
        // Move to end
        const sel = window.getSelection();
        sel.selectAllChildren(target);
        sel.collapseToEnd();
        
        document.execCommand('insertText', false, text);
      })(${JSON.stringify(text)})
    `);

    await page.wait(0.5);

    return [{ Status: 'Text appended successfully' }];
  },
});
