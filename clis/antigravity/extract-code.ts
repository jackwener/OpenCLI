import { cli, Strategy } from '../../registry.js';

export const extractCodeCommand = cli({
  site: 'antigravity',
  name: 'extract-code',
  description: 'Extract multi-line code blocks from the current Antigravity conversation',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['code'],
  func: async (page) => {
    const blocks = await page.evaluate(`
      async () => {
        // Find standard pre/code blocks
        let elements = Array.from(document.querySelectorAll('pre code'));
        
        // Fallback to Monaco editor content inside the UI
        if (elements.length === 0) {
          elements = Array.from(document.querySelectorAll('.monaco-editor'));
        }
        
        // Generic fallback to any code tag that spans multiple lines
        if (elements.length === 0) {
          elements = Array.from(document.querySelectorAll('code')).filter(c => c.innerText.includes('\\n'));
        }
        
        return elements.map(el => el.innerText).filter(text => text.trim().length > 0);
      }
    `);
    
    return blocks.map((code: string) => ({ code }));
  },
});
