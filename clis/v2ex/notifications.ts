/**
 * V2EX Notifications adapter.
 */
import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'v2ex',
  name: 'notifications',
  description: 'V2EX 获取提醒 (回复/由于)',
  domain: 'www.v2ex.com',
  strategy: Strategy.COOKIE,
  browser: true,

  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of notifications' }
  ],
  columns: ['type', 'content', 'time'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser page required');

    if (process.env.OPENCLI_VERBOSE) {
      console.error('[opencli:v2ex] Navigating to /notifications');
    }
    await page.goto('https://www.v2ex.com/notifications');
    await new Promise(r => setTimeout(r, 1500)); // waitForLoadState doesn't always work robustly
    
    // Evaluate DOM to extract notifications
    const data = await page.evaluate(`
      async () => {
        const items = Array.from(document.querySelectorAll('#Main .box .cell[id^="n_"]'));
        return items.map(item => {
          let type = '通知';
          let time = '';
          
          // determine type based on text content
          const text = item.textContent || '';
          if (text.includes('回复了你')) type = '回复';
          else if (text.includes('感谢了你')) type = '感谢';
          else if (text.includes('收藏了你')) type = '收藏';
          else if (text.includes('提及你')) type = '提及';

          const timeEl = item.querySelector('.snow');
          if (timeEl) {
            time = timeEl.textContent?.trim() || '';
          }

          // payload contains the actual reply text if any
          let payload = '';
          const payloadEl = item.querySelector('.payload');
          if (payloadEl) {
            payload = payloadEl.textContent?.trim() || '';
          }

          // fallback to full text cleaning if no payload (e.g. for favorites/thanks)
          let content = payload;
          if (!content) {
            content = text.replace(/\\s+/g, ' ').trim();
            // strip out time from content if present
            if (time && content.includes(time)) {
              content = content.replace(time, '').trim();
            }
          }

          return { type, content, time };
        });
      }
    `);

    if (!Array.isArray(data)) throw new CommandExecutionError('Failed to parse notifications data');

    const limit = kwargs.limit || 20;
    return data.slice(0, limit);
  },
});
