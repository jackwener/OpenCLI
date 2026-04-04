import { CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

cli({
  site: 'twitter',
  name: 'reply-dm',
  description: 'Send a message to recent DM conversations',
  domain: 'x.com',
  strategy: Strategy.UI,
  browser: true,
  timeoutSeconds: 600, // 10 min — batch operation
  args: [
    { name: 'text', type: 'string', required: true, positional: true, help: 'Message text to send (e.g. "我的微信 wxkabi")' },
    { name: 'max', type: 'int', required: false, default: 20, help: 'Maximum number of conversations to reply to (default: 20)' },
    { name: 'skip-replied', type: 'boolean', required: false, default: true, help: 'Skip conversations where you already sent the same text (default: true)' },
  ],
  columns: ['index', 'status', 'user', 'message'],
  func: async (page: IPage | null, kwargs: any) => {
    if (!page) throw new CommandExecutionError('Browser session required for twitter reply-dm');

    const messageText: string = kwargs.text;
    const maxSend: number = kwargs.max ?? 20;
    const skipReplied: boolean = kwargs['skip-replied'] !== false;
    const results: Array<{ index: number; status: string; user: string; message: string }> = [];
    let sentCount = 0;

    // Step 1: Navigate to messages to get conversation list
    await page.goto('https://x.com/messages');
    await page.wait({ selector: '[data-testid="primaryColumn"]' });

    // Step 2: Collect conversations with scroll-to-load
    const needed = maxSend + 10; // extra buffer for skips
    const convList = await page.evaluate(`(async () => {
      try {
        // Wait for initial items
        let attempts = 0;
        while (attempts < 10) {
          const items = document.querySelectorAll('[data-testid^="dm-conversation-item-"], [data-testid="conversation"]');
          if (items.length > 0) break;
          await new Promise(r => setTimeout(r, 1000));
          attempts++;
        }

        // Scroll to load more conversations
        const needed = ${needed};
        const seenIds = new Set();
        let noNewCount = 0;

        for (let scroll = 0; scroll < 30; scroll++) {
          const items = Array.from(document.querySelectorAll('[data-testid^="dm-conversation-item-"], [data-testid="conversation"]'));
          items.forEach(el => seenIds.add(el.getAttribute('data-testid')));

          if (seenIds.size >= needed) break;

          // Find the scrollable container and scroll it
          const scrollContainer = document.querySelector('[data-testid="dm-inbox-panel"]') ||
                                  items[items.length - 1]?.closest('[class*="scroll"]') ||
                                  items[items.length - 1]?.parentElement;
          if (scrollContainer) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
          }
          // Also try scrolling the last item into view
          if (items.length > 0) {
            items[items.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
          }

          await new Promise(r => setTimeout(r, 1500));

          // Check if new items appeared
          const newItems = Array.from(document.querySelectorAll('[data-testid^="dm-conversation-item-"], [data-testid="conversation"]'));
          const newIds = new Set(newItems.map(el => el.getAttribute('data-testid')));
          if (newIds.size <= seenIds.size) {
            noNewCount++;
            if (noNewCount >= 3) break; // No more loading after 3 tries
          } else {
            noNewCount = 0;
          }
        }

        // Collect all visible conversations
        const finalItems = Array.from(document.querySelectorAll('[data-testid^="dm-conversation-item-"], [data-testid="conversation"]'));
        const conversations = finalItems.map((item, idx) => {
          const testId = item.getAttribute('data-testid') || '';
          const text = item.innerText || '';
          const lines = text.split('\\n').filter(l => l.trim());
          const user = lines[0] || 'Unknown';
          const match = testId.match(/dm-conversation-item-(.+)/);
          const convId = match ? match[1].replace(':', '-') : '';
          const link = item.querySelector('a[href*="/messages/"]');
          const href = link ? link.href : '';
          return { idx, user, convId, href, preview: text.substring(0, 100) };
        });

        return { ok: true, conversations, total: conversations.length };
      } catch(e) {
        return { ok: false, error: String(e), conversations: [], total: 0 };
      }
    })()`);

    if (!convList?.ok || !convList.conversations?.length) {
      return [{ index: 1, status: 'info', user: 'System', message: 'No conversations found' }];
    }

    const conversations = convList.conversations;

    // Step 3: Iterate through conversations and send message
    for (const conv of conversations) {
      if (sentCount >= maxSend) break;

      const convUrl = conv.convId
        ? `https://x.com/messages/${conv.convId}`
        : conv.href;

      if (!convUrl) continue;

      await page.goto(convUrl);
      await page.wait(3);

      const sendResult = await page.evaluate(`(async () => {
        try {
          const messageText = ${JSON.stringify(messageText)};
          const skipReplied = ${skipReplied};

          // Get username from conversation
          const dmHeader = document.querySelector('[data-testid="DmActivityContainer"] [dir="ltr"] span') ||
                           document.querySelector('[data-testid="conversation-header"]') ||
                           document.querySelector('[data-testid="DmActivityContainer"] h2');
          const username = dmHeader ? dmHeader.innerText.trim().split('\\\\n')[0] : '${conv.user}';

          // Check if we already sent this message
          if (skipReplied) {
            const chatArea = document.querySelector('[data-testid="DmScrollerContainer"]') ||
                             document.querySelector('main');
            const chatText = chatArea ? chatArea.innerText : '';
            if (chatText.includes(messageText)) {
              return { status: 'skipped', user: username, message: 'Already sent this message' };
            }
          }

          // Find the text input
          const input = document.querySelector('[data-testid="dmComposerTextInput"]');
          if (!input) {
            return { status: 'error', user: username, message: 'No message input found' };
          }

          // Focus and type into the DraftEditor
          input.focus();
          await new Promise(r => setTimeout(r, 300));
          document.execCommand('insertText', false, messageText);
          await new Promise(r => setTimeout(r, 500));

          // Click send button
          const sendBtn = document.querySelector('[data-testid="dmComposerSendButton"]');
          if (!sendBtn) {
            return { status: 'error', user: username, message: 'No send button found' };
          }

          sendBtn.click();
          await new Promise(r => setTimeout(r, 1500));

          return { status: 'sent', user: username, message: 'Message sent: ' + messageText };
        } catch(e) {
          return { status: 'error', user: 'system', message: String(e) };
        }
      })()`);

      if (sendResult?.status === 'sent') {
        sentCount++;
        results.push({
          index: sentCount,
          status: 'sent',
          user: sendResult.user || conv.user,
          message: sendResult.message,
        });
      } else if (sendResult?.status === 'skipped') {
        results.push({
          index: results.length + 1,
          status: 'skipped',
          user: sendResult.user || conv.user,
          message: sendResult.message,
        });
      }

      await page.wait(1);
    }

    if (results.length === 0) {
      results.push({ index: 0, status: 'info', user: 'System', message: 'No conversations processed' });
    }

    return results;
  }
});
