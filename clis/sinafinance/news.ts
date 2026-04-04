/**
 * Sina Finance 7x24 live news feed.
 *
 * Uses the public CJ API — no key or browser required.
 * https://app.cj.sina.com.cn/api/news/pc
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

// User-facing type (0-9) → Sina API tag ID
const TYPE_MAP = [
  0,   // 0: 全部
  10,  // 1: A股
  1,   // 2: 宏观
  3,   // 3: 公司
  4,   // 4: 数据
  5,   // 5: 市场
  102, // 6: 国际
  6,   // 7: 观点
  6,   // 8: 央行
  8,   // 9: 其它
] as const;

interface SinaNewsItem {
  id?: string;
  create_time?: string;
  rich_text?: string;
  view_num?: number;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

cli({
  site: 'sinafinance',
  name: 'news',
  description: '新浪财经 7x24 小时实时快讯',
  domain: 'app.cj.sina.com.cn',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Max results (max 50)' },
    { name: 'type', type: 'int', default: 0, help: 'News type: 0=全部 1=A股 2=宏观 3=公司 4=数据 5=市场 6=国际 7=观点 8=央行 9=其它' },
  ],
  columns: ['id', 'time', 'content', 'views'],
  func: async (_page, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit), 50));
    const apiTag = TYPE_MAP[args.type as number] ?? 0;

    const params = new URLSearchParams({
      page: '1',
      size: String(limit),
      tag: String(apiTag),
    });

    const res = await fetch(`https://app.cj.sina.com.cn/api/news/pc?${params}`);
    if (!res.ok) {
      throw new CliError('FETCH_ERROR', `Sina Finance API HTTP ${res.status}`, 'Check your network connection');
    }
    const json = await res.json() as { result?: { data?: { feed?: { list?: SinaNewsItem[] } } } };
    const list = json?.result?.data?.feed?.list ?? [];

    if (!list.length) {
      throw new CliError('NOT_FOUND', 'No news found', 'Try a different type or increase limit');
    }

    return list.map((item) => ({
      id: item.id ?? '',
      time: item.create_time ?? '',
      content: stripHtml(item.rich_text ?? ''),
      views: item.view_num ?? 0,
    }));
  },
});
