import { cli, Strategy } from '@jackwener/opencli/registry';
/**
 * Build the notifications pipeline for the given web host. Exported so the
 * rednote adapter can register the same pipeline against www.rednote.com.
 */
export function buildNotificationsPipeline(webHost) {
    return [
        { navigate: `https://${webHost}/notification` },
        { tap: {
                store: 'notification',
                action: 'getNotification',
                args: [`\${{ args.type | default('mentions') }}`],
                capture: '/you/',
                select: 'data.message_list',
                timeout: 8,
            } },
        { map: {
                rank: '${{ index + 1 }}',
                user: '${{ item.user_info.nickname }}',
                action: '${{ item.title }}',
                content: '${{ item.comment_info.content }}',
                note: '${{ item.item_info.content }}',
                time: '${{ item.time }}',
            } },
        { limit: '${{ args.limit | default(20) }}' },
    ];
}
export const command = cli({
    site: 'xiaohongshu',
    name: 'notifications',
    access: 'read',
    description: '小红书通知 (mentions/likes/connections)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    args: [
        {
            name: 'type',
            default: 'mentions',
            help: 'Notification type: mentions, likes, or connections',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of notifications to return' },
    ],
    columns: ['rank', 'user', 'action', 'content', 'note', 'time'],
    pipeline: buildNotificationsPipeline('www.xiaohongshu.com'),
});
