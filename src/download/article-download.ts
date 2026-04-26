/**
 * Article download helper — shared logic for downloading articles as Markdown.
 *
 * Used by: zhihu/download, weixin/download, and future article adapters.
 *
 * Flow: ArticleData → TurndownService → image download → frontmatter → .md file
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { httpDownload, sanitizeFilename } from './index.js';
import { formatBytes } from './progress.js';

const IMAGE_CONCURRENCY = 5;

// ============================================================
// Types
// ============================================================

export interface ArticleData {
  title: string;
  author?: string;
  publishTime?: string;
  sourceUrl?: string;
  contentHtml: string;
  /** Pre-extracted code blocks to restore after Markdown conversion */
  codeBlocks?: Array<{ lang: string; code: string }>;
  /** Image URLs found in the article (pre-collected from DOM) */
  imageUrls?: string[];
}

export interface FrontmatterLabels {
  author?: string;
  publishTime?: string;
  sourceUrl?: string;
}

export interface ArticleDownloadOptions {
  output: string;
  downloadImages?: boolean;
  /** Extra headers for image downloads (e.g. { Referer: '...' }) */
  imageHeaders?: Record<string, string>;
  maxTitleLength?: number;
  /** Custom TurndownService configuration callback */
  configureTurndown?: (td: TurndownService) => void;
  /** Custom image extension detector (default: infer from URL extension) */
  detectImageExt?: (url: string) => string;
  /** Custom frontmatter labels (default: Chinese labels) */
  frontmatterLabels?: FrontmatterLabels;
  /**
   * Extra CSS selectors removed from the article before Turndown conversion.
   * Use this to drop site-specific noise the adapter can't always trim upstream
   * (e.g. zhihu 折叠卡, weixin 赞赏栏, wiki infobox).
   */
  cleanSelectors?: string[];
  /**
   * Write the markdown to `process.stdout` instead of a file on disk. Image
   * download and directory creation are skipped — remote image URLs are kept
   * as-is so the output is self-contained when piped.
   */
  stdout?: boolean;
}

export interface ArticleDownloadResult {
  title: string;
  author: string;
  publish_time: string;
  status: string;
  size: string;
  saved: string;
}

const DEFAULT_LABELS: Required<FrontmatterLabels> = {
  author: '作者',
  publishTime: '发布时间',
  sourceUrl: '原文链接',
};

// ============================================================
// Markdown Conversion
// ============================================================

// Nodes that never carry article content. Turndown keeps them by default — if an
// adapter's contentHtml extraction misses one, CSS / scripts / widget markup
// ends up inline in the .md. Strip them unconditionally at the converter level.
// `svg` is not in HTMLElementTagNameMap, so we type-narrow manually.
// `header/footer/nav/aside` cover page chrome that adapters occasionally
// forget to trim — the article's own title/author/publishTime are supplied
// as separate fields on ArticleData, so duplicated nodes are redundant.
// `iframe` is NOT in this set — it's handled by a dedicated rule below that
// degrades to a link so embedded content (YouTube, Twitter, CodePen …) keeps
// a reachable URL in the exported markdown.
// `button` is NOT in this set — buttons inside <form> are already removed when
// the parent <form> is stripped; standalone buttons may carry meaningful labels
// (e.g. "Download All") and are handled by the dedicated `buttonElement` rule
// below which preserves their text content as inline Markdown.
const STRIPPED_TAGS: Array<keyof HTMLElementTagNameMap> = [
  'script', 'style', 'noscript',
  'canvas',
  'form', 'dialog',
  'header', 'footer', 'nav', 'aside',
];

