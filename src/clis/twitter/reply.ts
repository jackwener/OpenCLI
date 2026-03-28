import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'twitter',
  name: 'reply',
  description: 'Reply to a specific tweet',
  domain: 'x.com',
  strategy: Strategy.UI, // Uses the UI directly to input and click post
  browser: true,
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'The URL of the tweet to reply to' },
    { name: 'text', type: 'string', required: true, positional: true, help: 'The text content of your reply' },
  ],
  columns: ['status', 'message', 'text'],
  func: async (page: IPage | null, kwargs: any) => {
    if (!page) throw new CommandExecutionError('Browser session required for twitter reply');

    // 1. Navigate to the tweet page
    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="primaryColumn"]' });

    // 2. Automate typing the reply and clicking reply
    const result = await page.evaluate(`(async () => {
        try {
            // Find the reply text area on the tweet page. 
            // The placeholder is usually "Post your reply"
            const box = document.querySelector('[data-testid="tweetTextarea_0"]');
            if (box) {
                box.focus();
                document.execCommand('insertText', false, ${JSON.stringify(kwargs.text)});
            } else {
                return { ok: false, message: 'Could not find the reply text area. Are you logged in?' };
            }
            
            // Wait for React state to register the input and enable the button
            await new Promise(r => setTimeout(r, 1000));
            
            // Find the Reply button. It usually shares the same test id tweetButtonInline in this context
            const btn = document.querySelector('[data-testid="tweetButtonInline"]');
            if (btn && !btn.disabled) {
                btn.click();
                return { ok: true, message: 'Reply posted successfully.' };
            } else {
                return { ok: false, message: 'Reply button is disabled or not found.' };
            }
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);

    if (result.ok) {
        await page.wait(3); // Wait for network submission to complete
    }

    return [{
        status: result.ok ? 'success' : 'failed',
        message: result.message,
        text: kwargs.text
    }];
  }
});
