import { cli, Strategy } from '../../registry.js';

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

async function searchSinaBlog(keyword: string, limit: number): Promise<any[]> {
  const url = new URL('https://search.sina.com.cn/api/search');
  url.searchParams.set('q', keyword);
  url.searchParams.set('tp', 'mix');
  url.searchParams.set('sort', '0');
  url.searchParams.set('page', '1');
  url.searchParams.set('size', String(Math.max(limit, 10)));
  url.searchParams.set('from', 'search_result');

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`Sina blog search failed: HTTP ${resp.status}`);

  const data = await resp.json() as { data?: { list?: any[] } };
  const list = Array.isArray(data?.data?.list) ? data.data.list : [];
  return list
    .filter((item) => normalize(item?.url).includes('blog.sina.com.cn/s/blog_'))
    .slice(0, limit)
    .map((item, index) => ({
      rank: index + 1,
      title: normalize(stripHtml(item?.title || '')),
      author: normalize(item?.media_show || item?.author),
      date: normalize(item?.time || item?.dataTime),
      description: normalize(item?.intro || item?.searchSummary).slice(0, 150),
      url: normalize(item?.url),
    }));
}

cli({
  site: 'sinablog',
  name: 'search',
  description: '搜索新浪博客文章（通过新浪搜索）',
  domain: 'blog.sina.com.cn',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'keyword', required: true, positional: true, help: '搜索关键词' },
    { name: 'limit', type: 'int', default: 20, help: '返回的文章数量' },
  ],
  columns: ['rank', 'title', 'author', 'date', 'description', 'url'],
  func: async (_page, args) => searchSinaBlog(args.keyword, Math.max(1, Math.min(Number(args.limit) || 20, 50))),
});
