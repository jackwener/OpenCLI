// arxiv pdf — download a paper's PDF to a local directory.
//
// Why this exists: the Atom feed already carries a PDF link, but agents had to
// fetch it themselves and re-derive a filename. This command resolves the ID,
// downloads once, and verifies the payload really is a PDF rather than the HTML
// error page arXiv serves for IDs it cannot resolve.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { httpDownload } from '@jackwener/opencli/download';
import { formatBytes } from '@jackwener/opencli/download/progress';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeArxivId } from './utils.js';

cli({
    site: 'arxiv',
    name: 'pdf',
    access: 'read',
    description: 'Download an arXiv paper PDF (arxiv.org/pdf/<id>)',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'arXiv paper ID (e.g. 1706.03762 or cs/0701001)' },
        { name: 'output', default: './arxiv-pdfs', help: 'Output directory (default ./arxiv-pdfs)' },
    ],
    columns: ['id', 'status', 'size', 'bytes', 'path', 'url'],
    func: async (args) => {
        const id = normalizeArxivId(args.id);
        const outputDir = String(args.output == null ? './arxiv-pdfs' : args.output);
        fs.mkdirSync(outputDir, { recursive: true });
        // Pre-2007 IDs contain a slash; flatten it so the file stays in one directory.
        const destPath = path.join(outputDir, id.replace(/\//g, '_') + '.pdf');
        const url = 'https://arxiv.org/pdf/' + id;
        const result = await httpDownload(url, destPath, { timeout: 120000, includeContentType: true });
        if (!result.success) {
            throw new CommandExecutionError('Failed to download ' + url + ': ' + (result.error || 'unknown error'));
        }
        if (result.contentType && result.contentType.indexOf('pdf') === -1) {
            throw new CommandExecutionError('Expected a PDF from ' + url + ' but received ' + result.contentType + '. Verify the ID with "opencli arxiv paper ' + id + '".');
        }
        return [{
            id: id,
            status: 'downloaded',
            size: formatBytes(result.size),
            bytes: result.size,
            path: path.resolve(destPath),
            url: url,
        }];
    },
});
