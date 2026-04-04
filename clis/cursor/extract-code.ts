import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

export const extractCodeCommand = cli({
  site: 'cursor',
  name: 'extract-code',
  description: 'Extract multi-line code blocks from the current Cursor conversation',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Code'],
  func: async (page: IPage) => {
    const blocks = await page.evaluate(`
      (function() {
        // Find standard pre/code blocks
        let elements = Array.from(document.querySelectorAll('pre code, .markdown-root pre'));
        
        // Fallback to Monaco editor content inside the UI
        if (elements.length === 0) {
          elements = Array.from(document.querySelectorAll('.monaco-editor'));
        }
        
        // Generic fallback to any code tag that spans multiple lines
        if (elements.length === 0) {
          elements = Array.from(document.querySelectorAll('code')).filter(c => c.innerText.includes('\\n'));
        }
        
        return elements.map(el => el.innerText || el.textContent || '').filter(text => text.trim().length > 0);
      })()
    `);
    
    if (!blocks || blocks.length === 0) {
      return [{ Code: 'No code blocks found in Cursor.' }];
    }

    return blocks.map((code: string) => ({ Code: code }));
  },
});