function createTurndown(
  configure?: (td: TurndownService) => void,
  cleanSelectors?: string[],
): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  td.use(gfm);
  td.remove(STRIPPED_TAGS);
  // turndown-plugin-gfm@1.0.2 emits single-tilde strikethrough (`~x~`), which
  // is not the canonical GFM form. Override it so exported markdown is
  // portable across common renderers.
  td.addRule('canonicalStrikethrough', {
    filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });
  // SVG isn't in the static HTML tag map; match by name with a custom filter.
  td.addRule('stripSvg', {
    filter: (node) => node.nodeName === 'svg' || node.nodeName === 'SVG',
    replacement: () => '',
  });
  td.addRule('linebreak', {
    filter: 'br',
    replacement: () => '\n',
  });
  // Inline base64 images would land as huge `![](data:image/...;base64,...)`
  // strings that the image downloader can't localize. Drop them.
  td.addRule('ignoreBase64Images', {
    filter: (node) => {
      if (node.nodeName !== 'IMG') return false;
      const src = (node as HTMLImageElement).getAttribute?.('src') ?? '';
      return src.startsWith('data:');
    },
    replacement: () => '',
  });
  // Markdown has no native video/audio primitive. Emit inline HTML so
  // renderers that support it (GitHub, VS Code preview …) still play the
  // media; viewers that don't simply show the tag as text, which is still
  // more information than dropping the node outright.
  td.addRule('videoElement', {
    filter: (node) => node.nodeName === 'VIDEO',
    replacement: (_content, node) => {
      const el = node as Element;
      const src = el.getAttribute('src')
        || el.querySelector('source')?.getAttribute('src')
        || '';
      if (!src) return '';
      const poster = el.getAttribute('poster') || '';
      return `\n<video src="${src}" controls${poster ? ` poster="${poster}"` : ''}></video>\n`;
    },
  });
  td.addRule('audioElement', {
    filter: (node) => node.nodeName === 'AUDIO',
    replacement: (_content, node) => {
      const el = node as Element;
      const src = el.getAttribute('src')
        || el.querySelector('source')?.getAttribute('src')
        || '';
      return src ? `\n<audio src="${src}" controls></audio>\n` : '';
    },
  });
  // Buttons may carry meaningful labels on content pages (e.g. "Download All",
  // "Copy"). Rather than stripping them wholesale, preserve the trimmed text
  // content as inline Markdown. Buttons that contain no visible text (icon-only
  // or purely decorative) are silently dropped. Buttons inside <form> elements
  // are never reached here because the parent <form> is already removed by
  // STRIPPED_TAGS before Turndown processes children.
  td.addRule('buttonElement', {
    filter: (node) => node.nodeName === 'BUTTON',
    replacement: (_content, node) => {
      const text = (node as Element).textContent?.trim() ?? '';
      return text ? text : '';
    },
  });
  // Iframes (YouTube, Twitter, CodePen …) degrade to a markdown link so the
  // embedded resource is still reachable from the exported file.
  td.addRule('iframeToLink', {
    filter: (node) => node.nodeName === 'IFRAME',
    replacement: (_content, node) => {
      const el = node as Element;
      const src = el.getAttribute('src') || '';
      if (!src) return '';
      const title = el.getAttribute('title') || 'Embedded content';
      return `\n[${title}](${src})\n`;
    },
  });
  // Per-adapter dirty-node removal. Adapters know their site's specific noise
  // (zhihu 折叠卡, weixin 赞赏栏, wiki 折叠 infobox …); we keep the default set
  // empty so the generic converter stays untouched.
  const selectorRules = (cleanSelectors ?? [])
    .map(sel => sel.trim())
    .filter(Boolean);
  if (selectorRules.length > 0) {
    td.addRule('cleanSelectors', {
      filter: (node) => {
        const match = (node as Element).matches;
        if (typeof match !== 'function') return false;
        return selectorRules.some((sel) => {
          try {
            return match.call(node, sel);
          } catch {
            return false;
          }
        });
      },
      replacement: () => '',
    });
  }
  if (configure) configure(td);
  return td;
}

function convertToMarkdown(
  contentHtml: string,
  codeBlocks: Array<{ lang: string; code: string }>,
  configure?: (td: TurndownService) => void,
  cleanSelectors?: string[],
): string {
  const td = createTurndown(configure, cleanSelectors);
  let md = td.turndown(contentHtml);

  // Restore code block placeholders
  codeBlocks.forEach((block, i) => {
    const placeholder = `CODEBLOCK-PLACEHOLDER-${i}`;
    const fenced = `\n\`\`\`${block.lang}\n${block.code}\n\`\`\`\n`;
    md = md.replace(placeholder, fenced);
  });

  // Clean up
  md = md.replace(/\u00a0/g, ' ');
  // Turndown leaves behind lone dashes / middle dots when list bullets or
  // decorative separators lose their surrounding inline context.
  md = md.replace(/^[ \t]*[-·][ \t]*$/gm, '');
  md = md.replace(/^[ \t]+$/gm, '');
  md = md.replace(/[ \t]+$/gm, '');
  md = md.replace(/\n{3,}/g, '\n\n');

  return md;
}

function replaceImageUrls(md: string, urlMap: Record<string, string>): string {
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, imgUrl) => {
    const local = urlMap[imgUrl];
    return local ? `![${alt}](${local})` : match;
  });
}

// ============================================================
// Image Downloading
// ============================================================

function defaultDetectImageExt(url: string): string {
  const extMatch = url.match(/\.(\w{3,4})(?:\?|$)/);
  return extMatch ? extMatch[1] : 'jpg';
}

