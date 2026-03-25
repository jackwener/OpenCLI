/**
 * linux.do unified feed — route latest/hot/top topics by site, tag, or category.
 *
 * Usage:
 *   linux-do feed                                              # latest topics
 *   linux-do feed --view top --period daily                    # top topics (daily)
 *   linux-do feed --tag ChatGPT                                # latest topics by tag
 *   linux-do feed --tag 3 --view hot                           # hot topics by tag id
 *   linux-do feed --category 开发调优                           # latest top-level category topics
 *   linux-do feed --category 94 --tag 4 --view top --period monthly
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { LINUX_DO_CATEGORIES, type LinuxDoCategoryRecord } from './categories.data.js';
import { LINUX_DO_TAGS, type LinuxDoTagRecord } from './tags.data.js';

const LINUX_DO_HOME = 'https://linux.do';

type FeedView = 'latest' | 'hot' | 'top';

interface ResolvedLinuxDoCategory extends LinuxDoCategoryRecord {
  parent: LinuxDoCategoryRecord | null;
}

interface FeedRequest {
  url: string;
}

interface TopicListItem {
  title: string;
  replies: number;
  created: string;
  likes: number;
  views: number;
  url: string;
}

interface FetchJsonResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/**
 * 统一清洗名称和 slug，避免大小写与多空格影响匹配。
 */
function normalizeLookupValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

async function fetchLinuxDoJson(page: IPage | null, apiPath: string): Promise<any> {
  if (!page) throw new CommandExecutionError('Browser page required');

  await page.goto(LINUX_DO_HOME);
  await page.wait(2);

  const escapedPath = JSON.stringify(apiPath);
  const result = await page.evaluate(`(async () => {
    try {
      const res = await fetch(${escapedPath}, { credentials: 'include' });
      let data = null;
      try { data = await res.json(); } catch {}
      return {
        ok: res.ok,
        status: res.status,
        data,
        error: data === null ? 'Response is not valid JSON' : '',
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })()`) as FetchJsonResult | null;

  if (!result) {
    throw new CommandExecutionError('linux.do returned an empty browser response');
  }

  if (result.status === 401 || result.status === 403) {
    throw new AuthRequiredError('linux.do', 'linux.do requires an active signed-in browser session');
  }

  if (!result.ok) {
    throw new CommandExecutionError(
      result.error || `linux.do request failed: HTTP ${result.status ?? 'unknown'}`,
    );
  }

  if (result.error) {
    throw new CommandExecutionError(result.error, 'Please verify your linux.do session is still valid');
  }

  return result.data;
}

function toLocalTime(utcStr: string): string {
  if (!utcStr) return '';
  const d = new Date(utcStr);
  if (isNaN(d.getTime())) return utcStr;
  return d.toLocaleString();
}

function topicListRichFromJson(data: any, limit: number): TopicListItem[] {
  const topics: any[] = data?.topic_list?.topics ?? [];
  return topics.slice(0, limit).map((t: any) => ({
    title: t.fancy_title ?? t.title ?? '',
    replies: t.posts_count ?? 0,
    created: toLocalTime(t.created_at),
    likes: t.like_count ?? 0,
    views: t.views ?? 0,
    url: `https://linux.do/t/topic/${t.id}`,
  }));
}

/**
 * 解析标签，支持 id、name、slug 三种输入。
 */
function resolveTag(value: string): LinuxDoTagRecord {
  const raw = value.trim();
  const normalized = normalizeLookupValue(value);
  const tag = /^\d+$/.test(raw)
    ? LINUX_DO_TAGS.find((item) => item.id === Number(raw))
    : LINUX_DO_TAGS.find((item) => normalizeLookupValue(item.name) === normalized)
    ?? LINUX_DO_TAGS.find((item) => normalizeLookupValue(item.slug) === normalized);

  if (!tag) throw new ArgumentError(`Unknown tag: ${value}`, 'Use "opencli linux-do tags" to list available tags');
  return tag;
}

/**
 * 解析分类，并补齐父分类信息。
 */
