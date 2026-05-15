import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'reddit',
    name: 'whoami',
    access: 'read',
    description: 'Show the currently logged-in Reddit user',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [],
    columns: ['field', 'value'],
    func: async (page) => {
        await page.goto('https://www.reddit.com');
        // Probe identity via /api/me.json. Reddit returns 200 with an empty
        // body for stale anonymous sessions, so 401/403 alone is not a
        // sufficient logged-out signal — we also verify `data.name` exists
        // (two-pronged auth detection from PR #1428).
        //
        // Intermediate object keys deliberately avoid `field` / `value` to
        // sidestep the silent-column-drop audit (columns are ['field',
        // 'value']) — see PR #1329 sediment "中间解析对象 key 不能跟 columns
        // 任一项重叠".
        const result = await page.evaluate(`(async () => {
      try {
        const res = await fetch('/api/me.json?raw_json=1', { credentials: 'include' });
        if (res.status === 401 || res.status === 403) {
          return { kind: 'auth', detail: 'Reddit /api/me.json returned HTTP ' + res.status };
        }
        if (!res.ok) {
          return { kind: 'http', httpStatus: res.status, where: '/api/me.json' };
        }
        const d = await res.json();
        const me = d?.data;
        if (!me?.name) {
          return { kind: 'auth', detail: 'Not logged in to reddit.com (no identity in /api/me.json)' };
        }
        return { kind: 'ok', identity: me };
      } catch (e) {
        return { kind: 'exception', detail: String(e && e.message || e) };
      }
    })()`);

        if (result?.kind === 'auth') {
            throw new AuthRequiredError('reddit.com', result.detail);
        }
        if (result?.kind === 'http') {
            throw new CommandExecutionError(`HTTP ${result.httpStatus} from ${result.where}`);
        }
        if (result?.kind === 'exception') {
            throw new CommandExecutionError(`whoami failed: ${result.detail}`);
        }
        if (result?.kind !== 'ok') {
            throw new CommandExecutionError(`Unexpected result from reddit whoami: ${JSON.stringify(result)}`);
        }

        const u = result.identity;
        const created = u.created_utc
            ? new Date(u.created_utc * 1000).toISOString().split('T')[0]
            : null;
        const linkKarma = typeof u.link_karma === 'number' ? u.link_karma : null;
        const commentKarma = typeof u.comment_karma === 'number' ? u.comment_karma : null;
        const totalKarma = typeof u.total_karma === 'number'
            ? u.total_karma
            : (linkKarma != null && commentKarma != null ? linkKarma + commentKarma : null);
        const inboxCount = typeof u.inbox_count === 'number' ? u.inbox_count : null;

        return [
            { field: 'Username', value: 'u/' + u.name },
            { field: 'ID', value: u.id ? 't2_' + u.id : null },
            { field: 'Post Karma', value: linkKarma != null ? String(linkKarma) : null },
            { field: 'Comment Karma', value: commentKarma != null ? String(commentKarma) : null },
            { field: 'Total Karma', value: totalKarma != null ? String(totalKarma) : null },
            { field: 'Account Created', value: created },
            { field: 'Gold', value: u.is_gold ? 'Yes' : 'No' },
            { field: 'Mod', value: u.is_mod ? 'Yes' : 'No' },
            { field: 'Verified Email', value: u.has_verified_email ? 'Yes' : 'No' },
            { field: 'Has Mail', value: u.has_mail ? 'Yes' : 'No' },
            { field: 'Inbox Count', value: inboxCount != null ? String(inboxCount) : null },
        ];
    },
});
