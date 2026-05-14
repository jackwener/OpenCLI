import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

// Reddit subreddit names: 3–21 chars, letters/digits/underscore, must start
// with a letter. Accept an optional `r/` prefix and normalise it off.
const SUBREDDIT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,20}$/;

export function parseSubredditName(raw) {
    let name = String(raw || '').trim();
    if (!name) {
        throw new ArgumentError(
            'Subreddit name is required.',
            'Pass a subreddit name like `python` (or `r/python`).',
        );
    }
    if (name.startsWith('/r/')) name = name.slice(3);
    else if (name.startsWith('r/')) name = name.slice(2);
    if (!SUBREDDIT_NAME_RE.test(name)) {
        throw new ArgumentError(
            'Invalid subreddit name.',
            'Subreddit names are 3–21 characters, start with a letter, and contain only letters, digits, and underscores.',
        );
    }
    return name;
}

cli({
    site: 'reddit',
    name: 'subreddit-info',
    access: 'read',
    description: 'Show metadata for a Reddit subreddit (subscribers, description, created date, NSFW)',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'name', type: 'string', required: true, positional: true, help: 'Subreddit name (no `r/` prefix needed)' },
    ],
    columns: ['field', 'value'],
    func: async (page, kwargs) => {
        const sub = parseSubredditName(kwargs.name);
        await page.goto('https://www.reddit.com');
        // Banned / private / non-existent subreddits return a 404 envelope
        // ({"error":404,"reason":"banned"|"private"|null,"message":"Not Found"}).
        // We surface those as EmptyResultError so the table never contains a
        // silent sentinel row. Intermediate keys avoid `field`/`value`.
        const result = await page.evaluate(`(async () => {
      try {
        const sub = ${JSON.stringify(sub)};
        const res = await fetch('/r/' + encodeURIComponent(sub) + '/about.json?raw_json=1', { credentials: 'include' });
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          return { kind: 'missing', detail: 'Subreddit r/' + sub + ' was not found or is not accessible (HTTP ' + res.status + ').' };
        }
        if (!res.ok) {
          return { kind: 'http', httpStatus: res.status, where: '/r/' + sub + '/about.json' };
        }
        const j = await res.json();
        // Reddit may return an envelope-style 200 with {"kind":"Listing"} or
        // an error body for quarantined / private subs. Identify "subreddit
        // not found / not accessible" by the absence of data.display_name.
        if (j?.error) {
          if (j.error === 404 || j.reason === 'banned' || j.reason === 'private' || j.reason === 'quarantined') {
            return { kind: 'missing', detail: 'Subreddit r/' + sub + ' is ' + (j.reason || 'unavailable') + '.' };
          }
          return { kind: 'http', httpStatus: j.error, where: '/r/' + sub + '/about.json (' + (j.reason || 'error') + ')' };
        }
        const info = j?.data;
        if (!info || !info.display_name) {
          return { kind: 'malformed', detail: 'Reddit returned malformed subreddit info for r/' + sub + ' (missing data.display_name).' };
        }
        return { kind: 'ok', info };
      } catch (e) {
        return { kind: 'exception', detail: String(e && e.message || e) };
      }
    })()`);

        if (result?.kind === 'missing') {
            throw new EmptyResultError(result.detail);
        }
        if (result?.kind === 'http') {
            throw new CommandExecutionError(`HTTP ${result.httpStatus} from ${result.where}`);
        }
        if (result?.kind === 'malformed') {
            throw new CommandExecutionError(result.detail);
        }
        if (result?.kind === 'exception') {
            throw new CommandExecutionError(`subreddit-info failed: ${result.detail}`);
        }
        if (result?.kind !== 'ok') {
            throw new CommandExecutionError(`Unexpected result from reddit subreddit-info: ${JSON.stringify(result)}`);
        }

        const s = result.info;
        const created = s.created_utc
            ? new Date(s.created_utc * 1000).toISOString().split('T')[0]
            : null;
        const subscribers = typeof s.subscribers === 'number' ? s.subscribers : null;
        const activeNow = typeof s.active_user_count === 'number'
            ? s.active_user_count
            : (typeof s.accounts_active === 'number' ? s.accounts_active : null);
        const description = typeof s.public_description === 'string'
            ? s.public_description.trim()
            : '';

        return [
            { field: 'Name', value: s.display_name_prefixed || ('r/' + s.display_name) },
            { field: 'Title', value: typeof s.title === 'string' ? s.title : null },
            { field: 'Subscribers', value: subscribers != null ? String(subscribers) : null },
            { field: 'Active Now', value: activeNow != null ? String(activeNow) : null },
            { field: 'NSFW', value: s.over18 ? 'Yes' : 'No' },
            { field: 'Type', value: typeof s.subreddit_type === 'string' ? s.subreddit_type : null },
            { field: 'Description', value: description || null },
            { field: 'Created', value: created },
            { field: 'URL', value: s.url ? 'https://www.reddit.com' + s.url : null },
        ];
    },
});
