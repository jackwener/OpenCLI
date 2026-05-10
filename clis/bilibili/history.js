import { cli, Strategy } from '@jackwener/opencli/registry';
import { apiGet, payloadData } from './utils.js';
cli({
    site: 'bilibili',
    name: 'history',
    access: 'read',
    description: '我的观看历史',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'author', 'progress', 'url'],
    func: async (page, kwargs) => {
        const { limit = 20 } = kwargs;
        const payload = await apiGet(page, '/x/web-interface/history/cursor', {
            params: { ps: Math.min(Number(limit), 30), type: 'archive' },
        });
        const list = payloadData(payload)?.list ?? [];
        return list.slice(0, Number(limit)).map((item, i) => {
            const progress = item.progress ?? 0;
            const duration = item.duration ?? 0;
            let progressStr;
            if (progress < 0 || progress >= duration) {
                progressStr = '已看完';
            }
            else {
                const pct = duration > 0 ? Math.round(progress / duration * 100) : 0;
                progressStr = `${formatDuration(progress)}/${formatDuration(duration)} (${pct}%)`;
            }
            return {
                rank: i + 1,
                title: item.title ?? '',
                author: item.author_name ?? '',
                progress: progressStr,
                url: item.history?.bvid ? `https://www.bilibili.com/video/${item.history.bvid}` : '',
            };
        });
    },
});
function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}
