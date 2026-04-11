import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildScysOpportunityUrl } from './common.js';
import { extractScysOpportunity } from './extractors.js';
import { normalizeOpportunityTab } from './opportunity-utils.js';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
import * as path from 'node:path';
cli({
    site: 'scys',
    name: 'opportunity',
    description: 'Extract SCYS opportunity feed with flags, summaries, and tags',
    domain: 'scys.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', positional: true, default: buildScysOpportunityUrl(), help: 'Opportunity URL' },
        { name: 'tab', default: 'all', help: 'Filter tab: all/全部, hot/热门, winning/中标' },
        { name: 'limit', type: 'int', default: 20, help: 'Max number of cards' },
        { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
        { name: 'download-images', type: 'boolean', default: false, help: 'Download post images to local directory' },
        { name: 'output', default: './scys-opportunity-downloads', help: 'Image output directory' },
    ],
    columns: ['rank', 'author', 'time', 'flags', 'title', 'summary', 'ai_summary', 'tags', 'interactions_display', 'image_count', 'url', 'image_dir'],
    func: async (page, kwargs) => {
        const tab = normalizeOpportunityTab(kwargs.tab);
        const rows = await extractScysOpportunity(page, String(kwargs.url ?? buildScysOpportunityUrl()), {
            waitSeconds: Number(kwargs.wait ?? 3),
            limit: Number(kwargs.limit ?? 20),
            tab: tab.label,
        });
        const downloadImages = kwargs['download-images'] === true || String(kwargs['download-images']) === 'true';
        if (!downloadImages)
            return rows;
        const output = String(kwargs.output ?? './scys-opportunity-downloads');
        const cookies = formatCookieHeader(await page.getCookies({ domain: 'scys.com' }));
        const withDownloads = [];
        for (const row of rows) {
            const imageUrls = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
            if (imageUrls.length === 0) {
                withDownloads.push({ ...row, image_count: 0, image_dir: '' });
                continue;
            }
            const topicId = row.topic_id || `opportunity_${row.rank}`;
            const subdir = path.join(tab.label, topicId);
            const media = imageUrls.map((url, idx) => ({
                type: 'image',
                url,
                filename: `${topicId}_${idx + 1}.jpg`,
            }));
            const results = await downloadMedia(media, {
                output,
                subdir,
                cookies,
                filenamePrefix: topicId,
                timeout: 60_000,
                verbose: false,
            });
            const successCount = results.filter((r) => r.status === 'success').length;
            withDownloads.push({
                ...row,
                image_count: successCount,
                image_dir: path.join(output, subdir),
            });
        }
        return withDownloads;
    },
});
