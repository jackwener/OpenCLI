/**
 * Bilibili download — download videos using yt-dlp.
 *
 * Usage:
 *   opencli bilibili download --bvid BV1xxx --output ./bilibili
 *
 * Requirements:
 *   - yt-dlp must be installed: pip install yt-dlp
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError, CommandExecutionError, EXIT_CODES } from '@jackwener/opencli/errors';
import { checkYtdlp, sanitizeFilename } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
import { apiGet, resolveBvid, parsePageArg, selectVideoPart } from './utils.js';

const PAYMENT_LABELS = {
    vip: '大会员专享/付费 OGV',
    ugc_pay: 'UGC 单点付费',
    upower: '充电专属',
};

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 下载前付费预检：付费/会员视频 yt-dlp 只能拿到试看流或直接失败，
 * 与其跑一半吐一坨 yt-dlp stderr，不如提前抛结构化 PAID_CONTENT（exit 77）。
 *
 * 大会员专享（vip）会再查一次 nav API：当前账号大会员有效就放行（cookie 喂给
 * yt-dlp 能下完整流）。ugc_pay / upower 的购买/充电状态没有廉价查询端点，保守
 * 拦截，已购用户用 --force 跳过。预检自身的 API 失败不阻塞下载（保持旧行为）。
 */
async function assertNotPaidContent(page, bvid) {
    let d;
    try {
        const payload = await apiGet(page, '/x/web-interface/view', { params: { bvid } });
        if (!isObject(payload) || !Object.hasOwn(payload, 'code')) {
            throw new CommandExecutionError('Bilibili view API returned a malformed payload during paid-content pre-check');
        }
        if (payload.code !== 0)
            return;
        if (!isObject(payload.data) || !isObject(payload.data.rights)) {
            throw new CommandExecutionError('Bilibili view API returned malformed paid-content metadata');
        }
        d = payload.data;
    }
    catch (error) {
        if (error instanceof CommandExecutionError) {
            throw error;
        }
        return;
    }
    const rights = d.rights;
    const paymentType = rights.pay
        ? 'vip'
        : (rights.ugc_pay || rights.arc_pay)
            ? 'ugc_pay'
            : d.is_upower_exclusive
                ? 'upower'
                : '';
    if (!paymentType)
        return;
    if (paymentType === 'vip') {
        try {
            const nav = await apiGet(page, '/x/web-interface/nav');
            if (nav.code === 0 && Number(nav.data?.vipStatus) === 1)
                return;
        }
        catch {
            // nav 查询失败按"无会员"保守处理，走下面的拦截
        }
    }
    throw new CliError(
        'PAID_CONTENT',
        `该视频为付费内容（${PAYMENT_LABELS[paymentType]}），当前账号无观看权益，无法获取完整视频流`,
        '若已购买/已充电/已开通会员，加 --force 跳过本检查直接下载',
        EXIT_CODES.NOPERM,
    );
}

async function loadSelectedPart(page, bvid, pageNum) {
    let payload;
    try {
        payload = await apiGet(page, '/x/web-interface/view', { params: { bvid } });
    }
    catch (error) {
        throw new CommandExecutionError(`获取视频分P信息失败: ${error?.message || error}`);
    }
    if (!isObject(payload) || payload.code !== 0) {
        throw new CommandExecutionError(`获取视频分P信息失败: ${payload?.message ?? 'unknown'} (${payload?.code ?? 'malformed'})`);
    }
    return selectVideoPart(payload.data, pageNum);
}

cli({
    site: 'bilibili',
    name: 'download',
    access: 'read',
    description: '下载B站视频（需要 yt-dlp）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'bvid', required: true, positional: true, help: 'Video BV ID (e.g., BV1xxx)' },
        { name: 'output', default: './bilibili-downloads', help: 'Output directory' },
        { name: 'quality', default: 'best', help: 'Video quality (best, 1080p, 720p, 480p)' },
        { name: 'force', type: 'boolean', default: false, help: '跳过付费内容预检直接下载（已购买/已充电/已开通会员时用）' },
        { name: 'page', required: false, help: '分P 选集序号（从 1 开始）。多 P 视频下载该集；缺省下载默认 P1' },
    ],
    columns: ['bvid', 'title', 'status', 'size'],
    func: async (page, kwargs) => {
        const bvid = await resolveBvid(kwargs.bvid);
        const output = kwargs.output;
        const quality = kwargs.quality;
        const selectedPage = parsePageArg(kwargs.page);
        const selectedPart = selectedPage != null ? await loadSelectedPart(page, bvid, selectedPage) : null;
        // yt-dlp 原生支持分P URL（?p=N），直接拼到 watch URL 即可定位到该集。
        const watchUrl = selectedPage != null
            ? `https://www.bilibili.com/video/${bvid}?p=${selectedPage}`
            : `https://www.bilibili.com/video/${bvid}`;
        // Check yt-dlp availability
        if (!checkYtdlp()) {
            return [{
                    bvid,
                    title: '-',
                    status: 'failed',
                    size: 'yt-dlp not installed. Run: pip install yt-dlp',
                }];
        }
        // Navigate to video page to get title and cookies（分P 时定位到该集）
        await page.goto(watchUrl);
        await page.wait(3);
        // 付费内容预检（--force 跳过）
        if (!kwargs.force) {
            await assertNotPaidContent(page, bvid);
        }
        // Extract video info
        const data = await page.evaluate(`
      (() => {
        const title = document.querySelector('h1.video-title, .video-title')?.textContent?.trim() || 'video';
        const author = document.querySelector('.up-name, .username')?.textContent?.trim() || 'unknown';
        return { title, author };
      })()
    `);
        const partTitle = typeof selectedPart?.part === 'string' ? selectedPart.part.trim() : '';
        const displayTitle = partTitle || data?.title || 'video';
        const title = sanitizeFilename(displayTitle);
        // Extract cookies for yt-dlp
        const browserCookies = await page.getCookies({ domain: 'bilibili.com' });
        // Build yt-dlp format string based on quality
        let format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
        if (quality === '1080p') {
            format = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]';
        }
        else if (quality === '720p') {
            format = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]';
        }
        else if (quality === '480p') {
            format = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]';
        }
        const videoUrl = watchUrl;
        const filename = selectedPage != null ? `${bvid}_p${selectedPage}_${title}.mp4` : `${bvid}_${title}.mp4`;
        const results = await downloadMedia([{ type: 'video-ytdlp', url: videoUrl, filename }], {
            output,
            browserCookies,
            filenamePrefix: bvid,
            ytdlpExtraArgs: ['-f', format, '--merge-output-format', 'mp4', '--embed-thumbnail'],
        });
        // Map results to bilibili-specific columns
        const r = results[0] || { status: 'failed', size: '-' };
        return [{
                bvid,
                title: displayTitle,
                status: r.status,
                size: r.size,
            }];
    },
});
