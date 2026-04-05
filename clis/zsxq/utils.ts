import { ArgumentError, AuthRequiredError, CliError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

export interface ZsxqUser {
  user_id?: number;
  name?: string;
  avatar_url?: string;
}

export interface ZsxqGroup {
  group_id?: number;
  name?: string;
  description?: string;
  background_url?: string;
  owner?: ZsxqUser;
  statistics?: {
    topics_count?: number;
    answers_count?: number;
    comments_count?: number;
    likes_count?: number;
    subscriptions_count?: number;
  };
  category?: {
    title?: string;
  };
  user_specific?: {
    join_time?: string;
    validity?: {
      end_time?: string;
    };
  };
}

export interface ZsxqComment {
  comment_id?: number;
  create_time?: string;
  text?: string;
  owner?: ZsxqUser;
  likes_count?: number;
  rewards_count?: number;
  repliee?: ZsxqUser;
}

export interface ZsxqTopic {
  topic_id?: number;
  create_time?: string;
  comments_count?: number;
  likes_count?: number;
  readers_count?: number;
  reading_count?: number;
  rewards_count?: number;
  title?: string;
  type?: string;
  group?: ZsxqGroup;
  owner?: ZsxqUser;
  user_specific?: Record<string, unknown>;
  talk?: {
    owner?: ZsxqUser;
    text?: string;
  };
  question?: {
    owner?: ZsxqUser;
    text?: string;
  };
  answer?: {
    owner?: ZsxqUser;
    text?: string;
  };
  task?: {
    owner?: ZsxqUser;
    text?: string;
  };
  solution?: {
    owner?: ZsxqUser;
    text?: string;
  };
  show_comments?: ZsxqComment[];
  comments?: ZsxqComment[];
}

export interface BrowserFetchResult {
  ok: boolean;
  url?: string;
  status?: number;
  error?: string;
  data?: unknown;
}

const SITE_DOMAIN = 'wx.zsxq.com';
const SITE_URL = 'https://wx.zsxq.com';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pickArray<T>(...values: unknown[]): T[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value as T[];
    }
  }
  return [];
}

export async function ensureZsxqPage(page: IPage): Promise<void> {
  await page.goto(SITE_URL);
}

export async function ensureZsxqAuth(page: IPage): Promise<void> {
  // zsxq uses httpOnly cookies that may be on different subdomains.
  // Verify auth by attempting a lightweight API call instead of checking cookies.
  try {
    const result = await page.evaluate(`
      (async () => {
        try {
          const r = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'https://api.zsxq.com/v2/groups', true);
            xhr.withCredentials = true;
            xhr.setRequestHeader('accept', 'application/json');
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch { resolve(null); }
              } else { resolve(null); }
            };
            xhr.onerror = () => resolve(null);
            xhr.send();
          });
          return r !== null;
        } catch { return false; }
      })()
    `);
    if (!result) {
      throw new AuthRequiredError('zsxq.com');
    }
  } catch (err) {
    if (err instanceof AuthRequiredError) throw err;
    throw new AuthRequiredError('zsxq.com');
  }
}

export async function getCookieValue(page: IPage, name: string): Promise<string | undefined> {
  const cookies = await page.getCookies({ domain: SITE_DOMAIN });
  return cookies.find(cookie => cookie.name === name)?.value;
}

export async function getActiveGroupId(page: IPage): Promise<string> {
  const groupId = await page.evaluate(`
    (() => {
      const target = localStorage.getItem('target_group');
      if (target) {
        try {
          const parsed = JSON.parse(target);
          if (parsed.group_id) return String(parsed.group_id);
        } catch {}
      }
      return null;
    })()
  `);
  if (groupId) return groupId;

  throw new ArgumentError(
    'Cannot determine active group_id',
    'Pass --group_id <id> or open the target 知识星球 page in Chrome first',
  );
}

export async function browserJsonRequest(page: IPage, path: string): Promise<BrowserFetchResult> {
  return await page.evaluate(`
    (async () => {
      const path = ${JSON.stringify(path)};

      try {
        return await new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', path, true);
          xhr.withCredentials = true;
          xhr.setRequestHeader('accept', 'application/json, text/plain, */*');
          xhr.onload = () => {
            let parsed = null;
            if (xhr.responseText) {
              try { parsed = JSON.parse(xhr.responseText); }
              catch {}
            }

            resolve({
              ok: xhr.status >= 200 && xhr.status < 300,
              url: path,
              status: xhr.status,
              data: parsed,
              error: xhr.status >= 200 && xhr.status < 300 ? undefined : 'HTTP ' + xhr.status,
            });
          };
          xhr.onerror = () => resolve({
            ok: false,
            url: path,
            error: 'Network error',
          });
          xhr.send();
        });
      } catch (error) {
        return {
          ok: false,
          url: path,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })()
  `) as BrowserFetchResult;
}

