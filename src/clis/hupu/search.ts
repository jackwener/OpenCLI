import { cli, Strategy } from '../../registry.js';
import { getHupuSearchUrl, readHupuSearchData } from './utils.js';

// 清理HTML标签的函数
function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '').trim();
}

// 解码HTML实体的函数
function decodeHtml(html: string): string {
  if (!html) return '';
  return html.replace(/&nbsp;/g, ' ')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&amp;/g, '&')
             .replace(/&quot;/g, '"')
             .replace(/&#x27;/g, "'");
}

// 搜索结果数据结构
interface SearchResult {
  id: string;
  title: string;
  content?: string;
  username?: string;
  addTimeDisplay?: string;
  replies?: string;
  lights?: string;
  recNum?: string;
  forum_name?: string;
  fid?: string;
}

// 虎扑搜索响应数据结构
interface HupuSearchResponse {
  init?: {
    redirect?: string;
  };
  env?: string;
  query?: {
    q?: string;
    page?: string;
  };
  searchRes?: {
    count: number;
    totalPage: number;
    type?: string;
    data: SearchResult[];
  };
}

cli({
  site: 'hupu',
  name: 'search',
  description: '搜索虎扑帖子 (使用官方API)',
  domain: 'bbs.hupu.com',
  strategy: Strategy.PUBLIC, // 公开API，不需要Cookie
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'query',
      required: true,
      positional: true,
      help: '搜索关键词'
    },
    {
      name: 'page',
      type: 'int',
      default: 1,
      help: '结果页码'
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      help: '返回结果数量'
    },
    {
      name: 'forum',
      help: '板块ID过滤 (可选)'
    },
    {
      name: 'sort',
      default: 'general',
      help: '排序方式: general/createtime/replytime/light/reply'
    }
  ],
  columns: ['rank', 'title', 'author', 'replies', 'lights', 'forum', 'url'],
  func: async (page, kwargs) => {
    const { query, page: pageNum = 1, limit = 20, forum, sort = 'general' } = kwargs;
    const searchUrl = getHupuSearchUrl(query, pageNum, forum, sort);
    const data = await readHupuSearchData<HupuSearchResponse>(page, searchUrl, 'Search Hupu threads');

    // 提取搜索结果
    const results = data.searchRes?.data || [];

    // 处理结果：清理HTML标签，解码HTML实体
    const processedResults = results.slice(0, Number(limit)).map((item, index) => ({
      rank: index + 1,
      title: decodeHtml(stripHtml(item.title)),
      author: item.username || '未知用户',
      replies: item.replies || '0',
      lights: item.lights || '0',
      forum: item.forum_name || '未知板块',
      url: `https://bbs.hupu.com/${item.id}.html`
    }));

    return processedResults;
  },
});
