/**
 * Xiaohongshu Creator Analytics — account-level metrics overview.
 *
 * Uses the creator.xiaohongshu.com internal API (cookie auth).
 * Returns 7-day and 30-day aggregate stats: views, likes, collects,
 * comments, shares, new followers, and daily trend data.
 *
 * Requires: logged into creator.xiaohongshu.com in Chrome.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'xiaohongshu',
    name: 'creator-stats',
    access: 'read',
    description: '小红书创作者数据总览 (观看/点赞/收藏/评论/分享/涨粉，含每日趋势)',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        {
            name: 'period',
            type: 'string',
            default: 'seven',
            help: 'Stats period: seven or thirty',
            choices: ['seven', 'thirty'],
        },
    ],
    columns: ['metric', 'total', 'trend'],
    func: async (page, kwargs) => {
        const period = kwargs.period || 'seven';
        // Navigate to creator center for cookie context
        await page.goto('https://creator.xiaohongshu.com/new/home');
        const data = await page.evaluate(`
      async () => {
        try {
          const resp = await fetch('/api/galaxy/creator/data/note_detail_new', {
            credentials: 'include',
          });
          if (!resp.ok) return { error: 'HTTP ' + resp.status };
          return await resp.json();
        } catch (e) {
          return { error: e.message };
        }
      }
    `);
        if (data?.error) {
            throw new Error(data.error + '. Are you logged into creator.xiaohongshu.com?');
        }
        if (!data?.data) {
            throw new Error('Unexpected response structure');
        }
        const stats = data.data[period];
        if (!stats) {
            throw new Error(`No data for period "${period}". Available: ${Object.keys(data.data).join(', ')}`);
        }
        // Format daily trend as sparkline-like summary
        const formatTrend = (list) => {
            if (!list || !list.length)
                return '-';
            return list.map((d) => d.count).join(' → ');
        };
        return [
            { metric: '观看数 (views)', total: stats.view_count ?? 0, trend: formatTrend(stats.view_list) },
            { metric: '平均观看时长 (avg view time ms)', total: stats.view_time_avg ?? 0, trend: formatTrend(stats.view_time_list) },
            { metric: '主页访问 (home views)', total: stats.home_view_count ?? 0, trend: formatTrend(stats.home_view_list) },
            { metric: '点赞数 (likes)', total: stats.like_count ?? 0, trend: formatTrend(stats.like_list) },
            { metric: '收藏数 (collects)', total: stats.collect_count ?? 0, trend: formatTrend(stats.collect_list) },
            { metric: '评论数 (comments)', total: stats.comment_count ?? 0, trend: formatTrend(stats.comment_list) },
            { metric: '弹幕数 (danmaku)', total: stats.danmaku_count ?? 0, trend: '-' },
            { metric: '分享数 (shares)', total: stats.share_count ?? 0, trend: formatTrend(stats.share_list) },
            { metric: '涨粉数 (new followers)', total: stats.rise_fans_count ?? 0, trend: formatTrend(stats.rise_fans_list) },
        ];
    },
});
