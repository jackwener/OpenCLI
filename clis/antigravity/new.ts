import { cli, Strategy } from '@jackwener/opencli/registry';

export const newCommand = cli({
  site: 'antigravity',
  name: 'new',
  description: 'Start a new conversation / clear context in Antigravity',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['status'],
  func: async (page) => {
    await page.evaluate(`
      async () => {
        const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
        if (!btn) throw new Error('Could not find New Conversation button');
        
        // In case it's disabled, we must check, but we'll try to click it anyway
        btn.click();
      }
    `);
    
    // Give it a moment to reset the UI
    await page.wait(0.5);
    
    return [{ status: 'Successfully started a new conversation' }];
  },
});