export async function fetchFirstJson(page: IPage, paths: string[]): Promise<BrowserFetchResult> {
  let lastFailure: BrowserFetchResult | null = null;

  for (const path of paths) {
    const result = await browserJsonRequest(page, path);
    if (result.ok) {
      return result;
    }
    lastFailure = result;
  }

  if (!lastFailure) {
    throw new CliError(
      'FETCH_ERROR',
      'No candidate endpoint returned JSON',
      `Checked endpoints: ${paths.join(', ')}`,
    );
  }

  throw new CliError(
    'FETCH_ERROR',
    lastFailure.error || 'Failed to fetch ZSXQ API',
    `Checked endpoints: ${paths.join(', ')}`,
  );
}

export function unwrapRespData<T>(payload: unknown): T {
  const record = asRecord(payload);
  if (!record) {
    throw new CliError('PARSE_ERROR', 'Invalid ZSXQ API response');
  }

  if (record.succeeded === false) {
    const code = typeof record.code === 'number' ? String(record.code) : 'API_ERROR';
    const message = typeof record.info === 'string'
      ? record.info
      : typeof record.error === 'string'
        ? record.error
        : 'ZSXQ API returned an error';
    throw new CliError(code, message);
  }

  return (record.resp_data ?? record.data ?? payload) as T;
}

export function getTopicsFromResponse(payload: unknown): ZsxqTopic[] {
  const data = unwrapRespData<Record<string, unknown> | ZsxqTopic[]>(payload);
  if (Array.isArray(data)) return data;
  return pickArray<ZsxqTopic>(
    data.topics,
    data.list,
    data.records,
    data.items,
    data.search_result,
  );
}

export function getCommentsFromResponse(payload: unknown): ZsxqComment[] {
  const data = unwrapRespData<Record<string, unknown> | ZsxqComment[]>(payload);
  if (Array.isArray(data)) return data;
  return pickArray<ZsxqComment>(data.comments, data.list, data.items);
}

export function getGroupsFromResponse(payload: unknown): ZsxqGroup[] {
  const data = unwrapRespData<Record<string, unknown> | ZsxqGroup[]>(payload);
  if (Array.isArray(data)) return data;
  return pickArray<ZsxqGroup>(data.groups, data.list, data.items);
}

export function getTopicFromResponse(payload: unknown): ZsxqTopic | null {
  const data = unwrapRespData<Record<string, unknown> | ZsxqTopic>(payload);
  if (Array.isArray(data)) return data[0] ?? null;
  if (typeof data.topic_id === 'number') return data;
  const record = asRecord(data);
  if (!record) return null;
  const topic = record.topic;
  return topic && typeof topic === 'object' ? topic as ZsxqTopic : null;
}

export function getTopicAuthor(topic: ZsxqTopic): string {
  return (
    topic.owner?.name ||
    topic.talk?.owner?.name ||
    topic.question?.owner?.name ||
    topic.answer?.owner?.name ||
    topic.task?.owner?.name ||
    topic.solution?.owner?.name ||
    ''
  );
}

export function getTopicText(topic: ZsxqTopic): string {
  const primary = [
    topic.title,
    topic.talk?.text,
    topic.question?.text,
    topic.answer?.text,
    topic.task?.text,
    topic.solution?.text,
  ].find(value => typeof value === 'string' && value.trim());
  return (primary || '').replace(/\s+/g, ' ').trim();
}

export function getTopicUrl(topicId: number | string | undefined): string {
  return topicId ? `${SITE_URL}/topic/${topicId}` : SITE_URL;
}

export function summarizeComments(comments: ZsxqComment[], limit: number = 3): string {
  return comments
    .slice(0, limit)
    .map((comment) => {
      const author = comment.owner?.name || '匿名';
      const target = comment.repliee?.name ? ` -> ${comment.repliee.name}` : '';
      const text = (comment.text || '').replace(/\s+/g, ' ').trim();
      return `${author}${target}: ${text}`;
    })
    .join(' | ');
}

export function toTopicRow(topic: ZsxqTopic): Record<string, unknown> {
  const topicId = topic.topic_id ?? '';
  const comments = pickArray<ZsxqComment>(topic.show_comments, topic.comments);
  return {
    topic_id: topicId,
    type: topic.type || '',
    group: topic.group?.name || '',
    author: getTopicAuthor(topic),
    title: getTopicText(topic).slice(0, 120),
    content: getTopicText(topic),
    comments: topic.comments_count ?? comments.length ?? 0,
    likes: topic.likes_count ?? 0,
    readers: topic.readers_count ?? topic.reading_count ?? 0,
    time: topic.create_time || '',
    comment_preview: summarizeComments(comments),
    url: getTopicUrl(topicId),
  };
}
