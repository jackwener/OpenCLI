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

function createTurndown(configure?: (td: TurndownService) => void): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  td.addRule('linebreak', {
    filter: 'br',
    replacement: () => '\n',
  });
  if (configure) configure(td);
  return td;
}

function convertToMarkdown(
  contentHtml: string,
  codeBlocks: Array<{ lang: string; code: string }>,
  configure?: (td: TurndownService) => void,
): string {
  const td = createTurndown(configure);
  let md = td.turndown(contentHtml);

  // Restore code block placeholders
  codeBlocks.forEach((block, i) => {
    const placeholder = `CODEBLOCK-PLACEHOLDER-${i}`;
    const fenced = `\n\`\`\`${block.lang}\n${block.code}\n\`\`\`\n`;
    md = md.replace(placeholder, fenced);
  });

  // Clean up
  md = md.replace(/\u00a0/g, ' ');
  md = md.replace(/\n{4,}/g, '\n\n\n');
  md = md.replace(/[ \t]+$/gm, '');

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
  );

  // Prepare output directory
  const safeTitle = sanitizeFilename(data.title, maxTitleLength);
  const articleDir = path.join(output, safeTitle);
  fs.mkdirSync(articleDir, { recursive: true });

  // Download images
  if (shouldDownloadImages && data.imageUrls && data.imageUrls.length > 0) {
    const imagesDir = path.join(articleDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const urlMap = await downloadImages(data.imageUrls, imagesDir, imageHeaders, detectImageExt);
    markdown = replaceImageUrls(markdown, urlMap);
  }

  // Build frontmatter with customizable labels
  const headerLines = [`# ${data.title}`, ''];
  if (data.author) headerLines.push(`> ${labels.author}: ${data.author}`);
  if (data.publishTime) headerLines.push(`> ${labels.publishTime}: ${data.publishTime}`);
  if (data.sourceUrl) headerLines.push(`> ${labels.sourceUrl}: ${data.sourceUrl}`);
  headerLines.push('', '---', '');

  const fullContent = headerLines.join('\n') + markdown;

  // Write file
  const filename = `${safeTitle}.md`;
  const filePath = path.join(articleDir, filename);
  fs.writeFileSync(filePath, fullContent, 'utf-8');

  const size = Buffer.byteLength(fullContent, 'utf-8');

  return [{
    title: data.title,
    author: data.author || '-',
    publish_time: data.publishTime || '-',
    status: 'success',
    size: formatBytes(size),
    saved: filePath,
  }];
}
