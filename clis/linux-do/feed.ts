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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy, type Arg, type CommandArgs } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

const LINUX_DO_HOME = 'https://linux.do';
const LINUX_DO_METADATA_TTL_MS = 24 * 60 * 60 * 1000;
let liveTagsPromise: Promise<LinuxDoTagRecord[]> | null = null;
let liveCategoriesPromise: Promise<ResolvedLinuxDoCategory[]> | null = null;
let testTagOverride: LinuxDoTagRecord[] | null = null;
let testCategoryOverride: ResolvedLinuxDoCategory[] | null = null;
let testCacheDirOverride: string | null = null;

type FeedView = 'latest' | 'hot' | 'top';

interface LinuxDoTagRecord {
  id: number;
  slug: string;
  name: string;
}

interface LinuxDoCategoryRecord {
  id: number;
  name: string;
  description: string;
  slug: string;
  parentCategoryId: number | null;
}

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

interface FetchJsonOptions {
  skipNavigate?: boolean;
}

interface RawLinuxDoTag {
  id: number;
  slug?: string | null;
  name?: string | null;
}

interface RawLinuxDoCategory {
  id: number;
  name?: string | null;
  description?: string | null;
  description_text?: string | null;
  slug?: string | null;
  subcategory_ids?: number[] | null;
}

interface MetadataCacheEnvelope<T> {
  fetchedAt: string;
  data: T;
}

/**
 * 统一清洗名称和 slug，避免大小写与多空格影响匹配。
 */
function normalizeLookupValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function getLinuxDoCacheDir(): string {
  return testCacheDirOverride ?? path.join(getHomeDir(), '.opencli', 'cache', 'linux-do');
}

function getMetadataCachePath(name: 'tags' | 'categories'): string {
  return path.join(getLinuxDoCacheDir(), `${name}.json`);
}

async function readMetadataCache<T>(name: 'tags' | 'categories'): Promise<{ data: T; fresh: boolean } | null> {
  try {
    const raw = await fs.promises.readFile(getMetadataCachePath(name), 'utf-8');
    const parsed = JSON.parse(raw) as MetadataCacheEnvelope<T>;
    if (!parsed || !Array.isArray(parsed.data) || typeof parsed.fetchedAt !== 'string') return null;
    const fetchedAt = new Date(parsed.fetchedAt).getTime();
    const fresh = Number.isFinite(fetchedAt) && (Date.now() - fetchedAt) < LINUX_DO_METADATA_TTL_MS;
    return { data: parsed.data, fresh };
  } catch {
    return null;
  }
}

async function writeMetadataCache<T>(name: 'tags' | 'categories', data: T): Promise<void> {
  try {
    const cacheDir = getLinuxDoCacheDir();
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const payload: MetadataCacheEnvelope<T> = {
      fetchedAt: new Date().toISOString(),
      data,
    };
    await fs.promises.writeFile(getMetadataCachePath(name), JSON.stringify(payload, null, 2) + '\n');
  } catch {
    // Cache write failures should never block command execution.
  }
}

async function ensureLinuxDoHome(page: IPage | null): Promise<void> {
  if (!page) throw new CommandExecutionError('Browser page required');
  await page.goto(LINUX_DO_HOME);
  await page.wait(2);
}

