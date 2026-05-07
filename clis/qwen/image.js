import * as os from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import { ArgumentError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import {
    QIANWEN_DOMAIN,
    authRequired,
    dismissLoginModal,
    ensureOnQianwen,
    getMessageBubbles,
    hasLoginGate,
    normalizeBooleanFlag,
    sendMessage,
    setFeatureToggle,
    startNewChat,
} from './utils.js';

function displayPath(filePath) {
    const home = os.homedir();
    return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

function extFromMime(mime) {
    if (!mime) return '.jpg';
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';
    if (mime.includes('gif')) return '.gif';
    return '.jpg';
}

async function collectImageUrls(page, sinceAssistantId) {
    return await page.evaluate(`(() => {
    const scope = ${JSON.stringify(sinceAssistantId || '')};
    const bubbles = Array.from(document.querySelectorAll('[data-msgid$="-answer"]'));
    const target = scope
      ? bubbles.find((b) => b.getAttribute('data-msgid') === scope)
      : bubbles[bubbles.length - 1];
    if (!target) return [];
    const imgs = Array.from(target.querySelectorAll('img'))
      .map((node) => node.getAttribute('src') || '')
      .filter((src) => src
        && !src.startsWith('data:')
        && !/\\.(svg)$/i.test(src)
        && !src.includes('alicdn.com/imgextra'));
    return Array.from(new Set(imgs));
  })()`);
}

async function waitForImageUrls(page, sinceAssistantId, timeoutSeconds) {
    const startTime = Date.now();
    let lastUrls = [];
    while (Date.now() - startTime < timeoutSeconds * 1000) {
        await page.wait(2);
        if (await hasLoginGate(page)) return { status: 'auth_required', urls: [] };
        const urls = await collectImageUrls(page, sinceAssistantId);
        if (urls.length && urls.length === lastUrls.length && urls.every((u, i) => u === lastUrls[i])) {
            return { status: 'ok', urls };
        }
        if (urls.length) {
            await page.wait(2);
            const urls2 = await collectImageUrls(page, sinceAssistantId);
            if (urls2.length === urls.length && urls2.every((u, i) => u === urls[i])) {
                return { status: 'ok', urls: urls2 };
            }
            lastUrls = urls2;
            continue;
        }
        lastUrls = urls;
    }
    return lastUrls.length ? { status: 'partial', urls: lastUrls } : { status: 'timeout', urls: [] };
}

async function fetchImageAsset(page, url) {
    return await page.evaluate(`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      if (!res.ok) return { ok: false, status: res.status };
      const mime = res.headers.get('content-type') || '';
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return { ok: true, mime, base64: btoa(binary) };
    } catch (error) {
      return { ok: false, status: 0, error: String(error?.message || error) };
    }
  })()`);
}

cli({
    site: 'qwen',
    name: 'image',
    access: 'write',
    description: 'Generate images with Qianwen (AI生图) and save them locally',
    domain: QIANWEN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', required: true, positional: true, help: 'Image prompt to send' },
        { name: 'op', default: '~/Pictures/qianwen', help: 'Output directory' },
        { name: 'new', type: 'boolean', default: true, help: 'Start a new chat before generating (default: true)' },
        { name: 'sd', type: 'boolean', default: false, help: 'Skip download; only show the Qianwen link' },
        { name: 'timeout', type: 'int', default: 180, help: 'Max seconds to wait for the image response' },
    ],
    columns: ['Status', 'File', 'Link'],
    func: async (page, kwargs) => {
        const prompt = String(kwargs.prompt || '').trim();
        if (!prompt) throw new ArgumentError('prompt is required');
        const outputDir = String(kwargs.op || '~/Pictures/qianwen').replace(/^~\//, `${os.homedir()}/`);
        const startFresh = normalizeBooleanFlag(kwargs.new, true);
        const skipDownload = normalizeBooleanFlag(kwargs.sd, false);
        const timeout = Number(kwargs.timeout ?? 180);
        if (!Number.isInteger(timeout) || timeout <= 0) {
            throw new ArgumentError('timeout must be a positive integer');
        }

        await ensureOnQianwen(page);
        await dismissLoginModal(page);
        if (startFresh) {
            await startNewChat(page);
            await dismissLoginModal(page);
        }
        await setFeatureToggle(page, 'image', true);
        await page.wait(0.5);

        const send = await sendMessage(page, prompt);
        if (!send?.ok) {
            if (await hasLoginGate(page)) throw authRequired();
            throw new CommandExecutionError(send?.reason || 'Failed to send Qianwen image prompt');
        }

        // Grab the newest assistant bubble id after send by polling briefly
        let targetId = '';
        for (let i = 0; i < 5; i += 1) {
            await page.wait(1);
            const bubbles = await getMessageBubbles(page);
            const lastAnswer = [...bubbles].reverse().find((b) => b.role === 'Assistant');
            if (lastAnswer) { targetId = lastAnswer.id; break; }
        }

        const waitResult = await waitForImageUrls(page, targetId, timeout);
        const link = await page.evaluate('window.location.href').catch(() => 'https://www.qianwen.com/');
        if (waitResult.status === 'auth_required') throw authRequired();
        if (waitResult.status === 'timeout') {
            throw new TimeoutError('qianwen image', timeout, 'No generated images observed before timeout.');
        }

        const urls = waitResult.urls;
        if (skipDownload) {
            return [{ Status: '🎨 generated', File: null, Link: link }];
        }

        const stamp = Date.now();
        const results = [];
        for (let i = 0; i < urls.length; i += 1) {
            const url = urls[i];
            const asset = await fetchImageAsset(page, url);
            if (!asset?.ok) {
                throw new CommandExecutionError(`Failed to fetch generated Qianwen image ${i + 1}: status=${asset?.status || '?'}`);
            }
            const suffix = urls.length > 1 ? `_${i + 1}` : '';
            const ext = extFromMime(asset.mime);
            const filePath = path.join(outputDir, `qianwen_${stamp}${suffix}${ext}`);
            await saveBase64ToFile(asset.base64, filePath);
            results.push({ Status: '✅ saved', File: displayPath(filePath), Link: link });
        }
        if (!results.length) {
            throw new EmptyResultError('qwen image', 'No generated images were available to download.');
        }
        return results;
    },
});
