import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

function buildDeleteScript(messageId) {
    return `(async () => {
      try {
          const messageId = ${JSON.stringify(messageId)};

          // Find the message element by its ID attribute (format: chat-messages-{channelId}-{messageId})
          const msgEl = document.querySelector('[id$="-' + messageId + '"]');
          if (!msgEl) {
              return { ok: false, message: 'Could not find a message with ID ' + messageId + ' in the current channel.' };
          }

          // Find the closest list item wrapper that Discord uses for messages
          const listItem = msgEl.closest('[id^="chat-messages-"]') || msgEl;

          // Hover over the message to reveal the action toolbar
          listItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          listItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          await new Promise(r => setTimeout(r, 500));

          // Look for the "More" button in the message toolbar
          // Discord shows a toolbar with buttons when hovering over a message
          const toolbar = listItem.querySelector('[class*="toolbar"]') ||
              document.querySelector('[id^="message-actions-"]');
          if (!toolbar) {
              return { ok: false, message: 'Could not find the message action toolbar. Try scrolling so the message is fully visible.' };
          }

          const buttons = Array.from(toolbar.querySelectorAll('button, [role="button"], div[class*="button"]'));
          const moreBtn = buttons.find(btn => {
              const label = (btn.getAttribute('aria-label') || '').toLowerCase();
              return label === 'more' || label.includes('more');
          });
          if (!moreBtn) {
              return { ok: false, message: 'Could not find the "More" button on the message toolbar.' };
          }

          moreBtn.click();
          await new Promise(r => setTimeout(r, 500));

          // Find "Delete Message" in the context menu
          const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [id*="message-actions"]'));
          const deleteItem = menuItems.find(item => {
              const text = (item.textContent || '').trim().toLowerCase();
              return text.includes('delete message') || text === 'delete';
          });

          if (!deleteItem) {
              // Close the menu by pressing Escape
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              return { ok: false, message: 'No "Delete Message" option found. You may not have permission to delete this message.' };
          }

          deleteItem.click();
          await new Promise(r => setTimeout(r, 500));

          // Confirm deletion in the modal dialog
          const confirmBtn = document.querySelector('[type="submit"], button[class*="colorRed"], button[class*="danger"]');
          if (!confirmBtn) {
              return { ok: false, message: 'Delete confirmation dialog did not appear.' };
          }

          confirmBtn.click();
          return { ok: true, message: 'Message ' + messageId + ' deleted successfully.' };
      } catch (e) {
          return { ok: false, message: e.toString() };
      }
  })()`;
}

cli({
    site: 'discord-app',
    name: 'delete',
    access: 'write',
    description: 'Delete a message by its ID in the active Discord channel',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        {
            name: 'message_id',
            type: 'string',
            required: true,
            positional: true,
            help: 'The ID of the message to delete (visible via Developer Mode or the read command)',
        },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for discord-app delete');
        const messageId = kwargs.message_id;
        if (!/^\d+$/.test(messageId)) {
            throw new CommandExecutionError(
                `Invalid message ID: "${messageId}". A Discord message ID is a numeric snowflake (e.g. 1234567890123456789).`
            );
        }
        // Wait a moment for the chat to be fully loaded
        await page.wait(0.5);
        const result = await page.evaluate(buildDeleteScript(messageId));
        if (result.ok) {
            await page.wait(1);
        }
        return [{
            status: result.ok ? 'success' : 'failed',
            message: result.message,
        }];
    },
});

export const __test__ = {
    buildDeleteScript,
};
