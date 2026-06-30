// nodeseek notifications — @-me notifications for the logged-in account.
//
// Source: GET /api/notification/at-me/list -> { success, data: [ {id, viewed,
//   comment_id, floor_id, created_at, commenter_id, commenter_name, title,
//   post_id, first_comment_id}, ... ] }
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchNsJson, readLimit } from './client.js';

/** Project a notification entry into a display row. */
function mapNotification(n) {
    return {
        viewed: n.viewed ? 'read' : 'NEW',
        commenter_name: n.commenter_name,
        title: n.title,
        post_id: n.post_id,
        floor_id: n.floor_id,
        created_at: n.created_at,
        link: `https://www.nodeseek.com/post-${n.post_id}-1#${n.comment_id}`,
    };
}

cli({
    site: 'nodeseek',
    name: 'notifications',
    access: 'read',
    description: 'NodeSeek @-me notifications (requires login)',
    domain: 'nodeseek.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'unread', type: 'boolean', default: false, help: 'Only show unread' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of notifications' },
    ],
    columns: ['viewed', 'commenter_name', 'title', 'post_id', 'floor_id', 'created_at', 'link'],
    func: async (page, kwargs) => {
        const limit = readLimit(kwargs.limit, { max: 100, command: 'nodeseek notifications' });
        const data = await fetchNsJson(page, '/api/notification/at-me/list');
        let list = Array.isArray(data?.data) ? data.data : [];
        if (kwargs.unread)
            list = list.filter((n) => !n.viewed);
        return list.slice(0, limit).map(mapNotification);
    },
});

export const __test__ = { mapNotification };
