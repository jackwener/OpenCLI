/**
 * Rednote notifications — calls `notification.getNotification(type)` and reads
 * `notification.activeTabMessageList` from the Pinia store.
 *
 * Differs from xiaohongshu/notifications because the rednote intercept tap
 * does not see a fresh `/you/` request after `getNotification`. The store is
 * populated directly, so a `func`-mode read is more reliable. Field names
 * accept both snake_case (`user_info.nickname`) and camelCase
 * (`userInfo.nickName`) to absorb the same SSR client-transform diff that
 * `feed` hits on rednote.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const NOTIFICATION_TYPES = new Set(['mentions', 'likes', 'connections']);

function parseNotificationType(raw) {
    const type = String(raw ?? 'mentions');
    if (!NOTIFICATION_TYPES.has(type)) {
        throw new ArgumentError(`--type must be one of mentions, likes, or connections, got ${JSON.stringify(raw)}`);
    }
    return type;
}

function parseLimit(raw) {
    const parsed = Number(raw ?? 20);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be a positive integer, got ${JSON.stringify(raw)}`);
    }
    if (parsed < 1) {
        throw new ArgumentError(`--limit must be a positive integer, got ${parsed}`);
    }
    return parsed;
}

const READ_NOTIFICATIONS_JS = `
  (async (type) => {
    let pinia = null;
    const probe = (el) => el?.__vue_app__?.config?.globalProperties?.$pinia ?? null;
    pinia = probe(document.querySelector('#app'));
    if (!pinia) {
      for (const el of document.querySelectorAll('*')) {
        pinia = probe(el);
        if (pinia) break;
      }
    }
    if (!pinia || !pinia._s) return { error: 'no_pinia' };
    const store = pinia._s.get('notification');
    if (!store) return { error: 'no_notification_store' };
    if (typeof store.getNotification !== 'function') return { error: 'no_getNotification_action' };
    try { await store.getNotification(type); } catch (e) { return { error: 'action_failed', detail: e?.message }; }
    // Read messages from whichever store path is populated. rednote keeps the
    // current tab in activeTabMessageList but may instead drop the list into
    // notificationMap[type] (or notificationMap[type].messages) depending on
    // the build, so check both before timing out.
    const readMessages = () => {
      if (Array.isArray(store.activeTabMessageList) && store.activeTabMessageList.length > 0) return store.activeTabMessageList;
      const tab = store.notificationMap?.[type];
      if (Array.isArray(tab) && tab.length > 0) return tab;
      if (Array.isArray(tab?.messages) && tab.messages.length > 0) return tab.messages;
      if (Array.isArray(tab?.messageList) && tab.messageList.length > 0) return tab.messageList;
      return null;
    };
    let messages = null;
    for (let i = 0; i < 16; i++) {
      messages = readMessages();
      if (messages) break;
      await new Promise(r => setTimeout(r, 500));
    }
    const arr = messages ?? (Array.isArray(store.activeTabMessageList) ? store.activeTabMessageList : []);
    const pick = (item, snake, camel) => item?.[snake] ?? item?.[camel];
    // Try the leaf as written, plus its snake→camel and camel→snake variants.
    // Needed because rednote ships e.g. \`userInfo.nickName\` while xhs returns
    // \`user_info.nickname\` (or \`user_info.nick_name\`); the field name varies
    // independently of the wrapping object name.
    const leafVariants = (leaf) => {
      const camel = leaf.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const snake = leaf.replace(/([A-Z])/g, (_, c) => '_' + c.toLowerCase());
      const capCamel = leaf.charAt(0) + leaf.slice(1).replace(/([a-z])([A-Z])/g, '$1$2').replace(/(^|_)([a-z])/g, (_, sep, c) => (sep ? c.toUpperCase() : c));
      return [...new Set([leaf, camel, snake, capCamel])];
    };
    const nested = (item, snake, camel, ...leafCandidates) => {
      const a = pick(item, snake, camel);
      if (!a || typeof a !== 'object') return '';
      for (const candidate of leafCandidates) {
        for (const variant of leafVariants(candidate)) {
          if (a[variant] != null && a[variant] !== '') return a[variant];
        }
      }
      return '';
    };
    return {
      items: arr.map(item => ({
        user: nested(item, 'user_info', 'userInfo', 'nickname', 'nickName'),
        action: item?.title ?? item?.actionTitle ?? '',
        content: nested(item, 'comment_info', 'commentInfo', 'content'),
        note: nested(item, 'item_info', 'itemInfo', 'content'),
        time: item?.time ?? item?.timestamp ?? '',
      })),
    };
  })(${JSON.stringify('PLACEHOLDER_TYPE')})
`;

export const command = cli({
    site: 'rednote',
    name: 'notifications',
    access: 'read',
    description: 'Rednote notifications (mentions/likes/connections)',
    domain: 'www.rednote.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        {
            name: 'type',
            default: 'mentions',
            help: 'Notification type: mentions, likes, or connections',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of notifications to return' },
    ],
    columns: ['rank', 'user', 'action', 'content', 'note', 'time'],
    func: async (page, kwargs) => {
        const type = parseNotificationType(kwargs.type);
        const limit = parseLimit(kwargs.limit);
        await page.goto('https://www.rednote.com/notification');
        await page.wait({ time: 2 });
        const script = READ_NOTIFICATIONS_JS.replace(JSON.stringify('PLACEHOLDER_TYPE'), JSON.stringify(type));
        const data = await page.evaluate(script);
        if (!data || typeof data !== 'object') {
            throw new CommandExecutionError('rednote notifications: unexpected evaluate response');
        }
        if (data.error) {
            throw new CommandExecutionError(`rednote notifications: ${data.error}${data.detail ? ' (' + data.detail + ')' : ''}`, 'The rednote SPA may still be hydrating; reload www.rednote.com/notification and retry.');
        }
        return (data.items || [])
            .slice(0, limit)
            .map((row, i) => ({ rank: i + 1, ...row }));
    },
});
