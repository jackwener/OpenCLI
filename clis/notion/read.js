import { cli, Strategy } from '@jackwener/opencli/registry';
export const readCommand = cli({
    site: 'notion',
    name: 'read',
    description: 'Read the content of the currently open Notion page',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Title', 'Content'],
    func: async (page) => {
        const result = await page.evaluate(`
      (function() {
        // Get the page title
        const titleEl = document.querySelector('[data-block-id] [placeholder="Untitled"], .notion-page-block .notranslate, h1.notion-title, [class*="title"]');
        const title = titleEl ? (titleEl.textContent || '').trim() : document.title;
        
        // Get the page content — Notion renders blocks in a frame
        const frame = document.querySelector('.notion-page-content, [class*="page-content"], .layout-content, main');
        const content = frame ? (frame.innerText || frame.textContent || '').trim() : '';
        
        return { title, content };
      })()
    `);
        return [{
                Title: result.title || 'Untitled',
                Content: result.content || '(empty page)',
            }];
    },
});
