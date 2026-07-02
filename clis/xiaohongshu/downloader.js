/**
 * Xiaohongshu downloader — call the local XHS-Downloader service.
 *
 * This command intentionally does not use the browser/session based
 * xiaohongshu adapters. It manages a local Docker-backed XHS-Downloader API
 * service, waits until it is ready, then calls POST /xhs/detail.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, ConfigError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';

const DEFAULT_API_BASE = 'http://localhost:5556';
const DEFAULT_CONTAINER_NAME = 'xhs-downloader';
const DEFAULT_IMAGE = 'ghcr.io/joeanamier/xhs-downloader';
const DEFAULT_DOWNLOAD_DIR = '~/XHS-Downloads';
const SERVICE_PORT = '5556';

function cleanText(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text || null;
}

function expandHome(input) {
    const raw = String(input ?? '').trim() || DEFAULT_DOWNLOAD_DIR;
    if (raw === '~') return homedir();
    if (raw.startsWith('~/')) return path.join(homedir(), raw.slice(2));
    return raw;
}

function normalizePositiveInteger(value, defaultValue, label, { max } = {}) {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`xiaohongshu downloader ${label} must be a positive integer`);
    }
    if (max != null && n > max) {
        throw new ArgumentError(`xiaohongshu downloader ${label} must be <= ${max}`);
    }
    return n;
}

function normalizeApiBase(value) {
    const raw = String(value ?? DEFAULT_API_BASE).trim() || DEFAULT_API_BASE;
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new ArgumentError('xiaohongshu downloader --api-base must be a valid http(s) URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ArgumentError('xiaohongshu downloader --api-base must use http or https');
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
}

function isLoopbackHost(apiBase) {
    const host = new URL(apiBase).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function hostPort(apiBase) {
    const url = new URL(apiBase);
    if (url.port) return url.port;
    return url.protocol === 'https:' ? '443' : '80';
}

function validateXhsUrl(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
        throw new ArgumentError('xiaohongshu downloader url is required');
    }
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new ArgumentError('xiaohongshu downloader url must be a full Xiaohongshu or xhslink URL');
    }
    const host = url.hostname.toLowerCase();
    const isXhs = host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com');
    const isShort = host === 'xhslink.com' || host.endsWith('.xhslink.com');
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || (!isXhs && !isShort)) {
        throw new ArgumentError('xiaohongshu downloader only supports xiaohongshu.com and xhslink.com URLs');
    }
    return raw;
}

function parseIndexList(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return undefined;
    const indexes = raw.split(/[,\s]+/).filter(Boolean).map((part) => {
        const n = Number(part);
        if (!Number.isInteger(n) || n <= 0) {
            throw new ArgumentError('xiaohongshu downloader --index must contain positive integers, e.g. "1,3,5"');
        }
        return n;
    });
    return indexes.length ? indexes : undefined;
}

function parseCount(value) {
    const raw = String(value ?? '').replace(/[,，\s]/g, '').trim();
    if (!raw || raw === 'NaN') return null;
    const match = raw.match(/^(\d+(?:\.\d+)?)(万|w|W|千|k|K|亿)?\+?$/u);
    if (!match) return null;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return null;
    const unit = match[2];
    if (unit === '亿') return Math.round(base * 100000000);
    if (unit === '万' || unit === 'w' || unit === 'W') return Math.round(base * 10000);
    if (unit === '千' || unit === 'k' || unit === 'K') return Math.round(base * 1000);
    return Math.round(base);
}

function normalizeUrls(value) {
    const raw = Array.isArray(value) ? value : (value == null ? [] : [value]);
    const seen = new Set();
    const urls = [];
    for (const item of raw) {
        const text = String(item ?? '').trim();
        if (!text || text === 'NaN' || seen.has(text)) continue;
        seen.add(text);
        urls.push(text);
    }
    return urls;
}

function runDocker(args, label, timeoutMs, { allowFailure = false } = {}) {
    const result = spawnSync('docker', args, {
        encoding: 'utf8',
        timeout: timeoutMs,
    });
    if (result.error?.code === 'ENOENT') {
        throw new ConfigError('docker command not found', 'Install Docker Desktop or Docker CLI before using xiaohongshu downloader.');
    }
    if (result.error) {
        throw new CommandExecutionError(`${label} failed: ${result.error.message}`);
    }
    if (result.status !== 0 && !allowFailure) {
        const detail = String(result.stderr || result.stdout || '').trim();
        throw new CommandExecutionError(`${label} failed${detail ? `: ${detail}` : ''}`, 'Check that Docker Desktop is running and the xhs-downloader image can be pulled.');
    }
    return result;
}

function inspectContainer(containerName, timeoutMs) {
    const result = runDocker(['inspect', '-f', '{{.State.Running}}', containerName], 'docker inspect xhs-downloader', timeoutMs, { allowFailure: true });
    if (result.status === 0) {
        return { exists: true, running: String(result.stdout ?? '').trim() === 'true' };
    }
    const detail = String(result.stderr || result.stdout || '').trim();
    if (/No such object|No such container/i.test(detail)) {
        return { exists: false, running: false };
    }
    throw new CommandExecutionError(`docker inspect xhs-downloader failed${detail ? `: ${detail}` : ''}`, 'Check that Docker Desktop is running.');
}

function ensureDockerAvailable(timeoutMs) {
    runDocker(['--version'], 'docker --version', timeoutMs);
}

function ensureDownloaderContainer({ apiBase, containerName, image, downloadDir, timeoutMs }) {
    if (!isLoopbackHost(apiBase)) {
        throw new ArgumentError('xiaohongshu downloader can only auto-start local api-base hosts', 'Use --no-start true when pointing --api-base at an already-running remote service.');
    }
    ensureDockerAvailable(timeoutMs);
    mkdirSync(downloadDir, { recursive: true });
    const inspected = inspectContainer(containerName, timeoutMs);
    if (inspected.running) return 'running';
    if (inspected.exists) {
        runDocker(['start', containerName], 'docker start xhs-downloader', timeoutMs);
        return 'started';
    }
    const port = hostPort(apiBase);
    runDocker([
        'run',
        '-d',
        '--name',
        containerName,
        '-p',
        `${port}:${SERVICE_PORT}`,
        '-v',
        `${downloadDir}:/app/Volume`,
        image,
        'python',
        'main.py',
        'api',
    ], 'docker run xhs-downloader', timeoutMs);
    return 'created';
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForService(apiBase, timeoutSeconds, containerName = DEFAULT_CONTAINER_NAME) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    const healthUrl = `${apiBase}/docs`;
    let lastError = 'service did not respond';
    while (Date.now() <= deadline) {
        try {
            const resp = await fetch(healthUrl, {
                headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
                signal: AbortSignal.timeout(Math.min(3000, timeoutSeconds * 1000)),
            });
            if (resp.ok) return;
            lastError = `HTTP ${resp.status}`;
        }
        catch (err) {
            lastError = err?.message ?? String(err);
        }
        if (Date.now() >= deadline) break;
        await sleep(500);
    }
    throw new TimeoutError('xhs-downloader service', timeoutSeconds, `Last readiness check failed: ${lastError}. Check "docker logs ${containerName} --tail 50".`);
}

async function postDetail(apiBase, payload, timeoutSeconds) {
    let resp;
    try {
        resp = await fetch(`${apiBase}/xhs/detail`, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutSeconds * 1000),
        });
    }
    catch (err) {
        throw new CommandExecutionError(`xhs-downloader detail request failed: ${err?.message ?? err}`, 'Check that the local API service is reachable.');
    }
    let text = '';
    try {
        text = await resp.text();
    }
    catch {
        // Leave text empty; the HTTP status is still useful.
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`xhs-downloader detail request returned HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    try {
        return text ? JSON.parse(text) : null;
    }
    catch (err) {
        throw new CommandExecutionError(`xhs-downloader detail returned malformed JSON: ${err?.message ?? err}`);
    }
}

function readCookie(args) {
    const direct = cleanText(args.cookie);
    if (direct) return direct;
    const cookieFile = cleanText(args['cookie-file']);
    if (cookieFile) {
        try {
            return readFileSync(expandHome(cookieFile), 'utf8').trim();
        }
        catch (err) {
            throw new CommandExecutionError(`failed to read --cookie-file: ${err?.message ?? err}`);
        }
    }
    return cleanText(process.env.XHS_DOWNLOADER_COOKIE);
}

function normalizeDetailResponse(body, inputUrl, download, downloadDir) {
    const data = body?.data;
    if (!data || typeof data !== 'object') {
        throw new EmptyResultError('xiaohongshu downloader', cleanText(body?.message) || 'XHS-Downloader returned no work data.');
    }
    const primaryUrls = normalizeUrls(data['下载地址']);
    const animatedUrls = normalizeUrls(data['动图地址']);
    const mediaUrls = normalizeUrls([...primaryUrls, ...animatedUrls]);
    if (!cleanText(data['作品ID']) && !cleanText(data['作品标题']) && mediaUrls.length === 0) {
        throw new EmptyResultError('xiaohongshu downloader', 'XHS-Downloader returned an empty work payload.');
    }
    return [{
        noteId: cleanText(data['作品ID']),
        title: cleanText(data['作品标题']),
        description: cleanText(data['作品描述']),
        author: cleanText(data['作者昵称']),
        authorId: cleanText(data['作者ID']),
        type: cleanText(data['作品类型']),
        publishTime: cleanText(data['发布时间']),
        likes: parseCount(data['点赞数量']),
        collects: parseCount(data['收藏数量']),
        comments: parseCount(data['评论数量']),
        mediaCount: mediaUrls.length,
        downloaded: Boolean(download),
        downloadDir: download ? downloadDir : null,
        mediaUrls,
        url: cleanText(data['作品链接']) || inputUrl,
    }];
}

export const command = cli({
    site: 'xiaohongshu',
    name: 'downloader',
    access: 'read',
    description: '通过本地 XHS-Downloader 服务获取小红书作品内容',
    domain: 'localhost:5556',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'url', positional: true, required: true, help: 'Xiaohongshu note URL or xhslink short link' },
        { name: 'download', type: 'bool', default: false, help: 'Ask XHS-Downloader to download media files' },
        { name: 'index', default: '', help: 'Comma-separated image indexes to download, e.g. "1,3,5"' },
        { name: 'cookie', default: '', help: 'Optional Xiaohongshu cookie; prefer XHS_DOWNLOADER_COOKIE or --cookie-file' },
        { name: 'cookie-file', default: '', help: 'Read Xiaohongshu cookie from a local file' },
        { name: 'proxy', default: '', help: 'Optional proxy, e.g. "http://127.0.0.1:10808"' },
        { name: 'skip', type: 'bool', default: false, help: 'Skip files that XHS-Downloader already downloaded' },
        { name: 'api-base', default: DEFAULT_API_BASE, help: 'XHS-Downloader API base URL' },
        { name: 'container-name', default: DEFAULT_CONTAINER_NAME, help: 'Docker container name to inspect/start/create' },
        { name: 'image', default: DEFAULT_IMAGE, help: 'Docker image used when creating the service container' },
        { name: 'download-dir', default: DEFAULT_DOWNLOAD_DIR, help: 'Host directory mounted to /app/Volume' },
        { name: 'no-start', type: 'bool', default: false, help: 'Do not manage Docker; only call an existing service' },
        { name: 'timeout', type: 'int', default: 120, help: 'Service startup and request timeout seconds (max 600)' },
    ],
    columns: ['noteId', 'title', 'description', 'author', 'authorId', 'type', 'publishTime', 'likes', 'collects', 'comments', 'mediaCount', 'downloaded', 'downloadDir', 'mediaUrls', 'url'],
    func: async (args) => {
        const inputUrl = validateXhsUrl(args.url);
        const apiBase = normalizeApiBase(args['api-base']);
        const timeoutSeconds = normalizePositiveInteger(args.timeout, 120, 'timeout', { max: 600 });
        const timeoutMs = timeoutSeconds * 1000;
        const downloadDir = expandHome(args['download-dir']);
        const containerName = cleanText(args['container-name']) || DEFAULT_CONTAINER_NAME;
        const download = Boolean(args.download);
        const indexes = parseIndexList(args.index);
        const cookie = readCookie(args);
        if (!args['no-start']) {
            ensureDownloaderContainer({
                apiBase,
                containerName,
                image: cleanText(args.image) || DEFAULT_IMAGE,
                downloadDir,
                timeoutMs,
            });
        }
        await waitForService(apiBase, timeoutSeconds, containerName);
        const payload = {
            url: inputUrl,
            download,
            ...(indexes ? { index: indexes } : {}),
            ...(cookie ? { cookie } : {}),
            ...(cleanText(args.proxy) ? { proxy: cleanText(args.proxy) } : {}),
            ...(args.skip ? { skip: true } : {}),
        };
        const body = await postDetail(apiBase, payload, timeoutSeconds);
        return normalizeDetailResponse(body, inputUrl, download, downloadDir);
    },
});

export const __test__ = {
    cleanText,
    expandHome,
    parseCount,
    parseIndexList,
    validateXhsUrl,
    normalizeDetailResponse,
};
