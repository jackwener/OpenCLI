import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { callNotebooklmRpc } from './rpc.js';
import { buildNotebooklmNotebookUrl, ensureNotebooklmHome, getNotebooklmAuthuser, parseNotebooklmNotebookTarget, requireNotebooklmExecute, requireNotebooklmSession, verifyNotebooklmSourceAdded } from './utils.js';

const NOTEBOOKLM_ADD_SOURCES_RPC_ID = 'izAoDd';
const NOTEBOOKLM_ADD_FILE_SOURCE_RPC_ID = 'o4cbdc';
const MAX_TEXT_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_SOURCE_BYTES = 50 * 1024 * 1024;
const SOURCE_UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const MIME_BY_EXT = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.epub': 'application/epub+zip',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
};

export function inferMimeType(filename, override) {
    if (override) return String(override);
    const ext = path.extname(filename).toLowerCase();
    return MIME_BY_EXT[ext] || 'application/octet-stream';
}

export function readFileForUpload(filePath) {
    const abs = path.resolve(filePath);
    let stat;
    try {
        stat = fs.statSync(abs);
    } catch {
        throw new ArgumentError(`--file path does not exist: ${filePath}`);
    }
    if (!stat.isFile()) {
        throw new ArgumentError(`--file path is not a regular file: ${filePath}`);
    }
    if (stat.size > MAX_FILE_SOURCE_BYTES) {
        throw new ArgumentError(`--file exceeds ${MAX_FILE_SOURCE_BYTES} bytes (got ${stat.size}); use a smaller file or upload via the NotebookLM UI for now.`);
    }
    const buf = fs.readFileSync(abs);
    return { base64: buf.toString('base64'), filename: path.basename(abs), size: stat.size };
}

export function buildRegisterFileSourceArgs(projectId, filename) {
    return [
        [[filename]],
        projectId,
        [2],
        [1, null, null, null, null, null, null, null, null, null, [1]],
    ];
}

export function parseSourceUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new ArgumentError(`Invalid source URL: "${url}"`, 'URL must be a valid http:// or https:// URL.');
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
        throw new ArgumentError(`Invalid source URL: "${url}"`, 'URL must start with http:// or https://.');
    }
    return parsed.toString();
}

export function parseSourceText(value) {
    if (value === undefined || value === null) return null;
    const text = String(value);
    if (!text.trim()) throw new ArgumentError('--content must not be empty');
    if (text.length > MAX_TEXT_SOURCE_BYTES) {
        throw new ArgumentError(`--content exceeds ${MAX_TEXT_SOURCE_BYTES} bytes; split into smaller sources or upload as a file.`);
    }
    return text;
}

export function parseSourceTitle(value, fallback) {
    const title = String(value ?? '').trim();
    return title || fallback;
}

export function buildAddSourceFromUrlArgs(projectId, url) {
    return [[[null, null, [url]]], projectId];
}

export function buildAddSourceFromTextArgs(projectId, title, content) {
    return [[[null, [title, content], null, 2]], projectId];
}

function toExcludedUuidSet(excludedIds) {
    return new Set(excludedIds.map((id) => String(id ?? '').toLowerCase()).filter(Boolean));
}

export function parseAddSourceResult(result, excludedIds = []) {
    const excluded = toExcludedUuidSet(excludedIds);
    if (typeof result === 'string') return SOURCE_UUID_RE.test(result) && !excluded.has(result.toLowerCase()) ? result : '';
    if (!Array.isArray(result) && (typeof result !== 'object' || result === null)) return '';
    const stack = [result];
    while (stack.length) {
        const node = stack.shift();
        if (typeof node === 'string') {
            if (SOURCE_UUID_RE.test(node) && !excluded.has(node.toLowerCase())) return node;
            continue;
        }
        if (Array.isArray(node)) {
            for (const child of node) stack.push(child);
            continue;
        }
        if (node && typeof node === 'object') {
            for (const value of Object.values(node)) stack.push(value);
        }
    }
    return '';
}

async function uploadFileViaDriveResumable(page, projectId, sourceId, filename, base64, size) {
    const authuser = getNotebooklmAuthuser() || '0';
    const metadataJson = `{"PROJECT_ID":${JSON.stringify(projectId)},"SOURCE_NAME":${JSON.stringify(filename)},"SOURCE_ID":${JSON.stringify(sourceId)}}`;
    const script = String.raw`(async () => {
    try {
      const initRes = await fetch(${JSON.stringify('https://notebooklm.google.com/upload/_/?authuser=' + authuser)}, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Header-Content-Length': ${JSON.stringify(String(size))},
          'X-Goog-AuthUser': ${JSON.stringify(authuser)},
        },
        body: ${JSON.stringify(metadataJson)},
      });
      if (!initRes.ok) {
        const status = initRes.headers.get('X-Goog-Upload-Status') || '';
        const text = (await initRes.text()).slice(0, 400);
        return { error: 'init failed HTTP ' + initRes.status + (status ? ' upload-status=' + status : '') + (text ? ' body=' + text : '') };
      }
      const uploadURL = initRes.headers.get('X-Goog-Upload-Url') || initRes.headers.get('x-goog-upload-url');
      if (!uploadURL) return { error: 'no X-Goog-Upload-URL header in init response' };
      // Decode base64 to Uint8Array for binary PUT
      const bin = atob(${JSON.stringify(base64)});
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const uploadRes = await fetch(uploadURL, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
          'X-Goog-AuthUser': ${JSON.stringify(authuser)},
        },
        body: bytes,
      });
      if (!uploadRes.ok) {
        const status = uploadRes.headers.get('X-Goog-Upload-Status') || '';
        const text = (await uploadRes.text()).slice(0, 400);
        return { error: 'upload failed HTTP ' + uploadRes.status + (status ? ' upload-status=' + status : '') + (text ? ' body=' + text : '') };
      }
      return { ok: true, status: uploadRes.status };
    } catch (e) {
      return { error: 'upload exception: ' + ((e && e.message) || String(e)) };
    }
  })()`;
    const raw = await page.evaluate(script);
    const result = raw && typeof raw === 'object' && 'data' in raw && 'session' in raw ? raw.data : raw;
    if (!result || result.error) {
        throw new CommandExecutionError('NotebookLM file upload failed: ' + (result?.error || 'unknown error'));
    }
    return result;
}

