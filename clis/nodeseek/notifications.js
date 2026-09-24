// nodeseek notifications — @-me notifications for the logged-in account.
//
// Source: GET /api/notification/at-me/list -> { success, data: [ {id, viewed,
//   comment_id, floor_id, created_at, commenter_id, commenter_name, title,
//   post_id, first_comment_id}, ... ] }
// The endpoint returns the ~50 most recent entries and ignores any page
// parameter (verified live), so there is nothing to paginate.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchNsJson, readLimit } from './client.js';

const MAX_LIMIT = 50; // hard window of /api/notification/at-me/list

/**
 * Project a notification entry into a display row. Deep links follow the
 * site's own notification-page format `post-<id>-<page>#<floor>` (floors are
 * paged 10 per page; anchors are floor numbers, not comment ids).
 */
function mapNotification(n) {
    const floorNo = Number(n.floor_id);
    const hasFloor = Number.isFinite(floorNo) && floorNo > 0;
    const pageNo = hasFloor ? Math.ceil(floorNo / 10) : 1;
    return {
        viewed: n.viewed ? 'read' : 'NEW',
        commenter_name: n.commenter_name,
        title: n.title,
        post_id: n.post_id,
        floor_id: n.floor_id,
        created_at: n.created_at,
        link: `https://www.nodeseek.com/post-${n.post_id}-${pageNo}` + (hasFloor ? `#${floorNo}` : ''),
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
        { name: 'unread', type: 'boolean', default: false, help: 'Only show unread (within the most recent 50)' },
        { name: 'limit', type: 'int', default: 20, help: `Number of notifications (API caps at the most recent ${MAX_LIMIT})` },
    ],
    columns: ['viewed', 'commenter_name', 'title', 'post_id', 'floor_id', 'created_at', 'link'],
    func: async (page, kwargs) => {
        const limit = readLimit(kwargs.limit, { max: MAX_LIMIT });
        const data = await fetchNsJson(page, '/api/notification/at-me/list');
        let list = Array.isArray(data?.data) ? data.data : [];
        if (kwargs.unread)
            list = list.filter((n) => !n.viewed);
        return list.slice(0, limit).map(mapNotification);
    },
});

export const __test__ = { mapNotification };