async function downloadImages(
  imgUrls: string[],
  imgDir: string,
  headers?: Record<string, string>,
  detectExt?: (url: string) => string,
): Promise<Record<string, string>> {
  const urlMap: Record<string, string> = {};
  if (imgUrls.length === 0) return urlMap;

  const detect = detectExt || defaultDetectImageExt;

  // Deduplicate image URLs
  const seen = new Set<string>();
  const uniqueUrls = imgUrls.filter(url => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  for (let i = 0; i < uniqueUrls.length; i += IMAGE_CONCURRENCY) {
    const batch = uniqueUrls.slice(i, i + IMAGE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (rawUrl, j) => {
        const index = i + j + 1;
        let imgUrl = rawUrl;
        if (imgUrl.startsWith('//')) imgUrl = `https:${imgUrl}`;

        const ext = detect(imgUrl);
        const filename = `img_${String(index).padStart(3, '0')}.${ext}`;
        const filepath = path.join(imgDir, filename);

        try {
          const result = await httpDownload(imgUrl, filepath, {
            headers,
            timeout: 15000,
          });
          if (result.success) {
            return { remoteUrl: rawUrl, localPath: `images/${filename}` };
          }
        } catch {
          // Skip failed downloads
        }
        return null;
      }),
    );

    for (const r of results) {
      if (r) urlMap[r.remoteUrl] = r.localPath;
    }
  }
  return urlMap;
}

// ============================================================
// Main API
// ============================================================

/**
 * Download an article to Markdown with optional image localization.
 *
 * Handles the full pipeline:
 * 1. HTML → Markdown (via TurndownService)
 * 2. Code block placeholder restoration
 * 3. Batch image downloading with concurrency + deduplication
 * 4. Image URL replacement in Markdown
 * 5. Frontmatter generation (customizable labels)
 * 6. File write
 */
export async function downloadArticle(
  data: ArticleData,
  options: ArticleDownloadOptions,
): Promise<ArticleDownloadResult[]> {
  const {
    output,
    downloadImages: shouldDownloadImages = true,
    imageHeaders,
    maxTitleLength = 80,
    configureTurndown,
    detectImageExt,
    frontmatterLabels,
    cleanSelectors,
    stdout = false,
  } = options;

  const labels = { ...DEFAULT_LABELS, ...frontmatterLabels };

  if (!data.title) {
    return [{
      title: 'Error',
      author: '-',
      publish_time: '-',
      status: 'failed — no title',
      size: '-',
      saved: '-',
    }];
  }

  if (!data.contentHtml) {
    return [{
      title: data.title,
      author: data.author || '-',
      publish_time: data.publishTime || '-',
      status: 'failed — no content',
      size: '-',
      saved: '-',
    }];
  }

  // Convert HTML to Markdown
  let markdown = convertToMarkdown(
    data.contentHtml,
    data.codeBlocks || [],
    configureTurndown,
    cleanSelectors,
  );

  const safeTitle = sanitizeFilename(data.title, maxTitleLength);

  // Download images only when writing to disk. In stdout mode remote URLs
  // stay intact so the piped output is self-contained.
  if (!stdout && shouldDownloadImages && data.imageUrls && data.imageUrls.length > 0) {
    const articleDir = path.join(output, safeTitle);
    fs.mkdirSync(articleDir, { recursive: true });
    const imagesDir = path.join(articleDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const urlMap = await downloadImages(data.imageUrls, imagesDir, imageHeaders, detectImageExt);
    markdown = replaceImageUrls(markdown, urlMap);
  }

  // Build frontmatter with customizable labels.
  // Shape: `# Title\n[> meta\n...]\n---\n\n<markdown>` — exactly one blank
  // line separates every section, so we never produce ≥3 consecutive newlines.
  const headerLines = [`# ${data.title}`];
  if (data.author) headerLines.push(`> ${labels.author}: ${data.author}`);
  if (data.publishTime) headerLines.push(`> ${labels.publishTime}: ${data.publishTime}`);
  if (data.sourceUrl) headerLines.push(`> ${labels.sourceUrl}: ${data.sourceUrl}`);
  const frontmatter = headerLines.join('\n') + '\n\n---\n\n';
  const fullContent = frontmatter + markdown;
  const size = Buffer.byteLength(fullContent, 'utf-8');

  if (stdout) {
    process.stdout.write(fullContent.endsWith('\n') ? fullContent : fullContent + '\n');
    return [{
      title: data.title,
      author: data.author || '-',
      publish_time: data.publishTime || '-',
      status: 'success',
      size: formatBytes(size),
      saved: '-',
    }];
  }

  const articleDir = path.join(output, safeTitle);
  fs.mkdirSync(articleDir, { recursive: true });
  const filename = `${safeTitle}.md`;
  const filePath = path.join(articleDir, filename);
  fs.writeFileSync(filePath, fullContent, 'utf-8');

  return [{
    title: data.title,
    author: data.author || '-',
    publish_time: data.publishTime || '-',
    status: 'success',
    size: formatBytes(size),
    saved: filePath,
  }];
}
