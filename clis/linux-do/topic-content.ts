import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { htmlToMarkdown, isRecord } from '@jackwener/opencli/utils';
const LINUX_DO_DOMAIN = 'linux.do';
const LINUX_DO_HOME = 'https://linux.do';

interface FetchTopicResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

interface LinuxDoTopicPost {
  post_number?: number;
  username?: string;
  raw?: string;
  cooked?: string;
  like_count?: number;
  created_at?: string;
}

interface LinuxDoTopicPayload {
  title?: string;
  post_stream?: {
    posts?: LinuxDoTopicPost[];
  };
}

interface TopicContentRow {
  content: string;
}

function toLocalTime(utcStr: string): string {
  if (!utcStr) return '';
  const date = new Date(utcStr);
  return Number.isNaN(date.getTime()) ? utcStr : date.toLocaleString();
}

function normalizeTopicPayload(payload: unknown): LinuxDoTopicPayload | null {
  if (!isRecord(payload)) return null;
  const postStream = isRecord(payload.post_stream)
    ? {
      posts: Array.isArray(payload.post_stream.posts)
        ? payload.post_stream.posts.filter(isRecord).map((post) => ({
          post_number: typeof post.post_number === 'number' ? post.post_number : undefined,
          username: typeof post.username === 'string' ? post.username : undefined,
          raw: typeof post.raw === 'string' ? post.raw : undefined,
          cooked: typeof post.cooked === 'string' ? post.cooked : undefined,
          like_count: typeof post.like_count === 'number' ? post.like_count : undefined,
          created_at: typeof post.created_at === 'string' ? post.created_at : undefined,
        }))
        : undefined,
    }
    : undefined;

  return {
    title: typeof payload.title === 'string' ? payload.title : undefined,
    post_stream: postStream,
  };
}

function buildTopicMarkdownDocument(params: {
  title: string;
  author: string;
  likes?: number;
  createdAt: string;
  url: string;
  body: string;
}): string {
  const frontMatterLines: string[] = [];
  const entries: [string, string | number | undefined][] = [
    ['title', params.title || undefined],
    ['author', params.author || undefined],
    ['likes', typeof params.likes === 'number' && Number.isFinite(params.likes) ? params.likes : undefined],
    ['createdAt', params.createdAt || undefined],
    ['url', params.url || undefined],
  ];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (typeof value === 'number') {
      frontMatterLines.push(`${key}: ${value}`);
    } else {
      // Quote strings that could be misinterpreted by YAML parsers
      const needsQuote = /[#{}[\],&*?|>!%@`'"]/.test(value) || /: /.test(value) || /:$/.test(value) || value.includes('\n');
      frontMatterLines.push(`${key}: ${needsQuote ? `'${value.replace(/'/g, "''")}'` : value}`);
    }
  }
  const frontMatter = frontMatterLines.join('\n');

  return [
    frontMatter ? `---\n${frontMatter}\n---` : '',
    params.body.trim(),
  ].filter(Boolean).join('\n\n').trim();
}

function extractTopicContent(payload: unknown, id: number): TopicContentRow {
  const topic = normalizeTopicPayload(payload);
  if (!topic) {
    throw new CommandExecutionError('linux.do returned an unexpected topic payload');
  }

  const posts = topic.post_stream?.posts ?? [];
  const mainPost = posts.find((post) => post.post_number === 1);
  if (!mainPost) {
    throw new EmptyResultError('linux-do/topic-content', `Could not find the main post for topic ${id}.`);
  }

  const body = typeof mainPost.raw === 'string' && mainPost.raw.trim()
    ? mainPost.raw.trim()
    : htmlToMarkdown(mainPost.cooked ?? '');

  if (!body) {
    throw new EmptyResultError('linux-do/topic-content', `Topic ${id} does not contain a readable main post body.`);
  }

  return {
    content: buildTopicMarkdownDocument({
      title: topic.title?.trim() ?? '',
      author: mainPost.username?.trim() ?? '',
      likes: typeof mainPost.like_count === 'number' ? mainPost.like_count : undefined,
      createdAt: toLocalTime(mainPost.created_at ?? ''),
      url: `${LINUX_DO_HOME}/t/${id}`,
      body,
    }),
  };
}

async function fetchTopicPayload(page: IPage, id: number): Promise<unknown> {
  const result = await page.evaluate(`(async () => {
    try {
      const res = await fetch('/t/${id}.json?include_raw=true', { credentials: 'include' });
      let data = null;
      try {
        data = await res.json();
      } catch (_error) {
        data = null;
      }
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
  })()`) as FetchTopicResult | null;

  if (!result) {
    throw new CommandExecutionError('linux.do returned an empty browser response');
  }

  if (result.status === 401 || result.status === 403) {
    throw new AuthRequiredError(LINUX_DO_DOMAIN, 'linux.do requires an active signed-in browser session');
  }

  if (result.error === 'Response is not valid JSON') {
    throw new AuthRequiredError(LINUX_DO_DOMAIN, 'linux.do requires an active signed-in browser session');
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

cli({
  site: 'linux-do',
  name: 'topic-content',
  description: 'Get the main topic body as Markdown',
  domain: LINUX_DO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  defaultFormat: 'plain',
  args: [
    { name: 'id', positional: true, type: 'int', required: true, help: 'Topic ID' },
  ],
  columns: ['content'],
  func: async (page: IPage, kwargs) => {
    const id = Number(kwargs.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new CommandExecutionError(`Invalid linux.do topic id: ${String(kwargs.id ?? '')}`);
    }

    const payload = await fetchTopicPayload(page, id);
    return [extractTopicContent(payload, id)];
  },
});

export const __test__ = {
  buildTopicMarkdownDocument,
  extractTopicContent,
  normalizeTopicPayload,
  toLocalTime,
};
