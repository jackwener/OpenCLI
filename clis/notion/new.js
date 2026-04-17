import { cli, Strategy } from '@jackwener/opencli/registry';
export const newCommand = cli({
    site: 'notion',
    name: 'new',
    description: 'Create a new page in Notion',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'title', required: false, positional: true, help: 'Page title (optional)' },
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const title = kwargs.title;
        // Cmd+N creates a new page in Notion
        const isMac = process.platform === 'darwin';
        await page.pressKey(isMac ? 'Meta+N' : 'Control+N');
        await page.wait(1);
        // If title is provided, type it into the title field
        if (title) {
            await page.evaluate(`
        (function(t) {
          const titleEl = document.querySelector('[placeholder="Untitled"], [data-content-editable-leaf] [placeholder]');
          if (titleEl) {
            titleEl.focus();
            document.execCommand('insertText', false, t);
          }
        })(${JSON.stringify(title)})
      `);
            await page.wait(0.5);
        }
        return [{ Status: title ? `Created page: ${title}` : 'New blank page created' }];
    },
});