cli({
    site: NOTEBOOKLM_SITE,
    name: 'add-source',
    access: 'write',
    description: 'Add a URL, text, or local file source to an existing NotebookLM notebook',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'notebook', positional: true, required: true, help: 'Notebook id from `notebooklm list` or full notebook URL' },
        { name: 'url', help: 'Source URL to add (http/https). Pass exactly one of --url, --content, --file.' },
        { name: 'content', help: 'Raw text content to add as a Text source (max 10 MB).' },
        { name: 'file', help: `Local file path to upload as a source (max ${MAX_FILE_SOURCE_BYTES} bytes; pdf / txt / md / html / docx / etc.). Uses Google Drive's 3-step resumable upload protocol.` },
        { name: 'title', help: 'Title for the text source (default "Text Source"). Ignored for --url and --file.' },
        { name: 'mime-type', help: 'Override the auto-detected MIME type when --file is given.' },
        { name: 'execute', type: 'boolean', help: 'Actually add the remote source to the NotebookLM notebook' },
    ],
    columns: ['notebook_id', 'source_id', 'kind', 'identifier', 'notebook_url'],
    func: async (page, kwargs) => {
        const notebookId = parseNotebooklmNotebookTarget(String(kwargs.notebook ?? ''));
        const url = parseSourceUrl(kwargs.url);
        const content = parseSourceText(kwargs.content);
        const filePath = typeof kwargs.file === 'string' && kwargs.file.trim() ? kwargs.file.trim() : '';
        const modes = [url ? 'url' : '', content !== null ? 'text' : '', filePath ? 'file' : ''].filter(Boolean);
        if (modes.length === 0) {
            throw new ArgumentError('Pass exactly one of --url <url>, --content <text>, or --file <path>');
        }
        if (modes.length > 1) {
            throw new ArgumentError('Pass exactly one of --url, --content, --file (got: ' + modes.join(' + ') + ')');
        }
        requireNotebooklmExecute(kwargs.execute, 'add a NotebookLM source');
        const title = parseSourceTitle(kwargs.title, 'Text Source');
        await ensureNotebooklmHome(page);
        await requireNotebooklmSession(page);
        if (filePath) {
            const file = readFileForUpload(filePath);
            const mime = inferMimeType(file.filename, kwargs['mime-type']);
            const registerRpc = await callNotebooklmRpc(page, NOTEBOOKLM_ADD_FILE_SOURCE_RPC_ID, buildRegisterFileSourceArgs(notebookId, file.filename));
            const sourceId = parseAddSourceResult(registerRpc.result, [notebookId]);
            if (!sourceId) {
                throw new CommandExecutionError('NotebookLM AddFileSource (o4cbdc) RPC returned no source id; cannot start file upload.');
            }
            await uploadFileViaDriveResumable(page, notebookId, sourceId, file.filename, file.base64, file.size);
            await verifyNotebooklmSourceAdded(page, notebookId, sourceId, 'add-source --file');
            return [{
                notebook_id: notebookId,
                source_id: sourceId,
                kind: 'file',
                identifier: `${file.filename} (${mime}, ${file.size} bytes)`,
                notebook_url: buildNotebooklmNotebookUrl(notebookId),
            }];
        }
        const args = url
            ? buildAddSourceFromUrlArgs(notebookId, url)
            : buildAddSourceFromTextArgs(notebookId, title, content);
        const rpc = await callNotebooklmRpc(page, NOTEBOOKLM_ADD_SOURCES_RPC_ID, args);
        const sourceId = parseAddSourceResult(rpc.result, [notebookId]);
        if (!sourceId) {
            throw new CommandExecutionError('NotebookLM AddSources RPC returned no source id; verify the input reaches the NotebookLM backend.');
        }
        await verifyNotebooklmSourceAdded(page, notebookId, sourceId, `add-source --${url ? 'url' : 'content'}`);
        return [{
            notebook_id: notebookId,
            source_id: sourceId,
            kind: url ? 'url' : 'text',
            identifier: url || title,
            notebook_url: buildNotebooklmNotebookUrl(notebookId),
        }];
    },
});

export const __test__ = {
    parseSourceUrl,
    parseSourceText,
    parseSourceTitle,
    inferMimeType,
    buildAddSourceFromUrlArgs,
    buildAddSourceFromTextArgs,
    buildRegisterFileSourceArgs,
    readFileForUpload,
    parseAddSourceResult,
};
