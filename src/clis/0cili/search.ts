import { cli, Strategy } from '../../registry.js';
import { CommandExecutionError, EmptyResultError } from '../../errors.js';

cli({
  site: '0cili',
  name: 'search',
  description: '搜索磁力链接资源',
  domain: '0cili.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    {
      name: 'query',
      required: true,
      positional: true,
      help: '搜索关键词',
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      help: '返回结果数量（默认20，最大100）',
    },
  ],
  columns: ['rank', 'title', 'size', 'files', 'hot', 'magnet'],

  func: async (page, kwargs) => {
    const query = String(kwargs.query || '').trim();
    const limit = Math.min(Math.max(Number(kwargs.limit || 20), 1), 100);

    if (!query) {
      throw new CommandExecutionError('搜索关键词不能为空');
    }

    const url = `https://0cili.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.wait(3);

    // 滚动页面加载更多结果
    await page.autoScroll({ times: 3, delayMs: 1000 });

    const results = await page.evaluate(
      (maxResults: number) => {
        const rows = document.querySelectorAll('table tbody tr');
        const items: Array<Record<string, string>> = [];

        rows.forEach((row, index) => {
          if (index >= maxResults) return;

          const cells = row.querySelectorAll('td');
          if (cells.length < 3) return;

          // 提取标题
          const titleLink = cells[0]?.querySelector('a[href*="/t/"]');
          const title = titleLink?.textContent?.trim() || '';

          // 提取磁力链接
          const magnetLink = row.querySelector('a[href^="magnet:"]');
          const magnet = magnetLink?.href || '';

          // 文件大小和数量
          const sizeText = Array.from(cells)
            .map((c) => c.textContent?.trim() || '')
            .find((t) => /\d+(\.\d+)?\s*[GMK]B?/i.test(t)) || '';

          const filesText = Array.from(cells)
            .map((c) => c.textContent?.trim() || '')
            .find((t) => /\d+\s*个?文件/.test(t)) || '';

          // 热度/日期
          const hotText = Array.from(cells)
            .map((c) => c.textContent?.trim() || '')
            .find((t) => /\d{4}[-/]\d{2}[-/]\d{2}/.test(t)) || '';

          if (title || magnet) {
            items.push({
              rank: String(index + 1),
              title: title.substring(0, 200),
              size: sizeText,
              files: filesText,
              hot: hotText,
              magnet: magnet,
            });
          }
        });

        return { total: rows.length, items };
      },
      limit,
    );

    if (!results?.items?.length) {
      const pageText = await page.evaluate(() => document.body.innerText);
      if (pageText.includes('登录') || pageText.includes('login')) {
        throw new CommandExecutionError(
          '0cili 需要登录，请在 Chrome 中登录后重试',
        );
      }
      throw new EmptyResultError('0cili search', `未找到"${query}"的相关结果`);
    }

    return results.items;
  },
});
