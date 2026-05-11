import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { httpDownload, sanitizeFilename } from '@jackwener/opencli/download';
import { formatBytes } from '@jackwener/opencli/download/progress';
import { loadXiaoyuzhouCredentials, requestXiaoyuzhouJson } from './auth.js';

cli({
    site: 'xiaoyuzhou',
    name: 'download',
    access: 'read',
    description: 'Download Xiaoyuzhou episode audio',
    domain: 'www.xiaoyuzhoufm.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Episode ID (eid from podcast-episodes output)' },
        { name: 'output', default: './xiaoyuzhou-downloads', help: 'Output directory' },
    ],
    columns: ['title', 'podcast', 'status', 'size', 'file'],
    func: async (args) => {
        const credentials = loadXiaoyuzhouCredentials();
        const response = await requestXiaoyuzhouJson('/v1/episode/get', {
            query: { eid: args.id },
            credentials,
        });
        const ep = response.data;
        if (!ep) {
            throw new CliError('NOT_FOUND', 'Episode not found', 'Please check the ID');
        }
        const audioUrl = ep.media?.source?.url;
        if (!audioUrl) {
            throw new CliError('PARSE_ERROR', 'Audio URL not found in episode payload', 'Episode payload does not expose media.source.url');
        }
        const output = String(args.output || './xiaoyuzhou-downloads');
        const ext = path.extname(new URL(audioUrl).pathname) || '.mp3';
        const title = String(ep.title || 'episode');
        const filename = `${args.id}_${sanitizeFilename(title, 80) || 'episode'}${ext}`;
        const outputDir = path.join(output, String(args.id));
        fs.mkdirSync(outputDir, { recursive: true });
        const destPath = path.join(outputDir, filename);
        const result = await httpDownload(audioUrl, destPath, {
            timeout: 60000,
        });
        return [{
                title,
                podcast: ep.podcast?.title || '-',
                status: result.success ? 'success' : 'failed',
                size: result.success ? formatBytes(result.size) : (result.error || 'unknown error'),
                file: result.success ? destPath : '-',
            }];
    },
});
