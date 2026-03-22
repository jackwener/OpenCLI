import { cli, Strategy } from '../../registry.js';

export const readCommand = cli({
  site: 'antigravity',
  name: 'read',
  description: 'Read the latest chat messages from Antigravity AI',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'last', help: 'Number of recent messages to read (not fully implemented due to generic structure, currently returns full history text or latest chunk)' }
  ],
  columns: ['role', 'content'],
  func: async (page, kwargs) => {
    // We execute a script inside Antigravity's Chromium environment to extract the text 
    // of the entire conversation pane.
    const rawText = await page.evaluate(`
      async () => {
        const container = document.getElementById('conversation');
        if (!container) throw new Error('Could not find conversation container');
        
        // Extract the full visible text of the conversation
        // In Electron/Chromium, innerText preserves basic visual line breaks nicely
        return container.innerText;
      }
    `);
    
    // We can do simple heuristic parsing based on typical visual markers if needed.
    // For now, we return the entire text blob, or just the last 2000 characters if it's too long.
    const cleanText = String(rawText).trim();
    return [{ 
      role: 'history', 
      content: cleanText 
    }];
  },
});
