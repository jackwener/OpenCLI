/**
 * Anthropic article download - export articles to local Markdown.
 *
 * Usage:
 *   opencli anthropic download --url "https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback" --output ./anthropic
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, getErrorMessage } from '@jackwener/opencli/errors';

const DEFAULT_OUTPUT = './anthropic-articles';
const IMAGE_CONCURRENCY = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; OpenCLI Anthropic article archiver)';

const MONTHS = new Map([
    ['jan', '01'], ['january', '01'],
    ['feb', '02'], ['february', '02'],
    ['mar', '03'], ['march', '03'],
    ['apr', '04'], ['april', '04'],
    ['may', '05'],
    ['jun', '06'], ['june', '06'],
    ['jul', '07'], ['july', '07'],
    ['aug', '08'], ['august', '08'],
    ['sep', '09'], ['sept', '09'], ['september', '09'],
    ['oct', '10'], ['october', '10'],
    ['nov', '11'], ['november', '11'],
    ['dec', '12'], ['december', '12'],
]);

function boolish(value) {
    if (value === true) return true;
    if (value === false) return false;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    return !!value;
}

function normalizeAnthropicUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new ArgumentError('Missing --url', 'Example: opencli anthropic download --url "https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback"');
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new ArgumentError(`Invalid Anthropic article URL: ${raw}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new ArgumentError('Anthropic article URL must use http or https');
    }
    if (parsed.hostname !== 'www.anthropic.com') {
        throw new ArgumentError(
            `Unsupported Anthropic URL: ${raw}`,
            'Use an article URL under https://www.anthropic.com/',
        );
    }
    parsed.protocol = 'https:';
    parsed.hash = '';
    return parsed.toString();
}

function sanitizeFilename(name, maxLength = 120) {
    return String(name)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, maxLength);
}

function parseAnthropicDate(value) {
    const raw = String(value || '').replace(/^Published\s+/i, '').trim();
    const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const match = raw.match(/\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/);
    if (!match) return '';
    const month = MONTHS.get(match[1].toLowerCase());
    if (!month) return '';
    return `${match[3]}-${month}-${String(match[2]).padStart(2, '0')}`;
}

function extractDateFromMarkdown(markdown) {
    const match = String(markdown || '').match(/(?:^|\n)(?:Published\s+)?([A-Za-z]+\s+\d{1,2},\s*\d{4})(?:\n|$)/);
    return parseAnthropicDate(match?.[1] || '');
}

function createTurndown() {
    const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
    });
    td.use(gfm);
    td.remove(['script', 'style', 'noscript']);
    td.addRule('lineBreak', {
        filter: 'br',
        replacement: () => '\n',
    });
    td.addRule('ignoreBase64Images', {
        filter: (node) => {
            if (node.nodeName !== 'IMG') return false;
            const src = node.getAttribute?.('src') || '';
            return src.startsWith('data:');
        },
        replacement: () => '',
    });
    return td;
}

function cleanMarkdown(markdown, title) {
    let output = String(markdown || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`^#\\s+${escapedTitle}\\s*\\n+`, 'i'), '');
    return output.trim();
}

function yamlScalar(value) {
    return JSON.stringify(String(value ?? ''));
}

function buildFrontmatter(metadata) {
    const lines = ['---'];
    for (const [key, value] of Object.entries(metadata)) {
        if (value === '' || value === undefined || value === null) continue;
        if (typeof value === 'number' || typeof value === 'boolean') {
            lines.push(`${key}: ${value}`);
        } else {
            lines.push(`${key}: ${yamlScalar(value)}`);
        }
    }
    lines.push('---');
    return `${lines.join('\n')}\n\n`;
}

function detectExtension(url, contentType = '') {
    const content = contentType.split(';')[0].trim().toLowerCase();
    const byType = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/avif': 'avif',
    };
    if (byType[content]) return byType[content];

    try {
        const ext = path.extname(new URL(url).pathname).replace('.', '').toLowerCase();
        if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
    } catch {
        // Fall through.
    }
    return 'jpg';
}

async function downloadImage(url, destinationBase, sourceUrl) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Referer': sourceUrl,
        },
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const ext = detectExtension(url, response.headers.get('content-type') || '');
    const destination = `${destinationBase}.${ext}`;
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(destination, bytes);
    return destination;
}

async function downloadImages(urls, assetsDir, assetsDirName, sourceUrl) {
    const urlMap = new Map();
    const uniqueUrls = [...new Set(urls.filter(Boolean))];
    await fs.mkdir(assetsDir, { recursive: true });

    for (let i = 0; i < uniqueUrls.length; i += IMAGE_CONCURRENCY) {
        const batch = uniqueUrls.slice(i, i + IMAGE_CONCURRENCY);
        await Promise.all(batch.map(async (url, indexInBatch) => {
            const imageIndex = i + indexInBatch;
            const stem = imageIndex === 0 ? 'cover' : `img_${String(imageIndex).padStart(3, '0')}`;
            try {
                const destination = await downloadImage(url, path.join(assetsDir, stem), sourceUrl);
                urlMap.set(url, `${assetsDirName}/${path.basename(destination)}`);
            } catch {
                // Keep the remote URL in Markdown when a single image download fails.
            }
        }));
    }

    return urlMap;
}

function replaceImageLinks(markdown, urlMap) {
    return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        return urlMap.has(url) ? `![${alt}](${urlMap.get(url)})` : match;
    });
}

function buildExtractAnthropicArticleJs() {
    return `
      (() => {
        const text = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim() || '';
        const absolutize = (value) => {
          if (!value || value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('#')) return '';
          try { return new URL(value, location.href).href; } catch { return ''; }
        };
        const pickSrcset = (srcset) => {
          const candidates = String(srcset || '').split(',').map((part) => {
            const [url, width] = part.trim().split(/\\s+/);
            return { url, score: Number.parseInt(width, 10) || 0 };
          }).filter((item) => item.url);
          candidates.sort((a, b) => b.score - a.score);
          return candidates[0]?.url || '';
        };
        const chooseRoot = () => {
          const direct = Array.from(document.querySelectorAll('article, main'))
            .sort((a, b) => text(b).length - text(a).length)[0];
          if (direct && text(direct).length > 500) return direct;
          const candidates = Array.from(document.querySelectorAll('section, div'))
            .filter((el) => el.querySelector('h1'))
            .sort((a, b) => text(b).length - text(a).length);
          return candidates[0] || document.body;
        };
        const title = text(document.querySelector('h1'))
          || meta('meta[property="og:title"]')
          || (document.title || '').replace(/\\s*[|/].*$/, '').trim()
          || 'untitled';
        const dateText = meta('meta[property="article:published_time"], meta[name="date"], meta[name="publishdate"]')
          || ((document.body?.innerText || '').match(/Published\\s+[A-Za-z]+\\s+\\d{1,2},\\s*\\d{4}/)?.[0] || '');
        const root = chooseRoot().cloneNode(true);

        root.querySelectorAll([
          'script',
          'style',
          'noscript',
          'nav',
          'header',
          'footer',
          'aside',
          'form',
          'button',
          '[aria-hidden="true"]',
          '[class*="newsletter"]',
          '[class*="cookie"]',
          '[class*="share"]'
        ].join(',')).forEach((el) => el.remove());

        let removedTitle = false;
        const titleText = title.toLowerCase();
        Array.from(root.querySelectorAll('a, p, div, span, time, h1')).forEach((el) => {
          const value = text(el);
          const lower = value.toLowerCase();
          const hasMedia = !!el.querySelector('img, picture, video, audio, iframe');
          if (el.tagName === 'H1' && lower === titleText && !removedTitle) {
            el.remove();
            removedTitle = true;
            return;
          }
          if (hasMedia) return;
          if (value === 'Engineering at Anthropic' || /^Published\\s+[A-Za-z]+\\s+\\d{1,2},\\s*\\d{4}$/.test(value)) {
            el.remove();
          }
        });

        const imageUrls = [];
        const seen = new Set();
        root.querySelectorAll('img').forEach((img) => {
          const raw = img.getAttribute('src')
            || img.getAttribute('data-src')
            || img.getAttribute('data-original')
            || pickSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'));
          const absolute = absolutize(raw);
          if (!absolute) {
            img.remove();
            return;
          }
          img.setAttribute('src', absolute);
          if (!seen.has(absolute)) {
            seen.add(absolute);
            imageUrls.push(absolute);
          }
        });

        const coverUrl = absolutize(meta('meta[property="og:image"], meta[name="twitter:image"]')) || imageUrls[0] || '';
        if (coverUrl && !seen.has(coverUrl)) imageUrls.unshift(coverUrl);

        return {
          title,
          dateText,
          author: meta('meta[name="author"], meta[property="article:author"]') || 'Anthropic',
          description: meta('meta[name="description"], meta[property="og:description"]'),
          coverUrl,
          imageUrls,
          contentHtml: root.innerHTML
        };
      })()
    `;
}

async function downloadAnthropicArticle(page, args) {
    const url = normalizeAnthropicUrl(args.url);
    const output = String(args.output || DEFAULT_OUTPUT);
    const shouldDownloadImages = boolish(args['download-images']);

    await page.goto(url, { waitUntil: 'load', settleMs: 3000 });
    const data = await page.evaluate(buildExtractAnthropicArticleJs()).catch((error) => {
        throw new CommandExecutionError(`Failed to extract Anthropic article: ${getErrorMessage(error)}`);
    });

    if (!data?.title || !data?.contentHtml) {
        throw new CommandExecutionError('Anthropic article content was not found', 'The page loaded, but no article root could be extracted.');
    }

    let markdown = cleanMarkdown(createTurndown().turndown(data.contentHtml), data.title);
    const date = parseAnthropicDate(data.dateText) || extractDateFromMarkdown(markdown);
    const datePrefix = date || new Date().toISOString().slice(0, 10);
    const basename = `${datePrefix}-${sanitizeFilename(data.title)}`;
    const outputDir = path.resolve(output);
    const assetsDirName = `${basename}_assets`;
    const assetsDir = path.join(outputDir, assetsDirName);
    const filePath = path.join(outputDir, `${basename}.md`);
    let cover = '';
    let imageCount = 0;

    await fs.mkdir(outputDir, { recursive: true });

    if (shouldDownloadImages && Array.isArray(data.imageUrls) && data.imageUrls.length > 0) {
        const urlMap = await downloadImages(data.imageUrls, assetsDir, assetsDirName, url);
        markdown = replaceImageLinks(markdown, urlMap);
        cover = data.coverUrl ? urlMap.get(data.coverUrl) || '' : '';
        imageCount = urlMap.size;
    }

    const frontmatter = buildFrontmatter({
        title: data.title,
        date,
        author: data.author || 'Anthropic',
        site: 'Anthropic',
        source_url: url,
        description: data.description,
        cover,
        downloaded_at: new Date().toISOString(),
        image_count: imageCount,
    });

    await fs.writeFile(filePath, `${frontmatter}# ${data.title}\n\n${markdown}\n`, 'utf8');

    return [{
        title: data.title,
        date: date || '-',
        status: 'success',
        images: imageCount,
        saved: filePath,
        assets: shouldDownloadImages ? assetsDir : '',
    }];
}

export const anthropicDownloadCommand = cli({
    site: 'anthropic',
    name: 'download',
    access: 'read',
    description: 'Download Anthropic articles as local Markdown with YAML frontmatter and images',
    domain: 'www.anthropic.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'url', required: true, help: 'Anthropic article URL under www.anthropic.com' },
        { name: 'output', default: DEFAULT_OUTPUT, help: 'Output directory' },
        { name: 'download-images', type: 'boolean', default: true, help: 'Download cover and article images locally' },
    ],
    columns: ['title', 'date', 'status', 'images', 'saved', 'assets'],
    func: downloadAnthropicArticle,
});

export const __test__ = {
    buildExtractAnthropicArticleJs,
    cleanMarkdown,
    extractDateFromMarkdown,
    normalizeAnthropicUrl,
    parseAnthropicDate,
    sanitizeFilename,
};
