import { cli, Strategy } from '@jackwener/opencli/registry';
export const readCommand = cli({
    site: 'discord-app',
    name: 'read',
    description: 'Read recent messages from the active Discord channel',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'count', required: false, help: 'Number of messages to read (default: 20)', default: '20' },
    ],
    columns: ['Author', 'Time', 'Message'],
    func: async (page, kwargs) => {
        const count = parseInt(kwargs.count, 10) || 20;
        const messages = await page.evaluate(`
      (function(limit) {
        const results = [];
        // Discord renders messages in list items with id starting with "chat-messages-"
        const msgNodes = document.querySelectorAll('[id^="chat-messages-"] > div, [class*="messageListItem"]');
        
        const slice = Array.from(msgNodes).slice(-limit);
        
        slice.forEach(node => {
          const authorEl = node.querySelector('[class*="username"], [class*="headerText"] span');
          const timeEl = node.querySelector('time');
          const contentEl = node.querySelector('[id^="message-content-"], [class*="messageContent"]');
          
          if (contentEl) {
            results.push({
              Author: authorEl ? authorEl.textContent.trim() : '—',
              Time: timeEl ? timeEl.getAttribute('datetime') || timeEl.textContent.trim() : '',
              Message: (contentEl.textContent || '').trim().substring(0, 300),
            });
          }
        });
        
        return results;
      })(${count})
    `);
        if (messages.length === 0) {
            return [{ Author: 'System', Time: '', Message: 'No messages found in the current channel.' }];
        }
        return messages;
    },
});
