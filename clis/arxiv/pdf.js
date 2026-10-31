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

const PDF_SIGNATURE = Buffer.from('%PDF-');

/** True only when the file starts with the PDF signature. */
async function isPdfFile(filePath) {
    let handle;
    try {
        handle = await fs.promises.open(filePath, 'r');
        const header = Buffer.alloc(PDF_SIGNATURE.length);
        const { bytesRead } = await handle.read(header, 0, PDF_SIGNATURE.length, 0);
        return bytesRead === PDF_SIGNATURE.length && header.equals(PDF_SIGNATURE);
    } finally {
        if (handle) await handle.close();
    }
}

async function discard(filePath) {
    try {
        await fs.promises.rm(filePath, { force: true });
    } catch {
        // The download or validation error is what matters; cleanup must not mask it.
    }
}

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
        // Pre-2007 IDs contain a slash; flatten it so the file stays in one directory.
        const destPath = path.join(outputDir, id.replace(/\//g, '_') + '.pdf');
        const url = 'https://arxiv.org/pdf/' + id;
        await fs.promises.mkdir(outputDir, { recursive: true });
        // Download beside the destination under a temporary name. The final name is
        // only created by the atomic rename below, so a failed download or a non-PDF
        // response leaves any existing valid file untouched.
        const tempPath = path.join(
            outputDir,
            '.' + path.basename(destPath) + '.' + process.pid + '-' + Date.now() + '.part',
        );
        try {
            const result = await httpDownload(url, tempPath, { timeout: 120000, includeContentType: true });
            if (!result.success) {
                throw new CommandExecutionError('Failed to download ' + url + ': ' + (result.error || 'unknown error'));
            }
            // A server can claim application/pdf and still send an HTML error page,
            // and a missing content type says nothing about the payload, so the bytes
            // themselves decide whether the download succeeded.
            if (!(await isPdfFile(tempPath))) {
                const received = result.contentType ? ' but received ' + result.contentType : '';
                throw new CommandExecutionError('Expected a PDF from ' + url + received + '. Verify the ID with "opencli arxiv paper ' + id + '".');
            }
            const { size } = await fs.promises.stat(tempPath);
            await fs.promises.rename(tempPath, destPath);
            return [{
                id: id,
                status: 'downloaded',
                size: formatBytes(size),
                bytes: size,
                path: path.resolve(destPath),
                url: url,
            }];
        } finally {
            await discard(tempPath);
        }
    },
});