async function fetchLinuxDoJson(page: IPage | null, apiPath: string, options: FetchJsonOptions = {}): Promise<any> {
  if (!options.skipNavigate) {
    await ensureLinuxDoHome(page);
  }
  if (!page) throw new CommandExecutionError('Browser page required');

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

function findMatchingTag(records: LinuxDoTagRecord[], value: string): LinuxDoTagRecord | null {
  const raw = value.trim();
  const normalized = normalizeLookupValue(value);
  return /^\d+$/.test(raw)
    ? records.find((item) => item.id === Number(raw)) ?? null
    : records.find((item) => normalizeLookupValue(item.name) === normalized)
      ?? records.find((item) => normalizeLookupValue(item.slug) === normalized)
      ?? null;
}

function findMatchingCategory(records: ResolvedLinuxDoCategory[], value: string): ResolvedLinuxDoCategory | null {
  const raw = value.trim();
  const normalized = normalizeLookupValue(value);
  return /^\d+$/.test(raw)
    ? records.find((item) => item.id === Number(raw)) ?? null
    : records.find((item) => categoryLookupKeys(item).includes(normalized))
      ?? null;
}

function categoryLookupKeys(category: ResolvedLinuxDoCategory): string[] {
  const keys = [category.name, category.slug];
  if (category.parent) {
    keys.push(
      `${category.parent.name} / ${category.name}`,
      `${category.parent.name}/${category.name}`,
      `${category.parent.name}, ${category.name}`,
    );
  }
  return keys.map(normalizeLookupValue);
}

function toCategoryRecord(raw: RawLinuxDoCategory, parent: LinuxDoCategoryRecord | null): ResolvedLinuxDoCategory {
  return {
    id: raw.id,
    name: raw.name ?? '',
    description: raw.description_text ?? raw.description ?? '',
    slug: raw.slug ?? '',
    parentCategoryId: parent?.id ?? null,
    parent,
  };
}

async function fetchLiveTags(page: IPage | null): Promise<LinuxDoTagRecord[]> {
  if (testTagOverride) return testTagOverride;
  if (!liveTagsPromise) {
    liveTagsPromise = (async () => {
      const cached = await readMetadataCache<LinuxDoTagRecord[]>('tags');
      if (cached?.fresh) return cached.data;

      try {
        const data = await fetchLinuxDoJson(page, '/tags.json', { skipNavigate: true });
        const tags = (Array.isArray(data?.tags) ? data.tags : [])
          .filter((tag: unknown): tag is RawLinuxDoTag => !!tag && typeof (tag as RawLinuxDoTag).id === 'number')
          .map((tag: RawLinuxDoTag) => ({
            id: tag.id,
            slug: tag.slug ?? `${tag.id}-tag`,
            name: tag.name ?? String(tag.id),
          }));
        await writeMetadataCache('tags', tags);
        return tags;
      } catch (error) {
        if (cached) return cached.data;
        liveTagsPromise = null;
        throw error;
      }
    })().catch((error) => {
      liveTagsPromise = null;
      throw error;
    });
  }
  return liveTagsPromise;
}

async function fetchLiveCategories(page: IPage | null): Promise<ResolvedLinuxDoCategory[]> {
  if (testCategoryOverride) return testCategoryOverride;
  if (!liveCategoriesPromise) {
    liveCategoriesPromise = (async () => {
      const cached = await readMetadataCache<ResolvedLinuxDoCategory[]>('categories');
      if (cached?.fresh) return cached.data;

      try {
        const data = await fetchLinuxDoJson(page, '/categories.json', { skipNavigate: true });
        const topCategories: RawLinuxDoCategory[] = Array.isArray(data?.category_list?.categories)
          ? data.category_list.categories
          : [];

        const resolvedTop = topCategories.map((category: RawLinuxDoCategory) => toCategoryRecord(category, null));
        const parentById = new Map<number, LinuxDoCategoryRecord>(resolvedTop.map((item) => [item.id, item]));

        const subcategoryGroups = await Promise.allSettled(
          topCategories
            .filter((category: RawLinuxDoCategory) => Array.isArray(category.subcategory_ids) && category.subcategory_ids.length > 0)
            .map(async (category: RawLinuxDoCategory) => {
              const subData = await fetchLinuxDoJson(page, `/categories.json?parent_category_id=${category.id}`, { skipNavigate: true });
              const subCategories: RawLinuxDoCategory[] = Array.isArray(subData?.category_list?.categories)
                ? subData.category_list.categories
                : [];
              const parent = parentById.get(category.id) ?? null;
              return subCategories.map((subCategory: RawLinuxDoCategory) => toCategoryRecord(subCategory, parent));
            }),
        );

        const categories = [
          ...resolvedTop,
          ...subcategoryGroups.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
        ];
        await writeMetadataCache('categories', categories);
        return categories;
      } catch (error) {
        if (cached) return cached.data;
        throw error;
      }
    })().catch((error) => {
      liveCategoriesPromise = null;
      throw error;
    });
  }
  return liveCategoriesPromise;
}

function toLocalTime(utcStr: string): string {
  if (!utcStr) return '';
  const d = new Date(utcStr);
  if (isNaN(d.getTime())) return utcStr;
  return d.toLocaleString();
}

function normalizeReplyCount(postsCount: unknown): number {
  const count = typeof postsCount === 'number' ? postsCount : 1;
  return Math.max(0, count - 1);
}

function topicListRichFromJson(data: any, limit: number): TopicListItem[] {
  const topics: any[] = data?.topic_list?.topics ?? [];
  return topics.slice(0, limit).map((t: any) => ({
    title: t.fancy_title ?? t.title ?? '',
    replies: normalizeReplyCount(t.posts_count),
    created: toLocalTime(t.created_at),
    likes: t.like_count ?? 0,
    views: t.views ?? 0,
    url: `https://linux.do/t/topic/${t.id}`,
  }));
}

/**
 * 解析标签，支持 id、name、slug 三种输入。
 */
async function resolveTag(page: IPage | null, value: string): Promise<LinuxDoTagRecord> {
  const liveTag = findMatchingTag(await fetchLiveTags(page), value);
  if (liveTag) return liveTag;

  throw new ArgumentError(`Unknown tag: ${value}`, 'Use "opencli linux-do tags" to list available tags');
}

/**
 * 解析分类，并补齐父分类信息。
 */
async function resolveCategory(page: IPage | null, value: string): Promise<ResolvedLinuxDoCategory> {
  const liveCategory = findMatchingCategory(await fetchLiveCategories(page), value);
  if (liveCategory) return liveCategory;

  throw new ArgumentError(`Unknown category: ${value}`, 'Use "opencli linux-do categories" to list available categories');
}

/**
 * 将命令参数转换为最终请求地址
 */
async function resolveFeedRequest(page: IPage | null, kwargs: Record<string, any>): Promise<FeedRequest> {
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

  const tag = tagValue ? await resolveTag(page, tagValue) : null;
  const category = categoryValue ? await resolveCategory(page, categoryValue) : null;

  const categorySegments = category
    ? (category.parent
      ? [category.parent.slug, category.slug, String(category.id)]
      : [category.slug, String(category.id)])
      .map(encodeURIComponent)
      .join('/')
    : '';

  const tagSegment = tag ? `${encodeURIComponent(tag.slug || `${tag.id}-tag`)}/${tag.id}` : '';

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

export const LINUX_DO_FEED_ARGS: Arg[] = [
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
    help: 'Category name, slug, id, or parent/name path',
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
];

export async function executeLinuxDoFeed(page: IPage | null, kwargs: CommandArgs): Promise<TopicListItem[]> {
  const limit = (kwargs.limit || 20) as number;
  await ensureLinuxDoHome(page);
  const request = await resolveFeedRequest(page, kwargs);
  const data = await fetchLinuxDoJson(page, request.url, { skipNavigate: true });
  return topicListRichFromJson(data, limit);
}

export function buildLinuxDoCompatFooter(replacement: string): string {
  return `Deprecated compatibility command. Prefer: ${replacement}`;
}

cli({
  site: 'linux-do',
  name: 'feed',
  description: 'linux.do 话题列表（需登录；支持全站、标签、分类）',
  domain: 'linux.do',
  strategy: Strategy.COOKIE,
  browser: true,
  columns: ['title', 'replies', 'created', 'likes', 'views', 'url'],
  args: LINUX_DO_FEED_ARGS,
  func: executeLinuxDoFeed,
});

export const __test__ = {
  resetMetadataCaches(): void {
    liveTagsPromise = null;
    liveCategoriesPromise = null;
    testTagOverride = null;
    testCategoryOverride = null;
    testCacheDirOverride = null;
  },
  setLiveMetadataForTests({
    tags,
    categories,
  }: {
    tags?: LinuxDoTagRecord[] | null;
    categories?: ResolvedLinuxDoCategory[] | null;
  }): void {
    liveTagsPromise = null;
    liveCategoriesPromise = null;
    testTagOverride = tags ?? null;
    testCategoryOverride = categories ?? null;
  },
  setCacheDirForTests(dir: string | null): void {
    testCacheDirOverride = dir;
  },
  resolveFeedRequest,
};
