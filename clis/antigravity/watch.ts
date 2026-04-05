import { cli, Strategy } from '@jackwener/opencli/registry';

export const watchCommand = cli({
  site: 'antigravity',
  name: 'watch',
  description: 'Stream new chat messages from Antigravity in real-time',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  timeoutSeconds: 86400, // Run for up to 24 hours
  columns: [], // We use direct stdout streaming
  func: async (page) => {
    console.log('Watching Antigravity chat... (Press Ctrl+C to stop)');
    
    let lastLength = 0;
    
    // Loop until process gets killed
    while (true) {
      const text = await page.evaluate(`
        async () => {
          const container = document.getElementById('conversation');
          return container ? container.innerText : '';
        }
      `);
      
      const currentLength = text.length;
      if (currentLength > lastLength) {
        // Delta mode
        const newSegment = text.substring(lastLength);
        if (newSegment.trim().length > 0) {
          process.stdout.write(newSegment);
        }
        lastLength = currentLength;
      } else if (currentLength < lastLength) {
        // The conversation was cleared or updated significantly
        lastLength = currentLength;
        console.log('\\n--- Conversation Cleared/Changed ---\\n');
        process.stdout.write(text);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  },
});
