import fs from 'node:fs/promises';
import path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    assertApiSuccess,
    fetchWithCookies,
    postForm,
    postFormRaw,
    requiredText,
} from './utils.js';

const CAN_EXPORT_PATH = '/api/com.liepin.zhuque.resexport.can-export';
const GENERATE_PATH = '/api/com.liepin.sphinx.generate-doc';
const RESUME_DETAIL_URL = 'https://lpt.liepin.com/cvview/showresumedetail';

function normalizeFormat(raw) {
    const format = String(raw || 'pdf').toLowerCase();
    if (!['pdf', 'word'].includes(format)) {
        throw new ArgumentError('liepin format must be pdf or word');
    }
    return format;
}

async function resolveOutput(raw, resumeId, format) {
    const extension = format === 'word' ? 'docx' : 'pdf';
    const requested = path.resolve(String(raw || '.'));
    try {
        const stat = await fs.stat(requested);
        if (stat.isDirectory()) return path.join(requested, `liepin-${resumeId}.${extension}`);
    } catch {
        // A non-existent path may be an intended filename.
    }
    if (path.extname(requested)) return requested;
    return path.join(requested, `liepin-${resumeId}.${extension}`);
}

async function downloadAttachmentPdf(page, resumeId) {
    if (typeof page.goto !== 'function' || typeof page.evaluate !== 'function'
        || typeof page.startNetworkCapture !== 'function' || typeof page.readNetworkCapture !== 'function') {
        throw new CommandExecutionError('Liepin attachment fallback requires a browser page with network capture');
    }
    const detailUrl = `${RESUME_DETAIL_URL}?resIdEncode=${encodeURIComponent(resumeId)}`;
    await page.goto(detailUrl, { settleMs: 3000 });
    await page.startNetworkCapture('');
    const clicked = await page.evaluate(() => {
        const link = [...document.querySelectorAll('a.download--XzEwN')]
            .find((node) => node.textContent?.trim() === '下载');
        if (!(link instanceof HTMLElement)) return false;
        link.click();
        return true;
    });
    if (!clicked) throw new CommandExecutionError('Liepin resume page did not expose an attachment download');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const events = await page.readNetworkCapture();
    const attachmentEvent = events.find((event) => String(event?.url || '')
        .includes('com.liepin.zhuque.resumeview.get-resume-attachment'));
    const responsePreview = attachmentEvent?.responsePreview;
    if (typeof responsePreview !== 'string') {
        throw new CommandExecutionError('Liepin attachment request did not return a download URL');
    }
    let accessPath;
    try {
        accessPath = JSON.parse(responsePreview)?.data?.accessPath;
    } catch {
        throw new CommandExecutionError('Liepin attachment response was not valid JSON');
    }
    if (!accessPath) throw new CommandExecutionError('Liepin attachment response did not include data.accessPath');
    const base64 = await page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }
        return btoa(binary);
    }, accessPath);
    const bytes = Buffer.from(String(base64), 'base64');
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new CommandExecutionError('Liepin attachment download did not return a PDF');
    }
    return bytes;
}

cli({
    site: 'liepin',
    name: 'download-resume',
    access: 'write',
    description: '导出并下载猎聘简历（PDF 或 Word）',
    domain: 'api-lpt.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'resumeId', type: 'string', required: true, positional: true, help: '加密简历 ID' },
        { name: 'resume-format', type: 'string', default: 'pdf', help: '导出格式：pdf 或 word' },
        { name: 'output', type: 'string', default: '.', help: '输出文件或目录' },
        { name: 'jobId', type: 'string', default: '', help: '关联招聘职位 ID（可选）' },
        { name: 'applyId', type: 'string', default: '', help: '应聘记录 ID（可选）' },
        { name: 'overwrite', type: 'boolean', default: false, help: '允许覆盖已存在文件' },
    ],
    columns: ['resume_id', 'format', 'path', 'bytes'],
    func: async (page, args) => {
        const resumeId = requiredText(args.resumeId, 'resumeId');
        const format = normalizeFormat(args['resume-format']);
        const outputPath = await resolveOutput(args.output, resumeId, format);
        if (!args.overwrite) {
            try {
                await fs.access(outputPath);
                throw new ArgumentError(`output already exists: ${outputPath}`, 'Pass --overwrite true to replace it');
            } catch (error) {
                if (error instanceof ArgumentError) throw error;
            }
        }

        let bytes;
        try {
            const permission = await postFormRaw(page, CAN_EXPORT_PATH, { resIdEncode: resumeId });
            assertApiSuccess(permission);
            const generated = await postForm(page, GENERATE_PATH, {
                strategyId: 10,
                params: JSON.stringify({
                    encryResId: resumeId,
                    applyId: args.applyId || '',
                    resumeFmt: format,
                    dqCode: '',
                    jobtitleCode: '',
                    sss: '',
                    sScene: '',
                    ejobId: args.jobId || '',
                    sphinxScene: '1',
                }),
            });
            const objectId = generated?.data?.objectId;
            if (!objectId) throw new CommandExecutionError('Liepin export response did not include data.objectId');
            const response = await fetchWithCookies(page, `https://tdoss.liepin.com/o${objectId}&download=1`);
            bytes = Buffer.from(await response.arrayBuffer());
        } catch (error) {
            if (format !== 'pdf') throw error;
            bytes = await downloadAttachmentPdf(page, resumeId);
        }
        if (bytes.length === 0) throw new CommandExecutionError('Liepin exported an empty resume file');
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, bytes);
        return [{ resume_id: resumeId, format, path: outputPath, bytes: bytes.length }];
    },
});

export const __test__ = { normalizeFormat, resolveOutput, downloadAttachmentPdf };
