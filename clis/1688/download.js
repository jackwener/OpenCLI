import * as path from 'node:path';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { cleanText } from './shared.js';
import { extractAssetsForInput } from './assets.js';
function extFromUrl(url, fallback) {
    try {
        const ext = path.extname(new URL(url).pathname).toLowerCase();
        if (ext && ext.length <= 8)
            return ext;
    }
    catch {
        // ignore
    }
    return fallback;
}
function toDownloadItems(offerId, assets) {
    const items = [];
    const pushImages = (urls, prefix) => {
        urls.forEach((url, index) => {
            items.push({
                type: 'image',
                url,
                filename: `${offerId}_${prefix}_${String(index + 1).padStart(2, '0')}${extFromUrl(url, '.jpg')}`,
            });
        });
    };
    pushImages(assets.main_images, 'main');
    pushImages(assets.sku_images, 'sku');
    pushImages(assets.detail_images, 'detail');
    pushImages(assets.other_images, 'other');
    assets.videos.forEach((url, index) => {
        items.push({
            type: 'video',
            url,
            filename: `${offerId}_video_${String(index + 1).padStart(2, '0')}${extFromUrl(url, '.mp4')}`,
        });
    });
    return items;
}
cli({
    site: '1688',
    name: 'download',
    description: '批量下载 1688 商品页可提取的图片和视频素材',
    domain: 'www.1688.com',
    strategy: Strategy.COOKIE,
    args: [
        {
            name: 'input',
            required: true,
            positional: true,
            help: '1688 商品 URL 或 offer ID（如 887904326744）',
        },
        { name: 'output', default: './1688-downloads', help: '输出目录' },
    ],
    columns: ['index', 'type', 'status', 'size'],
    func: async (page, kwargs) => {
        const assets = await extractAssetsForInput(page, String(kwargs.input ?? ''));
        const offerId = cleanText(assets.offer_id) || '1688';
        const items = toDownloadItems(offerId, assets);
        const browserCookies = await page.getCookies({ domain: '1688.com' });
        return downloadMedia(items, {
            output: String(kwargs.output || './1688-downloads'),
            subdir: offerId,
            cookies: formatCookieHeader(browserCookies),
            browserCookies,
            filenamePrefix: offerId,
            timeout: 60000,
        });
    },
});
export const __test__ = {
    extFromUrl,
    toDownloadItems,
};
