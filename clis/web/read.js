/**
 * Generic web page reader — fetch any URL and export as Markdown.
 *
 * Uses browser-side DOM heuristics to extract the main content:
 *   1. <article> element
 *   2. [role="main"] element
 *   3. <main> element
 *   4. Largest text-dense block as fallback
 *
 * Pipes through the shared article-download pipeline (Turndown + image download).
 *
 * Usage:
 *   opencli web read --url "https://www.anthropic.com/research/..." --output ./articles
 *   opencli web read --url "https://..." --download-images false
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { downloadArticle } from '@jackwener/opencli/download/article-download';

const NETWORK_IDLE_QUIET_MS = 1000;
const NETWORK_IDLE_POLL_MS = 500;
const MIN_NON_STRUCTURAL_IFRAME_TEXT_CHARS = 50;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function boolish(value) {
    if (value === true) return true;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    return false;
}

function normalizeFrameMode(value) {
    const mode = String(value || 'same-origin').toLowerCase();
    if (['same-origin', 'all-same-origin', 'none'].includes(mode)) return mode;
    return 'same-origin';
}

function normalizeWaitUntil(value) {
    const waitUntil = String(value || 'domstable').toLowerCase();
    if (['domstable', 'networkidle'].includes(waitUntil)) return waitUntil;
    return 'domstable';
}

function normalizeNetworkEntry(entry) {
    const preview = typeof entry?.responsePreview === 'string' ? entry.responsePreview : '';
    return {
        method: typeof entry?.method === 'string' ? entry.method : 'GET',
        url: typeof entry?.url === 'string' ? entry.url : '',
        status: typeof entry?.responseStatus === 'number' ? entry.responseStatus : 0,
        contentType: typeof entry?.responseContentType === 'string' ? entry.responseContentType : '',
        size: typeof entry?.responseBodyFullSize === 'number' ? entry.responseBodyFullSize : preview.length,
        bodyTruncated: entry?.responseBodyTruncated === true,
    };
}

function isInterestingNetworkEntry(entry) {
    const ct = (entry.contentType || '').toLowerCase();
    const url = entry.url || '';
    const method = (entry.method || 'GET').toUpperCase();
    const staticAsset = /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ico|map)(\?|$)/i.test(url);
    const noisy = /analytics|tracking|telemetry|beacon|pixel|gtag|fbevents/i.test(url);
    const apiLikeUrl = /\/(api|ajax|graphql|rest|service|handler)(\/|[?._-]|$)|\.(ashx|aspx|asmx|php)(\?|$)/i.test(url);
    const dataLikeContent = ct.includes('json')
        || ct.includes('xml')
        || ct.includes('text/plain')
        || ct.includes('javascript')
        || (apiLikeUrl && ct.includes('text/html'));
    return (
        !staticAsset
        && !noisy
        && (dataLikeContent || apiLikeUrl || method !== 'GET')
    );
}

async function drainNetworkCapture(page, sink) {
    if (!page.readNetworkCapture) return [];
    const raw = await page.readNetworkCapture().catch(() => []);
    const entries = Array.isArray(raw) ? raw.map(normalizeNetworkEntry).filter(entry => entry.url) : [];
    sink.push(...entries);
    return entries;
}

async function maybeStartNetworkCapture(page) {
    if (!page.startNetworkCapture) return false;
    try {
        return await page.startNetworkCapture('');
    } catch {
        return false;
    }
}

async function waitForNetworkIdle(page, maxSeconds, sink) {
    const timeoutMs = Math.max(1, Number(maxSeconds) || 1) * 1000;
    const deadline = Date.now() + timeoutMs;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
        const entries = await drainNetworkCapture(page, sink);
        if (entries.length > 0) quietSince = Date.now();
        if (Date.now() - quietSince >= NETWORK_IDLE_QUIET_MS) return { ok: true };
        await sleep(NETWORK_IDLE_POLL_MS);
    }
    return { ok: false, timedOut: true };
}

function buildWaitForSelectorAcrossFramesJs(selector, timeoutMs) {
    return `
      (async () => {
        const selector = ${JSON.stringify(selector)};
        const timeoutAt = Date.now() + ${Number(timeoutMs) || 10000};
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const sameOriginFrameDocs = () => Array.from(document.querySelectorAll('iframe')).map((frame) => {
          try {
            const href = new URL(frame.getAttribute('src') || frame.src || '', window.location.href).href;
            if (new URL(href).origin !== window.location.origin) return null;
            return { href, doc: frame.contentDocument };
          } catch {
            return null;
          }
        }).filter(Boolean);
        const findMatch = () => {
          try {
            if (document.querySelector(selector)) return { ok: true, scope: 'main', url: window.location.href };
          } catch (err) {
            return { ok: false, invalidSelector: true, error: String(err && err.message || err) };
          }
          for (const frame of sameOriginFrameDocs()) {
            try {
              if (frame.doc?.querySelector(selector)) return { ok: true, scope: 'iframe', url: frame.href };
            } catch {}
          }
          return { ok: false };
        };
        while (Date.now() < timeoutAt) {
          const found = findMatch();
          if (found.ok || found.invalidSelector) return found;
          await sleep(100);
        }
        return { ok: false, timedOut: true, selector };
      })()
    `;
}

function buildRenderAwareExtractorJs(options) {
    return `
      (() => {
        const frameMode = ${JSON.stringify(options.frames)};
        const minNonStructuralIframeTextChars = ${MIN_NON_STRUCTURAL_IFRAME_TEXT_CHARS};
        const result = {
          title: '',
          author: '',
          publishTime: '',
          contentHtml: '',
          imageUrls: [],
          diagnostics: {
            url: window.location.href,
            frames: [],
            emptyContainers: [],
            includedFrameCount: 0
          }
        };

        const absolutize = (value, base) => {
          if (!value || value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('#')) return value || '';
          try { return new URL(value, base).href; } catch { return value; }
        };
        const absolutizeTree = (root, base) => {
          root.querySelectorAll?.('[href]').forEach(el => el.setAttribute('href', absolutize(el.getAttribute('href'), base)));
          root.querySelectorAll?.('[src]').forEach(el => el.setAttribute('src', absolutize(el.getAttribute('src'), base)));
          root.querySelectorAll?.('[poster]').forEach(el => el.setAttribute('poster', absolutize(el.getAttribute('poster'), base)));
          root.querySelectorAll?.('[action]').forEach(el => el.setAttribute('action', absolutize(el.getAttribute('action'), base)));
        };
        const textLen = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim().length;
        const describeFrame = (frame, index) => {
          const rawSrc = frame.getAttribute('src') || frame.src || '';
          let href = '';
          try { href = new URL(rawSrc, window.location.href).href; } catch { href = rawSrc; }
          let sameOrigin = false;
          try { sameOrigin = href ? new URL(href).origin === window.location.origin : false; } catch {}
          let accessible = false;
          let title = frame.getAttribute('title') || frame.getAttribute('name') || frame.id || '';
          let length = 0;
          try {
            accessible = !!frame.contentDocument;
            title = title || frame.contentDocument?.title || '';
            length = textLen(frame.contentDocument?.body);
          } catch {}
          return { index, src: href, title, sameOrigin, accessible, textLength: length };
        };
        const collectEmptyContainers = (root, scope, baseUrl) => {
          const likely = 'table, tbody, ul[id], ol[id], div[id], section[id], [class*="grid"], [class*="data"], [class*="list"], [id*="grid"], [id*="data"], [id*="list"]';
          root.querySelectorAll?.(likely).forEach((el) => {
            if (scope === 'main' && el.closest?.('[data-opencli-iframe-source]')) return;
            const id = el.getAttribute('id') || '';
            const cls = el.getAttribute('class') || '';
            const name = [id, cls].join(' ').toLowerCase();
            if (!/(grid|data|list|table|content|result)/.test(name) && !['TABLE', 'TBODY', 'UL', 'OL'].includes(el.nodeName)) return;
            if (textLen(el) > 20) return;
            result.diagnostics.emptyContainers.push({
              scope,
              url: baseUrl,
              tag: el.tagName.toLowerCase(),
              id,
              className: cls,
            });
          });
        };
        const hasDataContainerSignal = (root) => {
          const likely = 'table, tbody, ul[id], ol[id], [id*="grid"], [id*="data"], [id*="list"], [id*="content"], [id*="result"], [class*="grid"], [class*="data"], [class*="list"], [class*="content"], [class*="result"]';
          return !!root.querySelector?.(likely);
        };
        const shouldIncludeExternalFrame = (frameBody) => {
          // Outside-content iframes are less trusted than placeholders inside
          // contentEl. Long plain text is the fallback for simple same-origin
          // frames that lack article/table/list structure.
          if (textLen(frameBody) >= minNonStructuralIframeTextChars) return true;
          if (frameBody.querySelector?.('article, main, [role="main"], table, tbody, ul li, ol li')) return true;
          return hasDataContainerSignal(frameBody);
        };
        const buildFrameSection = (frameBody, desc, fallbackLabel) => {
          absolutizeTree(frameBody, desc.src || window.location.href);
          collectEmptyContainers(frameBody, 'iframe', desc.src);
          const section = document.createElement('section');
          section.setAttribute('data-opencli-iframe-source', desc.src);
          const heading = document.createElement('h2');
          heading.textContent = '来自 iframe: ' + (desc.src || fallbackLabel);
          section.appendChild(heading);
          Array.from(frameBody.childNodes).forEach(node => section.appendChild(node));
          return section;
        };

        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) result.title = ogTitle.getAttribute('content')?.trim() || '';
        if (!result.title) result.title = document.title?.trim() || '';
        if (!result.title) result.title = document.querySelector('h1')?.textContent?.trim() || 'untitled';
        result.title = result.title.replace(/\\s*[|\\-–—]\\s*[^|\\-–—]{1,30}$/, '').trim();

        const authorMeta = document.querySelector('meta[name="author"], meta[property="article:author"], meta[name="twitter:creator"]');
        result.author = authorMeta?.getAttribute('content')?.trim() || '';

        const timeMeta = document.querySelector('meta[property="article:published_time"], meta[name="date"], meta[name="publishdate"], time[datetime]');
        if (timeMeta) {
          result.publishTime = timeMeta.getAttribute('content')
            || timeMeta.getAttribute('datetime')
            || timeMeta.textContent?.trim()
            || '';
        }

        let contentEl = null;
        const articles = document.querySelectorAll('article');
        if (articles.length === 1) {
          contentEl = articles[0];
        } else if (articles.length > 1) {
          let maxLen = 0;
          articles.forEach(a => {
            const len = textLen(a);
            if (len > maxLen) { maxLen = len; contentEl = a; }
          });
        }
        if (!contentEl) contentEl = document.querySelector('[role="main"]');
        if (!contentEl) contentEl = document.querySelector('main');
        if (!contentEl) {
          const candidates = document.querySelectorAll(
            'div[class*="content"], div[class*="article"], div[class*="post"], ' +
            'div[class*="entry"], div[class*="body"], div[id*="content"], ' +
            'div[id*="article"], div[id*="post"], section'
          );
          let maxLen = 0;
          candidates.forEach(c => {
            const len = textLen(c);
            if (len > maxLen) { maxLen = len; contentEl = c; }
          });
        }
        if (!contentEl || textLen(contentEl) < 200) contentEl = document.body;

        const clone = contentEl.cloneNode(true);
        absolutizeTree(clone, window.location.href);

        const originalFrames = Array.from(contentEl.querySelectorAll('iframe'));
        const clonedFrames = Array.from(clone.querySelectorAll('iframe'));
        const clonedFrameByOriginal = new Map();
        originalFrames.forEach((frame, index) => {
          const cloned = clonedFrames[index];
          if (cloned) clonedFrameByOriginal.set(frame, cloned);
        });
        const allFrames = Array.from(document.querySelectorAll('iframe'));
        const frameDescriptions = new Map();
        allFrames.forEach((frame, index) => frameDescriptions.set(frame, describeFrame(frame, index)));
        const getFrameDescription = (frame, fallbackIndex) => frameDescriptions.get(frame) || describeFrame(frame, fallbackIndex);
        result.diagnostics.frames = allFrames.map(frame => frameDescriptions.get(frame));

        if (frameMode === 'same-origin' || frameMode === 'all-same-origin') {
          allFrames.forEach((frame, index) => {
            const insideContent = contentEl.contains(frame);
            const cloned = insideContent ? clonedFrameByOriginal.get(frame) : null;
            if (insideContent && !cloned) return;
            const desc = getFrameDescription(frame, index);
            if (!desc.sameOrigin || !desc.accessible) return;
            try {
              const doc = frame.contentDocument;
              if (!doc?.body) return;
              const frameBody = doc.body.cloneNode(true);
              if (frameMode !== 'all-same-origin' && !insideContent && !shouldIncludeExternalFrame(frameBody)) return;
              const section = buildFrameSection(frameBody, desc, frame.getAttribute('src') || ('#' + index));
              if (insideContent) cloned.replaceWith(section);
              else clone.appendChild(section);
              result.diagnostics.includedFrameCount += 1;
            } catch {}
          });
        }

        collectEmptyContainers(clone, 'main', window.location.href);

        const noise = 'nav, header, footer, aside, .sidebar, .nav, .menu, .footer, ' +
          '.header, .comments, .comment, .ad, .ads, .advertisement, .social-share, ' +
          '.related-posts, .newsletter, .cookie-banner, script, style, noscript, iframe';
        clone.querySelectorAll(noise).forEach(el => el.remove());

        const stripWS = (s) => (s || '').replace(/\\s+/g, '');
        const dedup = (parent) => {
          const children = Array.from(parent.children || []);
          for (let i = children.length - 1; i >= 1; i--) {
            const curRaw = children[i].textContent || '';
            const prevRaw = children[i - 1].textContent || '';
            const cur = stripWS(curRaw);
            const prev = stripWS(prevRaw);
            if (cur.length < 20 || prev.length < 20) continue;
            if (cur === prev) {
              const curSpaces = (curRaw.match(/ /g) || []).length;
              const prevSpaces = (prevRaw.match(/ /g) || []).length;
              if (curSpaces >= prevSpaces) children[i - 1].remove();
              else children[i].remove();
            } else if (prev.includes(cur) && cur.length / prev.length > 0.8) {
              children[i].remove();
            } else if (cur.includes(prev) && prev.length / cur.length > 0.8) {
              children[i - 1].remove();
            }
          }
        };
        dedup(clone);
        clone.querySelectorAll('section, div').forEach(el => {
          if (el.children && el.children.length > 2) dedup(el);
        });

        clone.querySelectorAll('img').forEach(img => {
          const srcset = img.getAttribute('data-srcset') || '';
          const srcsetFirst = srcset.split(',')[0]?.trim().split(' ')[0] || '';
          const real = img.getAttribute('data-src')
            || img.getAttribute('data-original')
            || img.getAttribute('data-lazy-src')
            || srcsetFirst;
          if (real) img.setAttribute('src', absolutize(real, window.location.href));
        });

        result.contentHtml = clone.innerHTML;

        const seen = new Set();
        clone.querySelectorAll('img').forEach(img => {
          const src = img.getAttribute('src') || '';
          if (src && !src.startsWith('data:') && !seen.has(src)) {
            seen.add(src);
            result.imageUrls.push(src);
          }
        });

        return result;
      })()
    `;
}

function formatDiagnostics(data, networkEntries, captureSupported) {
    const lines = [];
    const diag = data?.diagnostics || {};
    lines.push('[web-read diagnose]');
    lines.push(`url: ${diag.url || '-'}`);
    lines.push(`frames: ${Array.isArray(diag.frames) ? diag.frames.length : 0}, included_same_origin: ${diag.includedFrameCount || 0}`);
    for (const frame of (diag.frames || []).slice(0, 20)) {
        lines.push(`  [frame ${frame.index}] ${frame.sameOrigin ? 'same-origin' : 'cross-origin'} ${frame.accessible ? 'accessible' : 'blocked'} text=${frame.textLength || 0} ${frame.src || '-'}`);
    }
    if (Array.isArray(diag.emptyContainers) && diag.emptyContainers.length > 0) {
        lines.push(`empty_containers: ${diag.emptyContainers.length}`);
        for (const item of diag.emptyContainers.slice(0, 12)) {
            const selector = `${item.tag}${item.id ? `#${item.id}` : ''}${item.className ? `.${String(item.className).trim().split(/\\s+/).filter(Boolean).join('.')}` : ''}`;
            lines.push(`  ${item.scope}: ${selector} (${item.url || '-'})`);
        }
    }
    const interesting = networkEntries.filter(isInterestingNetworkEntry);
    lines.push(`network_capture: ${captureSupported ? 'enabled' : 'unavailable'}, entries=${networkEntries.length}, api_like=${interesting.length}`);
    for (const entry of interesting.slice(0, 20)) {
        lines.push(`  ${entry.method} ${entry.status || '-'} ${entry.contentType || '-'} ${entry.url}`);
    }
    return `${lines.join('\n')}\n`;
}

const command = cli({
    site: 'web',
    name: 'read',
    access: 'read',
    description: 'Fetch any web page and export as Markdown',
    strategy: Strategy.COOKIE,
    navigateBefore: false, // we handle navigation ourselves
    args: [
        { name: 'url', required: true, help: 'Any web page URL' },
        { name: 'output', default: './web-articles', help: 'Output directory' },
        { name: 'download-images', type: 'boolean', default: true, help: 'Download images locally' },
        { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
        { name: 'wait-for', valueRequired: true, help: 'CSS selector to wait for in the main document or same-origin iframes' },
        { name: 'wait-until', default: 'domstable', choices: ['domstable', 'networkidle'], help: 'Readiness policy after navigation: domstable or networkidle' },
        { name: 'frames', default: 'same-origin', choices: ['same-origin', 'all-same-origin', 'none'], help: 'Iframe handling mode: relevant same-origin, all-same-origin, or none' },
        { name: 'diagnose', type: 'boolean', default: false, help: 'Print render diagnostics (frames, empty containers, XHR/API-like requests) to stderr' },
        { name: 'stdout', type: 'boolean', default: false, help: 'Print markdown to stdout instead of saving to a file' },
    ],
    columns: ['title', 'author', 'publish_time', 'status', 'size', 'saved'],
    func: async (page, kwargs, debug = false) => {
        const url = kwargs.url;
        const waitSeconds = kwargs.wait ?? 3;
        const waitUntil = normalizeWaitUntil(kwargs['wait-until']);
        const frameMode = normalizeFrameMode(kwargs.frames);
        const shouldDiagnose = boolish(kwargs.diagnose) || debug || !!process.env.OPENCLI_VERBOSE;
        const networkEntries = [];
        const captureSupported = (waitUntil === 'networkidle' || shouldDiagnose)
            ? await maybeStartNetworkCapture(page)
            : false;
        // Navigate to the target URL
        await page.goto(url);
        if (kwargs['wait-for']) {
            const waitResult = await page.evaluate(buildWaitForSelectorAcrossFramesJs(String(kwargs['wait-for']), waitSeconds * 1000));
            if (waitResult?.invalidSelector) {
                throw new Error(`Invalid --wait-for selector "${kwargs['wait-for']}": ${waitResult.error || 'querySelector failed'}`);
            }
            if (!waitResult?.ok) {
                throw new Error(`Timed out waiting for selector "${kwargs['wait-for']}" in main document or same-origin iframes`);
            }
        } else if (waitUntil !== 'networkidle') {
            await page.wait(waitSeconds);
        }
        if (waitUntil === 'networkidle') {
            if (!captureSupported) {
                throw new Error('Network capture is unavailable, so --wait-until networkidle cannot be satisfied');
            }
            const idle = await waitForNetworkIdle(page, waitSeconds, networkEntries);
            if (!idle?.ok) {
                throw new Error(`Timed out waiting for network idle after ${waitSeconds}s`);
            }
        }
        // Extract article content using browser-side heuristics
        const data = await page.evaluate(buildRenderAwareExtractorJs({ frames: frameMode }));
        if (captureSupported) await drainNetworkCapture(page, networkEntries);
        if (shouldDiagnose) process.stderr.write(formatDiagnostics(data, networkEntries, captureSupported));
        // Determine Referer from URL for image downloads
        let referer = '';
        try {
            const parsed = new URL(url);
            referer = parsed.origin + '/';
        }
        catch { /* ignore */ }
        const result = await downloadArticle({
            title: data?.title || 'untitled',
            author: data?.author,
            publishTime: data?.publishTime,
            sourceUrl: url,
            contentHtml: data?.contentHtml || '',
            imageUrls: data?.imageUrls,
        }, {
            output: kwargs.output,
            downloadImages: kwargs['download-images'],
            imageHeaders: referer ? { Referer: referer } : undefined,
            stdout: kwargs.stdout,
            configureTurndown: (td) => {
                td.addRule('preserveButtons', {
                    filter: (node) => node.nodeName === 'BUTTON',
                    replacement: (content) => content,
                });
            },
        });
        // `--stdout` is a content-streaming mode. The markdown body already went
        // to process.stdout inside downloadArticle(), so returning rows here
        // would make Commander append table/JSON output to the same stdout
        // stream and break piping.
        return kwargs.stdout ? null : result;
    },
});
export const __test__ = {
    command,
    buildRenderAwareExtractorJs,
    buildWaitForSelectorAcrossFramesJs,
    formatDiagnostics,
    isInterestingNetworkEntry,
    normalizeFrameMode,
    normalizeWaitUntil,
};
