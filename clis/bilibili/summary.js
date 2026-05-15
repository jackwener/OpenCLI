/**
 * Bilibili summary — fetches the official AI-generated video summary (the "AI总结"
 * shown on the video page) via /x/web-interface/view/conclusion/get.
 * Returns the overall summary followed by the timestamped section outline.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { apiGet, resolveBvid } from './utils.js';
function formatTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
cli({
    site: 'bilibili',
    name: 'summary',
    access: 'read',
    description: '获取 B站视频的官方 AI 总结（视频页「AI总结」同款，含分段大纲与时间戳）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'bvid', required: true, positional: true, help: 'Video BV ID / URL / b23.tv short link' },
    ],
    columns: ['time', 'content'],
    func: async (page, kwargs) => {
        const bvid = await resolveBvid(kwargs.bvid);
        // The conclusion API needs cid + up_mid; both come from the view endpoint.
        const view = await apiGet(page, '/x/web-interface/view', { params: { bvid } });
        const cid = view?.data?.cid;
        const upMid = view?.data?.owner?.mid;
        if (!cid || !upMid)
            throw new Error(`Cannot resolve video info for bvid: ${bvid}`);
        const payload = await apiGet(page, '/x/web-interface/view/conclusion/get', {
            params: { bvid, cid, up_mid: upMid },
            signed: true,
        });
        if (payload?.code !== 0)
            throw new Error(`Bilibili conclusion request failed (code ${payload?.code}): ${payload?.message ?? 'unknown error'}`);
        const modelResult = payload?.data?.model_result ?? {};
        const summaryText = modelResult.summary ?? '';
        // data.code === 0 means a summary exists; not every video gets one.
        if (payload?.data?.code !== 0 || !summaryText)
            throw new EmptyResultError(`No AI summary available for bvid: ${bvid}`, 'Not every Bilibili video gets an AI summary.');
        const rows = [{ time: '', content: summaryText }];
        for (const section of modelResult.outline ?? []) {
            rows.push({ time: formatTime(section.timestamp), content: `# ${section.title ?? ''}` });
            for (const point of section.part_outline ?? []) {
                rows.push({ time: formatTime(point.timestamp), content: point.content ?? '' });
            }
        }
        return rows;
    },
});
