import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt, requireNonEmptyQuery } from '../_shared/common.js';
import { extractLawResults, navigateViaVueRouter } from './shared.js';

cli({
    site: 'gov-law',
    name: 'search',
    access: 'read',
    description: '国家法律法规数据库搜索',
    domain: 'flk.npc.gov.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'status', 'publish_date', 'type', 'department'],
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        const query = requireNonEmptyQuery(kwargs.query);
        await navigateViaVueRouter(page, { searchWord: query });

        const encodedQuery = JSON.stringify(query);
        await page.evaluate(`
      (async () => {
        const input = document.querySelector('.el-input__inner');
        if (input && !input.value) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${encodedQuery});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 300));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        }
      })()
    `);
        await page.wait(3);
        return extractLawResults(page, limit);
    },
});
