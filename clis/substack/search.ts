import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';

type SubstackPostResult = {
  title: string;
  author: string;
  date: string;
  description: string;
  url: string;
};

function headers(): HeadersInit {
  return {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
  };
}

function trim(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function publicationBaseUrl(publication: any): string {
  if (publication?.custom_domain) return `https://${publication.custom_domain}`;
  if (publication?.subdomain) return `https://${publication.subdomain}.substack.com`;
  return '';
}

async function searchPosts(keyword: string, limit: number): Promise<SubstackPostResult[]> {
  const url = new URL('https://substack.com/api/v1/post/search');
  url.searchParams.set('query', keyword);
  url.searchParams.set('page', '0');
  url.searchParams.set('includePlatformResults', 'true');

  const resp = await fetch(url, { headers: headers() });
  if (!resp.ok) throw new CommandExecutionError(`Substack post search failed: HTTP ${resp.status}`);

  const data = await resp.json() as { results?: any[] };
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.slice(0, limit).map((item, index) => ({
    rank: index + 1,
    title: trim(item?.title),
    author: trim(item?.publishedBylines?.[0]?.name),
    date: trim(item?.post_date).split('T')[0] || trim(item?.post_date),
    description: trim(item?.description || item?.subtitle || item?.truncated_body_text).slice(0, 150),
    url: trim(item?.canonical_url),
  }));
}

async function searchPublications(keyword: string, limit: number): Promise<SubstackPostResult[]> {
  const url = new URL('https://substack.com/api/v1/profile/search');
  url.searchParams.set('query', keyword);
  url.searchParams.set('page', '0');

  const resp = await fetch(url, { headers: headers() });
  if (!resp.ok) throw new CommandExecutionError(`Substack publication search failed: HTTP ${resp.status}`);

  const data = await resp.json() as { results?: any[] };
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.slice(0, limit).map((item, index) => {
    const publication = item?.primaryPublication || item?.publicationUsers?.[0]?.publication || {};
    return {
      rank: index + 1,
      title: trim(publication?.name || item?.name),
      author: trim(item?.name),
      date: '',
      description: trim(publication?.hero_text || item?.bio).slice(0, 150),
      url: publicationBaseUrl(publication),
    };
  });
}

cli({
  site: 'substack',
  name: 'search',
  description: '搜索 Substack 文章和 Newsletter',
  domain: 'substack.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'keyword', required: true, positional: true, help: '搜索关键词' },
    { name: 'type', default: 'posts', choices: ['posts', 'publications'], help: '搜索类型（posts=文章, publications=Newsletter）' },
    { name: 'limit', type: 'int', default: 20, help: '返回结果数量' },
  ],
  columns: ['rank', 'title', 'author', 'date', 'description', 'url'],
  func: async (_page, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 50));
    return args.type === 'publications'
      ? searchPublications(args.keyword, limit)
      : searchPosts(args.keyword, limit);
  },
});
