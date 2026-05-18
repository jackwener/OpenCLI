import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

export const REDDIT_SUBSCRIBED_MAX_LIMIT = 1000;

export function parseRedditSubscribedLimit(raw) {
    if (raw === undefined || raw === null || raw === '') return 100;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > REDDIT_SUBSCRIBED_MAX_LIMIT) {
        throw new ArgumentError(
            `limit must be an integer in [1, ${REDDIT_SUBSCRIBED_MAX_LIMIT}].`,
            `Got: ${raw}`,
        );
    }
    return n;
}

export function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

function mapSubredditRow(entry, index) {
    const data = entry?.data;
    if (!data || typeof data !== 'object') {
        throw new CommandExecutionError(`Reddit subscriptions row ${index + 1} was missing data.`);
    }
    const fullname = typeof data.name === 'string' ? data.name : '';
    const id = fullname.startsWith('t5_')
        ? fullname
        : (entry?.kind === 't5' && typeof data.id === 'string' && data.id ? `t5_${data.id}` : '');
    const displayName = typeof data.display_name === 'string' && data.display_name
        ? data.display_name
        : '';
    const subreddit = typeof data.display_name_prefixed === 'string' && data.display_name_prefixed
        ? data.display_name_prefixed
        : (displayName ? `r/${displayName}` : '');
    const path = typeof data.url === 'string' && data.url.startsWith('/r/') ? data.url : '';
    if (!id || !displayName || !subreddit || !path) {
        throw new CommandExecutionError(`Reddit subscriptions row ${index + 1} was missing subreddit identity.`);
    }
    return {
        id,
        subreddit,
        title: typeof data.title === 'string' ? data.title : '',
        subscribers: typeof data.subscribers === 'number' ? data.subscribers : null,
        description: typeof data.public_description === 'string' ? data.public_description.slice(0, 200) : '',
        url: 'https://www.reddit.com' + path,
    };
}

cli({
    site: 'reddit',
    name: 'subscribed',
    description: 'List subreddits you are subscribed to',
    access: 'read',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 100, help: `Max subreddits to return (1-${REDDIT_SUBSCRIBED_MAX_LIMIT}, auto-paginates)` },
    ],
    columns: ['id', 'subreddit', 'title', 'subscribers', 'description', 'url'],
    func: async (page, kwargs) => {
        const limit = parseRedditSubscribedLimit(kwargs.limit);
        if (!page)
            throw new CommandExecutionError('Browser session required');
        await page.goto('https://www.reddit.com');
        const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
      try {
        const meRes = await fetch('/api/me.json?raw_json=1', { credentials: 'include' });
        if (meRes.status === 401 || meRes.status === 403) {
          return { kind: 'auth', detail: 'Reddit /api/me.json returned HTTP ' + meRes.status };
        }
        if (!meRes.ok) {
          return { kind: 'http', httpStatus: meRes.status, where: '/api/me.json' };
        }
        const me = await meRes.json();
        const username = me?.data?.name || me?.name;
        if (!username) return { kind: 'auth', detail: 'Not logged in to reddit.com (no identity in /api/me.json)' };

        const target = ${JSON.stringify(limit)};
        const PAGE_SIZE = 100;
        const out = [];
        let after = null;
        const seenCursors = new Set();
        for (let pageIndex = 0; pageIndex < 20 && out.length < target; pageIndex++) {
          const remaining = target - out.length;
          const pageLimit = Math.min(PAGE_SIZE, remaining);
          const url = '/subreddits/mine/subscriptions.json?limit=' + pageLimit
            + '&raw_json=1'
            + (after ? '&after=' + encodeURIComponent(after) : '');
          const res = await fetch(url, { credentials: 'include' });
          if (res.status === 401 || res.status === 403) {
            return { kind: 'auth', detail: 'Reddit subscriptions endpoint returned HTTP ' + res.status };
          }
          if (!res.ok) return { kind: 'http', httpStatus: res.status, where: url };
          const d = await res.json();
          const children = d?.data?.children;
          if (!Array.isArray(children)) {
            return { kind: 'malformed', detail: 'Reddit subscriptions payload was missing data.children.' };
          }
          for (const child of children) {
            if (out.length >= target) break;
            out.push(child);
          }
          const next = d?.data?.after ?? null;
          if (next !== null && typeof next !== 'string') {
            return { kind: 'malformed', detail: 'Reddit subscriptions payload had a malformed after cursor.' };
          }
          if (out.length >= target || !next) break;
          if (children.length === 0) {
            return { kind: 'malformed', detail: 'Reddit subscriptions page was empty but returned an after cursor.' };
          }
          if (seenCursors.has(next)) {
            return { kind: 'malformed', detail: 'Reddit subscriptions repeated pagination cursor ' + next + '.' };
          }
          seenCursors.add(next);
          after = next;
        }
        if (out.length < target && after) {
          return { kind: 'malformed', detail: 'Reddit subscriptions pagination exceeded the safety cap before satisfying the requested limit.' };
        }
        return { kind: 'ok', entries: out };
      } catch (e) {
        return { kind: 'exception', detail: String(e && e.message || e) };
      }
    })()`));
        if (result?.kind === 'auth') {
            throw new AuthRequiredError('reddit.com', result.detail);
        }
        if (result?.kind === 'http') {
            throw new CommandExecutionError(`HTTP ${result.httpStatus} from ${result.where}`);
        }
        if (result?.kind === 'malformed') {
            throw new CommandExecutionError(result.detail);
        }
        if (result?.kind === 'exception') {
            throw new CommandExecutionError(`subscribed failed: ${result.detail}`);
        }
        if (result?.kind !== 'ok' || !Array.isArray(result.entries)) {
            throw new CommandExecutionError(`Unexpected result from reddit subscribed: ${JSON.stringify(result)}`);
        }
        const rows = result.entries.slice(0, limit).map((entry, index) => mapSubredditRow(entry, index));
        if (rows.length === 0) {
            throw new EmptyResultError('Reddit returned no subscribed subreddits for the logged-in account.');
        }
        return rows;
    }
});