function resolveCategory(value: string): ResolvedLinuxDoCategory {
  const raw = value.trim();
  const normalized = normalizeLookupValue(value);
  const category = /^\d+$/.test(raw)
    ? LINUX_DO_CATEGORIES.find((item) => item.id === Number(raw))
    : LINUX_DO_CATEGORIES.find((item) => normalizeLookupValue(item.name) === normalized)
    ?? LINUX_DO_CATEGORIES.find((item) => normalizeLookupValue(item.slug) === normalized);

  if (!category) throw new ArgumentError(`Unknown category: ${value}`, 'Use "opencli linux-do categories" to list available categories');

  const parent = category.parentCategoryId == null
    ? null
    : LINUX_DO_CATEGORIES.find((item) => item.id === category.parentCategoryId) ?? null;

  if (category.parentCategoryId != null && !parent) {
    throw new CommandExecutionError(`Parent category not found for: ${category.name}`);
  }

  return { ...category, parent };
}

/**
 * 将命令参数转换为最终请求地址
 */
function resolveFeedRequest(kwargs: Record<string, any>): FeedRequest {
  const view = (kwargs.view || 'latest') as FeedView;
  const period = (kwargs.period || 'weekly') as string;

  if (kwargs.period && view !== 'top') {
    throw new ArgumentError('--period is only valid with --view top');
  }

  const params = new URLSearchParams();
  if (kwargs.order && kwargs.order !== 'default') params.set('order', kwargs.order as string);
  if (kwargs.ascending) params.set('ascending', 'true');
  if (kwargs.limit) params.set('per_page', String(kwargs.limit));
  const tagValue = typeof kwargs.tag === 'string' ? kwargs.tag.trim() : '';
  const categoryValue = typeof kwargs.category === 'string' ? kwargs.category.trim() : '';

  if (!tagValue && !categoryValue) {
    const query = new URLSearchParams(params);
    if (view === 'top') query.set('period', period);
    const jsonSuffix = query.toString() ? `?${query.toString()}` : '';
    return {
      url: `${view === 'latest' ? '/latest.json' : view === 'hot' ? '/hot.json' : '/top.json'}${jsonSuffix}`,
    };
  }

  const tag = tagValue ? resolveTag(tagValue) : null;
  const category = categoryValue ? resolveCategory(categoryValue) : null;

  const categorySegments = category
    ? (category.parent
      ? [category.parent.slug, category.slug, String(category.id)]
      : [category.slug, String(category.id)])
      .map(encodeURIComponent)
      .join('/')
    : '';

  const tagSegment = tag ? `${tag.id}-tag/${tag.id}` : '';

  const basePath = category && tag
    ? `/tags/c/${categorySegments}/${tagSegment}`
    : category
      ? `/c/${categorySegments}`
      : `/tag/${tagSegment}`;

  const query = new URLSearchParams(params);
  if (view === 'top') query.set('period', period);
  const jsonSuffix = query.toString() ? `?${query.toString()}` : '';
  return {
    url: `${basePath}${view === 'latest' ? '.json' : `/l/${view}.json`}${jsonSuffix}`,
  };
}

cli({
  site: 'linux-do',
  name: 'feed',
  description: 'linux.do 话题列表（需登录；支持全站、标签、分类）',
  domain: 'linux.do',
  strategy: Strategy.COOKIE,
  browser: true,
  columns: ['title', 'replies', 'created', 'likes', 'views', 'url'],
  args: [
    {
      name: 'view',
      type: 'str',
      default: 'latest',
      help: 'View type',
      choices: ['latest', 'hot', 'top'],
    },
    {
      name: 'tag',
      type: 'str',
      help: 'Tag name, slug, or id',
    },
    {
      name: 'category',
      type: 'str',
      help: 'Category name, slug, or id',
    },
    { name: 'limit', type: 'int', default: 20, help: 'Number of items (per_page)' },
    {
      name: 'order',
      type: 'str',
      default: 'default',
      help: 'Sort order',
      choices: [
        'default',
        'created',
        'activity',
        'views',
        'posts',
        'category',
        'likes',
        'op_likes',
        'posters',
      ],
    },
    { name: 'ascending', type: 'boolean', default: false, help: 'Sort ascending (default: desc)' },
    {
      name: 'period',
      type: 'str',
      help: 'Time period (only for --view top)',
      choices: ['all', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    },
  ],
  func: async (page, kwargs) => {
    const limit = (kwargs.limit || 20) as number;
    const request = resolveFeedRequest(kwargs);
    const data = await fetchLinuxDoJson(page, request.url);
    return topicListRichFromJson(data, limit);
  },
});
