/**
 * Web MD — Convert any web page to Markdown with enhanced quality.
 *
 * Uses @mozilla/readability for content extraction and Turndown + GFM
 * for HTML-to-Markdown conversion. Preserves image/video URLs.
 *
 * Usage:
 *   opencli web md --url "https://example.com/article"
 *   opencli web md --url "https://..." --output ./docs/article.md
 *   opencli web md --url "https://..." --stdout
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { sanitizeFilename } from '@jackwener/opencli/download';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

// Read Readability source for injection into browser context
const READABILITY_SOURCE = readFileSync(
  new URL('../../node_modules/@mozilla/readability/Readability.js', import.meta.url),
  'utf-8',
);

const BROWSER_EXTRACTION_JS = `
(() => {
  ${READABILITY_SOURCE}

  function collectMediaUrls(rootEl) {
    const urls = { images: [], videos: [], audios: [], iframes: [] };
    const seen = new Set();

    const addUrl = (list, src) => {
      if (src && !src.startsWith('data:') && !seen.has(src) && src.length < 2000) {
        seen.add(src);
        list.push(src);
      }
    };

    // Images — check multiple lazy-load attributes
    rootEl.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('data-src')
        || img.getAttribute('data-original')
        || img.getAttribute('data-lazy-src')
        || img.getAttribute('data-srcset')?.split(',')[0]?.trim().split(' ')[0]
        || img.getAttribute('src')
        || '';
      const resolved = src ? new URL(src, location.href).href : '';
      addUrl(urls.images, resolved);
    });

    // Videos
    rootEl.querySelectorAll('video').forEach(v => {
      const src = v.getAttribute('src')
        || (v.querySelector('source')?.getAttribute('src') || '');
      const poster = v.getAttribute('poster') || '';
      if (src) {
        urls.videos.push({ src: new URL(src, location.href).href, poster: poster ? new URL(poster, location.href).href : '' });
      }
    });

    // Audio
    rootEl.querySelectorAll('audio').forEach(a => {
      const src = a.getAttribute('src')
        || (a.querySelector('source')?.getAttribute('src') || '');
      if (src) urls.audios.push(new URL(src, location.href).href);
    });

    // Iframes
    rootEl.querySelectorAll('iframe').forEach(f => {
      const src = f.getAttribute('src');
      if (src) urls.iframes.push({ src, title: f.getAttribute('title') || 'Embedded content' });
    });

    return urls;
  }

  function runReadability() {
    const doc = document.cloneNode(true);
    const reader = new Readability(doc, {
      charThreshold: 0,
      keepClasses: false,
    });
    return reader.parse();
  }

  // --- Fallback: DOM heuristic from web/read.js ---
  function fallbackExtraction() {
    let contentEl = null;

    const articles = document.querySelectorAll('article');
    if (articles.length === 1) {
      contentEl = articles[0];
    } else if (articles.length > 1) {
      let maxLen = 0;
      articles.forEach(a => {
        const len = a.textContent?.length || 0;
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
        const len = c.textContent?.length || 0;
        if (len > maxLen) { maxLen = len; contentEl = c; }
      });
    }

    if (!contentEl || (contentEl.textContent?.length || 0) < 200) {
      contentEl = document.body;
    }

    const media = collectMediaUrls(contentEl);
    return {
      contentHtml: contentEl.innerHTML,
      title: document.querySelector('meta[property="og:title"]')?.content
        || document.querySelector('h1')?.textContent?.trim()
        || document.title || 'untitled',
      byline: '',
      publishedTime: '',
      mediaUrls: media,
    };
  }

  // --- Main ---
  try {
    const article = runReadability();
    if (!article || !article.content || article.content.length < 100) {
      throw new Error('Readability returned empty/short content');
    }
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = article.content;
    const mediaUrls = collectMediaUrls(tempDiv);

    let publishedTime = '';
    const timeMeta = document.querySelector(
      'meta[property="article:published_time"], meta[name="date"], meta[name="publishdate"]'
    );
    if (timeMeta) {
      publishedTime = timeMeta.getAttribute('content') || '';
    }
    const timeEl = document.querySelector('time[datetime]');
    if (!publishedTime && timeEl) {
      publishedTime = timeEl.getAttribute('datetime') || '';
    }

    return {
      contentHtml: article.content,
      title: article.title || 'untitled',
      byline: article.byline || '',
      publishedTime,
      mediaUrls,
      source: 'readability',
    };
  } catch (e) {
    const result = fallbackExtraction();
    result.source = 'fallback';
    return result;
  }
})()
`;

function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  // GFM plugin for tables, strikethrough, task lists
  try {
    td.use(gfm);
  } catch {
    // Fallback: manual table rule if GFM plugin is incompatible with Turndown v7
    td.addRule('table', {
      filter: (node) => node.nodeName === 'TABLE',
      replacement: (content, node) => {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (rows.length === 0) return '';
        const mdRows = [];
        rows.forEach((tr, i) => {
          const cells = Array.from(tr.querySelectorAll('th, td'));
          const mdCells = cells.map(td => {
            const text = td.textContent.trim().replace(/\n/g, ' ');
            return text || ' ';
          });
          mdRows.push('| ' + mdCells.join(' | ') + ' |');
          if (i === 0 && tr.querySelector('th')) {
            mdRows.push('| ' + mdCells.map(() => '---').join(' | ') + ' |');
          }
        });
        return '\n' + mdRows.join('\n') + '\n';
      },
    });
  }

  // Video → HTML
  td.addRule('video', {
    filter: (node) => node.nodeName === 'VIDEO',
    replacement: (content, node) => {
      const src = node.getAttribute('src')
        || node.querySelector('source')?.getAttribute('src') || '';
      const poster = node.getAttribute('poster') || '';
      if (!src) return '';
      let result = `\n<video src="${src}" controls`;
      if (poster) result += ` poster="${poster}"`;
      result += `></video>\n`;
      return result;
    },
  });

  // Audio → HTML
  td.addRule('audio', {
    filter: (node) => node.nodeName === 'AUDIO',
    replacement: (content, node) => {
      const src = node.getAttribute('src')
        || node.querySelector('source')?.getAttribute('src') || '';
      return src ? `\n<audio src="${src}" controls></audio>\n` : '';
    },
  });

  // iframe → link
  td.addRule('iframe', {
    filter: 'iframe',
    replacement: (content, node) => {
      const src = node.getAttribute('src') || '';
      const title = node.getAttribute('title') || 'Embedded content';
      return src ? `\n[${title}](${src})\n` : '';
    },
  });

  // Image with multiple lazy-load sources
  td.addRule('image', {
    filter: 'img',
    replacement: (content, node) => {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src')
        || node.getAttribute('data-src')
        || node.getAttribute('data-original')
        || node.getAttribute('data-lazy-src') || '';
      return src ? `![${alt}](${src})` : '';
    },
  });

  return td;
}

function safeInline(s) {
  return String(s).replace(/[\n\r]/g, ' ').slice(0, 200);
}

function buildMarkdown(data, bodyMd) {
  const safeTitle = safeInline(data.title);
  const lines = [
    '---',
    `title: ${safeTitle}`,
  ];
  if (data.byline) lines.push(`author: ${safeInline(data.byline)}`);
  if (data.publishedTime) lines.push(`date: ${safeInline(data.publishedTime)}`);
  lines.push(`source: ${data.sourceUrl || ''}`);
  lines.push('---', '');
  lines.push(`# ${safeTitle}`, '');
  if (data.byline || data.publishedTime) {
    const meta = [data.byline, data.publishedTime].filter(Boolean).join(' | ');
    if (meta) lines.push(`> ${meta}`, '');
  }
  lines.push('---', '');
  lines.push(bodyMd);
  return lines.join('\n');
}

cli({
  site: 'web',
  name: 'md',
  description: 'Convert any web page to Markdown with enhanced quality',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'url', required: true, help: 'Any web page URL' },
    { name: 'output', default: '', help: 'Output file path or directory (default: current directory)' },
    { name: 'wait', type: 'int', default: 2, help: 'Seconds to wait for page to fully load' },
    { name: 'stdout', type: 'boolean', default: false, help: 'Print Markdown to stdout instead of saving to file' },
  ],
  columns: ['title', 'author', 'publish_time', 'status', 'size'],
  func: async (page, kwargs) => {
    const url = kwargs.url;

    // Navigate
    try {
      await page.goto(url);
    } catch (err) {
      return [{ title: '', author: '', publish_time: '', status: `error: ${err.message}`, size: '' }];
    }

    // Wait for dynamic content
    await page.wait(kwargs.wait ?? 2);

    // Extract content
    const data = await page.evaluate(BROWSER_EXTRACTION_JS);

    if (!data || !data.contentHtml) {
      return [{ title: '', author: '', publish_time: '', status: 'error: no content extracted', size: '' }];
    }

    // Convert HTML to Markdown
    const td = createTurndown();
    let bodyMd = td.turndown(data.contentHtml);

    // Clean up excessive newlines
    bodyMd = bodyMd.replace(/\n{4,}/g, '\n\n\n').trim();

    // Build final markdown with frontmatter
    const fullMd = buildMarkdown({
      title: data.title,
      byline: data.byline,
      publishedTime: data.publishedTime,
      sourceUrl: url,
    }, bodyMd);

    // Output
    if (kwargs.stdout) {
      console.log(fullMd);
      return [{
        title: data.title,
        author: data.byline || '-',
        publish_time: data.publishedTime || '-',
        status: 'success',
        size: '-',
      }];
    }

    // Save to file
    let outputPath = kwargs.output || './';
    if (outputPath.endsWith('/') || outputPath.endsWith(path.sep) || isDirectory(outputPath)) {
      const safeTitle = sanitizeFilename(data.title, 80);
      outputPath = path.join(outputPath, safeTitle + '.md');
    }

    try {
      const parentDir = path.dirname(outputPath);
      await mkdir(parentDir, { recursive: true });
      await writeFile(outputPath, fullMd, 'utf-8');

      const stats = await stat(outputPath);

      const sizeBytes = stats.size;
      const sizeStr = sizeBytes > 1024
        ? `${(sizeBytes / 1024).toFixed(1)} KB`
        : `${sizeBytes} B`;

      return [{
        title: data.title,
        author: data.byline || '-',
        publish_time: data.publishedTime || '-',
        status: 'success',
        size: sizeStr,
      }];
    } catch (err) {
      return [{
        title: data.title,
        author: data.byline || '-',
        publish_time: data.publishedTime || '-',
        status: `error: ${err.message}`,
        size: '',
      }];
    }
  },
});
