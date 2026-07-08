/**
 * Weibo user-posts — list posts from a user within an optional date range.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './utils.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readRequiredId(raw) {
    const value = String(raw ?? '').trim();
    if (!value) {
        throw new ArgumentError('weibo user-posts id cannot be empty');
    }
    return value;
}

function readLimit(raw) {
    const value = raw === undefined || raw === null || raw === '' ? DEFAULT_LIMIT : Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
        throw new ArgumentError(`weibo user-posts limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return value;
}

function readDate(raw, name) {
    if (raw === undefined || raw === null || raw === '') return null;
    const value = String(raw).trim();
    if (!DATE_RE.test(value)) {
        throw new ArgumentError(`weibo user-posts ${name} must use YYYY-MM-DD`);
    }
    const date = new Date(`${value}T00:00:00+08:00`);
    if (!Number.isFinite(date.getTime()) || value !== formatShanghaiDate(date)) {
        throw new ArgumentError(`weibo user-posts ${name} must be a valid calendar date`);
    }
    return value;
}

function formatShanghaiDate(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateToTimestamp(date) {
    return Math.floor(new Date(`${date}T00:00:00+08:00`).getTime() / 1000);
}

function validateRange(start, end) {
    if (start && end && dateToTimestamp(start) > dateToTimestamp(end)) {
        throw new ArgumentError('weibo user-posts start must be <= end');
    }
}

function mapError(error) {
    const message = String(error ?? '').trim();
    if (!message) {
        throw new CommandExecutionError('weibo user-posts failed without an error message');
    }
    if (/login|cookie|登录|auth|forbidden|permission|权限|unauthorized/i.test(message)) {
        throw new AuthRequiredError('weibo.com', message);
    }
    throw new CommandExecutionError(message);
}

export const testInternals = {
    readRequiredId,
    readLimit,
    readDate,
    dateToTimestamp,
};

cli({
    site: 'weibo',
    name: 'user-posts',
    access: 'read',
    description: 'List Weibo posts from a user, optionally filtered by date range',
    domain: 'weibo.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', positional: true, required: true, help: 'User ID (numeric uid) or screen name' },
        { name: 'start', help: 'Start date in Asia/Shanghai (YYYY-MM-DD)' },
        { name: 'end', help: 'End date in Asia/Shanghai (YYYY-MM-DD)' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of posts (1-${MAX_LIMIT})` },
        { name: 'include-retweets', type: 'boolean', default: false, help: 'Include retweets' },
    ],
    columns: ['rank', 'id', 'mblogid', 'author', 'uid', 'text', 'time', 'reposts', 'comments', 'likes', 'pic_count', 'url'],
    func: async (page, kwargs) => {
        const id = readRequiredId(kwargs.id);
        const limit = readLimit(kwargs.limit);
        const start = readDate(kwargs.start, 'start');
        const end = readDate(kwargs.end, 'end');
        validateRange(start, end);
        const includeRetweets = Boolean(kwargs['include-retweets']);
        const starttime = start ? dateToTimestamp(start) : null;
        const endtime = end ? dateToTimestamp(end) + 24 * 60 * 60 - 1 : null;

        await page.goto('https://weibo.com');
        await page.wait(2);

        const evaluateResult = await page.evaluate(`
      (async () => {
        const rawId = ${JSON.stringify(id)};
        const limit = ${limit};
        const includeRetweets = ${includeRetweets};
        const starttime = ${starttime === null ? 'null' : starttime};
        const endtime = ${endtime === null ? 'null' : endtime};
        const strip = (html) => (html || '')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/\\s+/g, ' ')
          .trim();

        async function readJson(url) {
          const resp = await fetch(url, { credentials: 'include' });
          if (resp.status === 401 || resp.status === 403) {
            return { error: 'login required: HTTP ' + resp.status };
          }
          if (!resp.ok) {
            return { error: 'HTTP ' + resp.status };
          }
          try {
            return await resp.json();
          } catch {
            return { error: 'Malformed JSON response' };
          }
        }

        let uid = rawId;
        if (!/^\\d+$/.test(rawId)) {
          const profile = await readJson('/ajax/profile/info?screen_name=' + encodeURIComponent(rawId));
          if (profile.error) return profile;
          if (!profile.ok || !profile.data?.user?.id) return [rawId, [], true, false];
          uid = String(profile.data.user.id);
        }

        const rows = [];
        let sawList = false;
        let sawPostCandidates = false;
        for (let page = 1; page <= 20 && rows.length < limit; page++) {
          const qs = new URLSearchParams();
          qs.set('uid', uid);
          qs.set('page', String(page));
          qs.set('hasori', '1');
          qs.set('hasret', includeRetweets ? '1' : '0');
          if (starttime !== null) qs.set('starttime', String(starttime));
          if (endtime !== null) qs.set('endtime', String(endtime));

          const data = await readJson('/ajax/statuses/searchProfile?' + qs.toString());
          if (data.error) return data;
          if (data.ok === false) {
            return { error: 'Weibo user posts API error: ' + (data.msg || data.message || 'request failed') };
          }
          const list = data.data?.list;
          if (!Array.isArray(list)) {
            return { error: 'Weibo user posts response did not include data.list' };
          }
          sawList = true;
          if (list.length > 0) sawPostCandidates = true;
          if (list.length === 0) break;

          for (const post of list) {
            if (rows.length >= limit) break;
            const postId = post.idstr || (post.id === undefined || post.id === null ? '' : String(post.id));
            const mblogid = post.mblogid || '';
            const user = post.user || {};
            const text = post.text_raw || strip(post.text || '');
            if (!postId || !mblogid || !text) continue;
            rows.push({
              id: postId,
              mblogid,
              author: user.screen_name || '',
              uid: user.id === undefined || user.id === null ? uid : String(user.id),
              text,
              time: post.created_at || '',
              reposts: post.reposts_count ?? 0,
              comments: post.comments_count ?? 0,
              likes: post.attitudes_count ?? 0,
              pic_count: post.pic_num ?? Object.keys(post.pic_infos || {}).length,
              url: 'https://weibo.com/' + (user.id || uid) + '/' + mblogid,
            });
          }

          if (list.length < 10) break;
        }

        return [uid, rows, sawList, sawPostCandidates];
      })()
    `);

        const payload = unwrapEvaluateResult(evaluateResult);
        if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'error' in payload) {
            mapError(payload.error);
        }
        if (!Array.isArray(payload) || payload.length !== 4 || !Array.isArray(payload[1])) {
            throw new CommandExecutionError('weibo user-posts returned malformed extraction payload');
        }
        const [resolvedUid, rows, sawList, sawPostCandidates] = payload;
        if (!sawList && rows.length === 0) {
            throw new CommandExecutionError('weibo user-posts did not observe a valid posts list');
        }
        if (sawPostCandidates && rows.length === 0) {
            throw new CommandExecutionError('weibo user-posts found post candidates but could not extract valid rows');
        }
        if (rows.length === 0) {
            throw new EmptyResultError('weibo user-posts', 'No Weibo posts found for this user/date range');
        }

        return rows.slice(0, limit).map((row, index) => ({
            rank: index + 1,
            id: String(row.id),
            mblogid: row.mblogid || '',
            author: row.author || '',
            uid: String(row.uid || resolvedUid || ''),
            text: row.text || '',
            time: row.time || '',
            reposts: row.reposts ?? 0,
            comments: row.comments ?? 0,
            likes: row.likes ?? 0,
            pic_count: row.pic_count ?? 0,
            url: row.url || '',
        }));
    },
});
