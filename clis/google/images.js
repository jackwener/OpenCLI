/**
 * Google Images search via browser DOM extraction.
 *
 * Google Images has no stable public JSON API. This adapter navigates the
 * public image search UI and extracts visible image candidates, preferring
 * image URLs exposed in /imgres links and falling back to rendered thumbnails.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    requireBoundedInteger,
    requireRows,
    requireSearchQuery,
    runBrowserStep,
    toHttpsUrl,
} from '../_shared/search-adapter.js';

function isNavigationRejected(error) {
    return /Navigation rejected/i.test(String(error?.message || error));
}

async function navigateGoogleImages(page, url) {
    try {
        await page.goto(url);
        return;
    } catch (error) {
        if (!isNavigationRejected(error)) {
            throw error;
        }
    }

    if (typeof page.closeWindow === 'function') {
        await page.closeWindow().catch(() => {});
    }

    try {
        await page.goto(url);
        return;
    } catch (error) {
        if (!isNavigationRejected(error)) {
            throw error;
        }
        if (typeof page.newTab === 'function' && typeof page.setActivePage === 'function') {
            const pageId = await page.newTab(url);
            if (pageId) {
                await page.setActivePage(pageId);
                return;
            }
        }
        throw error;
    }
}

export async function extractGoogleImageRows(maxRows = 20, resolveOriginal = true, docArg) {
    var doc = docArg || document;
    var baseHref = doc.URL || (typeof location !== 'undefined' ? location.href : 'https://www.google.com/search?tbm=isch');
    var candidates = [];
    var seen = {};

    function text(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function firstSrcsetUrl(srcset) {
        var raw = String(srcset || '').trim();
        if (!raw)
            return '';
        var first = raw.split(',')[0] || '';
        return (first.trim().split(/\s+/)[0] || '').trim();
    }

    function cleanHttpUrl(value) {
        var raw = text(value);
        if (!raw)
            return '';
        try {
            var url = new URL(raw, baseHref);
            if (url.protocol !== 'http:' && url.protocol !== 'https:')
                return '';
            return url.href;
        }
        catch {
            return '';
        }
    }

    function sourceName(sourceUrl) {
        try {
            return new URL(sourceUrl).hostname.replace(/^www\./, '');
        }
        catch {
            return '';
        }
    }

    function pause(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    function readDimension(img, attr, naturalProp) {
        var rect = typeof img.getBoundingClientRect === 'function' ? img.getBoundingClientRect() : null;
        var rectValue = attr === 'width' ? rect && rect.width : rect && rect.height;
        var raw = img.getAttribute(attr) || img.style[attr] || img[naturalProp] || rectValue;
        var n = Number.parseInt(String(raw || '').replace(/[^\d]/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    function isGoogleInternalUrl(value) {
        try {
            var host = new URL(value).hostname.replace(/^www\./, '');
            return host === 'google.com' || host.endsWith('.google.com') || host === 'gstatic.com' || host.endsWith('.gstatic.com');
        }
        catch {
            return true;
        }
    }

    function firstExternalLink(scope) {
        if (!scope)
            return '';
        var links = scope.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i += 1) {
            var candidate = cleanHttpUrl(links[i].getAttribute('href'));
            if (candidate && !isGoogleInternalUrl(candidate))
                return candidate;
        }
        return '';
    }

    function resultScope(img) {
        var node = img;
        for (var depth = 0; node && depth < 9; depth += 1) {
            if (node.querySelector && firstExternalLink(node))
                return node;
            node = node.parentElement;
        }
        return img.closest('[data-ri], [data-ved], div');
    }

    function imageSrc(img) {
        return cleanHttpUrl(img.currentSrc)
            || cleanHttpUrl(img.getAttribute('src'))
            || cleanHttpUrl(img.getAttribute('data-src'))
            || cleanHttpUrl(img.getAttribute('data-iurl'))
            || cleanHttpUrl(firstSrcsetUrl(img.getAttribute('srcset')));
    }

    function add(anchor, img, scope) {
        if (!img || candidates.length >= maxRows)
            return;

        var href = anchor ? anchor.getAttribute('href') || anchor.href || '' : '';
        var imageUrl = '';
        var sourceUrl = '';
        if (href) {
            try {
                var parsed = new URL(href, baseHref);
                imageUrl = cleanHttpUrl(parsed.searchParams.get('imgurl'));
                sourceUrl = cleanHttpUrl(parsed.searchParams.get('imgrefurl'))
                    || cleanHttpUrl(parsed.searchParams.get('url'));
            }
            catch {
                // Ignore malformed Google redirect links and fall through to DOM attributes.
            }
        }

        var thumbnailUrl = imageSrc(img);
        imageUrl = imageUrl
            || cleanHttpUrl(scope && scope.getAttribute('data-iurl'))
            || cleanHttpUrl(img.getAttribute('data-iurl'))
            || thumbnailUrl;

        if (!imageUrl)
            return;

        sourceUrl = sourceUrl
            || cleanHttpUrl(scope && scope.getAttribute('data-lpage'))
            || firstExternalLink(scope)
            || (href && href.indexOf('/imgres') === -1 ? cleanHttpUrl(href) : '');

        var width = readDimension(img, 'width', 'naturalWidth');
        var height = readDimension(img, 'height', 'naturalHeight');
        if (width !== null && height !== null && (width < 80 || height < 80))
            return;
        if (sourceUrl && isGoogleInternalUrl(sourceUrl) && href.indexOf('/imgres') === -1)
            return;

        var dedupeKey = imageUrl || (sourceUrl + '|' + text(img.getAttribute('alt')));
        if (!dedupeKey || seen[dedupeKey])
            return;
        seen[dedupeKey] = true;

        var title = text(img.getAttribute('alt'))
            || text(anchor && anchor.getAttribute('aria-label'))
            || text(scope && scope.getAttribute('aria-label'))
            || text(scope && scope.getAttribute('title'))
            || sourceName(sourceUrl);

        candidates.push({
            target: img.closest('[role="button"]') || anchor || img,
            row: [
                title,
                imageUrl,
                thumbnailUrl,
                sourceUrl,
                sourceName(sourceUrl),
                width,
                height,
            ],
        });
    }

    var anchors = doc.querySelectorAll('#rso a[href*="imgres"], #rso a[href*="source=images"], #rso a[href*="tbm=isch"], #rso a[href*="udm=2"], #islrg a[href*="imgres"], #islrg a[href*="source=images"], #islrg a[href*="tbm=isch"], #islrg a[href*="udm=2"]');
    for (var i = 0; i < anchors.length && candidates.length < maxRows; i += 1) {
        var anchor = anchors[i];
        var scopedImg = anchor.querySelector('img');
        if (!scopedImg) {
            var nearby = anchor.closest('[data-ri], [data-ved], #rso > div, div');
            scopedImg = nearby ? nearby.querySelector('img') : null;
        }
        add(anchor, scopedImg, scopedImg ? resultScope(scopedImg) : anchor.closest('[data-ri], [data-ved], div'));
    }

    var fallbackImages = doc.querySelectorAll('#rso img, #islrg img, #center_col img, #rcnt img');
    for (var j = 0; j < fallbackImages.length && candidates.length < maxRows; j += 1) {
        var img = fallbackImages[j];
        var scope = resultScope(img);
        var link = img.closest('a[href]');
        add(link, img, scope);
    }

    function parseImgresLink(href, row) {
        try {
            var parsed = new URL(href, baseHref);
            var originalUrl = cleanHttpUrl(parsed.searchParams.get('imgurl'));
            if (!originalUrl || isGoogleInternalUrl(originalUrl))
                return null;
            var refUrl = cleanHttpUrl(parsed.searchParams.get('imgrefurl')) || cleanHttpUrl(parsed.searchParams.get('url'));
            var score = 1;
            if (refUrl && row[3] && refUrl === row[3])
                score += 10;
            if (refUrl && row[3] && sourceName(refUrl) === sourceName(row[3]))
                score += 5;
            var width = Number.parseInt(parsed.searchParams.get('w') || '', 10);
            var height = Number.parseInt(parsed.searchParams.get('h') || '', 10);
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
                score += 2;
            return [
                originalUrl,
                refUrl,
                sourceName(refUrl),
                Number.isFinite(width) && width > 0 ? width : null,
                Number.isFinite(height) && height > 0 ? height : null,
                score,
            ];
        }
        catch {
            return null;
        }
    }

    function bestOriginal(row) {
        var best = null;
        var links = doc.querySelectorAll('a[href*="imgurl="]');
        for (var i = 0; i < links.length; i += 1) {
            var candidate = parseImgresLink(links[i].getAttribute('href') || links[i].href || '', row);
            if (!candidate)
                continue;
            if (!best || candidate[5] > best[5])
                best = candidate;
        }
        return best;
    }

    async function resolveOriginalFor(candidate) {
        if (!candidate || !candidate.target)
            return;
        var target = candidate.target;
        try {
            if (typeof target.scrollIntoView === 'function')
                target.scrollIntoView({ block: 'center', inline: 'center' });
            var view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
            var MouseEventCtor = view && view.MouseEvent;
            if (MouseEventCtor) {
                target.dispatchEvent(new MouseEventCtor('mouseover', { bubbles: true, view: view }));
                target.dispatchEvent(new MouseEventCtor('mousedown', { bubbles: true, view: view }));
                target.dispatchEvent(new MouseEventCtor('mouseup', { bubbles: true, view: view }));
            }
            target.click();
        }
        catch {
            return;
        }

        var original = null;
        for (var attempt = 0; attempt < 8; attempt += 1) {
            await pause(250);
            original = bestOriginal(candidate.row);
            if (original)
                break;
        }
        if (!original)
            return;

        candidate.row[1] = original[0];
        if (original[1])
            candidate.row[3] = original[1];
        if (original[2])
            candidate.row[4] = original[2];
        if (original[3])
            candidate.row[5] = original[3];
        if (original[4])
            candidate.row[6] = original[4];
    }

    if (resolveOriginal) {
        for (var k = 0; k < candidates.length; k += 1) {
            await resolveOriginalFor(candidates[k]);
        }
    }

    return candidates.map(function(candidate) { return candidate.row; });
}

function normalizeImageRows(rawRows, query, limit) {
    const rows = rawRows.map((row, index) => {
        if (!Array.isArray(row)) {
            throw new CommandExecutionError('google images returned an unexpected row shape.');
        }
        const title = String(row[0] || '').trim();
        const imageUrl = toHttpsUrl(row[1], 'https://www.google.com');
        const thumbnailUrl = toHttpsUrl(row[2], 'https://www.google.com');
        const sourceUrl = toHttpsUrl(row[3], 'https://www.google.com');
        if (!imageUrl)
            return null;
        return {
            rank: index + 1,
            title,
            imageUrl,
            thumbnailUrl,
            sourceUrl,
            source: String(row[4] || '').trim(),
            width: Number.isFinite(Number(row[5])) ? Number(row[5]) : null,
            height: Number.isFinite(Number(row[6])) ? Number(row[6]) : null,
        };
    }).filter(Boolean).slice(0, limit);

    if (rows.length === 0) {
        throw new EmptyResultError('google images', `No Google image results matched "${query}".`);
    }
    return rows;
}

async function evaluateGoogleImageRows(page, limit, resolveOriginal) {
    let rows = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const raw = await page.evaluate(extractGoogleImageRows, limit, resolveOriginal);
        rows = requireRows(raw, 'google images');
        if (rows.length > 0) {
            return rows;
        }
        if (attempt < 5) {
            if (typeof page.scroll === 'function') {
                await page.scroll('down', 900).catch(() => {});
            }
            await page.wait(1).catch(() => {});
        }
    }
    return rows;
}

const command = cli({
    site: 'google',
    name: 'images',
    access: 'read',
    description: 'Search Google Images for photos and image results',
    domain: 'google.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'keyword', positional: true, required: true, help: 'Image search query' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of image results (1-100)' },
        { name: 'lang', default: 'en', help: 'Language short code (e.g. en, zh)' },
        { name: 'resolve', type: 'bool', default: true, help: 'Click image previews to resolve original imgurl values' },
    ],
    columns: ['rank', 'title', 'imageUrl', 'thumbnailUrl', 'sourceUrl', 'source', 'width', 'height'],
    func: async (page, args) => {
        const query = requireSearchQuery(args.keyword);
        const limit = requireBoundedInteger(args.limit, 20, 1, 100, '--limit');
        const resolveOriginal = args.resolve !== false;
        const lang = encodeURIComponent(String(args.lang || 'en'));
        const pageSize = Math.max(limit, 20);
        const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&hl=${lang}&num=${pageSize}`;

        await runBrowserStep('google images navigation', () => navigateGoogleImages(page, url));
        try {
            await page.wait({ selector: '#rso img, #islrg img, #center_col img, #rcnt img', timeout: 8 });
        }
        catch {
            await page.wait(2).catch(() => {});
        }

        const rows = await runBrowserStep('google images extraction', () => evaluateGoogleImageRows(page, limit, resolveOriginal));
        return normalizeImageRows(rows, query, limit);
    },
});

export const __test__ = { command, evaluateGoogleImageRows, extractGoogleImageRows, normalizeImageRows, navigateGoogleImages };
