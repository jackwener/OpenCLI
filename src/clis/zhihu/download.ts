/**
 * Zhihu download — export articles to Markdown format.
 *
 * Usage:
 *   opencli zhihu download --url "https://zhuanlan.zhihu.com/p/xxx" --output ./zhihu
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '../../registry.js';
import { sanitizeFilename, httpDownload } from '../../download/index.js';
import { formatBytes } from '../../download/progress.js';

/**
 * Convert HTML content to Markdown.
 * This is a simplified converter for Zhihu article content.
 */
function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove script and style tags
  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert headers
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');

  // Convert paragraphs
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Convert images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Convert lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n') + '\n';
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
    let index = 0;
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${++index}. $1\n`) + '\n';
  });

  // Convert bold and italic
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // Convert code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

  // Convert blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
    return content.split('\n').map((line: string) => `> ${line}`).join('\n') + '\n\n';
  });

  // Convert line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&quot;/g, '"');

  // Clean up extra whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

cli({
  site: 'zhihu',
  name: 'download',
  description: '导出知乎文章为 Markdown 格式',
  domain: 'zhuanlan.zhihu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'url', required: true, help: 'Article URL (zhuanlan.zhihu.com/p/xxx)' },
    { name: 'output', default: './zhihu-articles', help: 'Output directory' },
    { name: 'download-images', type: 'boolean', default: false, help: 'Download images locally' },
  ],
  columns: ['title', 'author', 'status', 'size'],
  func: async (page, kwargs) => {
    const url = kwargs.url;
    const output = kwargs.output;
    const downloadImages = kwargs['download-images'];

    // Navigate to article page
    await page.goto(url);
    await page.wait(3);

    // Extract article content
    const data = await page.evaluate(`
      (() => {
        const result = {
          title: '',
          author: '',
          content: '',
          publishTime: '',
          images: []
        };

        // Get title
        const titleEl = document.querySelector('.Post-Title, h1.ContentItem-title, .ArticleTitle');
        result.title = titleEl?.textContent?.trim() || 'untitled';

        // Get author
        const authorEl = document.querySelector('.AuthorInfo-name, .UserLink-link');
        result.author = authorEl?.textContent?.trim() || 'unknown';

        // Get publish time
        const timeEl = document.querySelector('.ContentItem-time, .Post-Time');
        result.publishTime = timeEl?.textContent?.trim() || '';

        // Get content HTML
        const contentEl = document.querySelector('.Post-RichTextContainer, .RichText, .ArticleContent');
        if (contentEl) {
          result.content = contentEl.innerHTML;

          // Extract image URLs
          contentEl.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('data-original') || img.getAttribute('data-actualsrc') || img.src;
            if (src && !src.includes('data:image')) {
              result.images.push(src);
            }
          });
        }

        return result;
      })()
    `);

    if (!data || !data.content) {
      return [{
        title: 'Error',
        author: '-',
        status: 'failed',
        size: 'Could not extract article content',
      }];
    }

    // Create output directory
    fs.mkdirSync(output, { recursive: true });

    // Convert HTML to Markdown
    let markdown = htmlToMarkdown(data.content);

    // Create frontmatter
    const frontmatter = [
      '---',
      `title: "${data.title.replace(/"/g, '\\"')}"`,
      `author: "${data.author.replace(/"/g, '\\"')}"`,
      `source: "${url}"`,
      data.publishTime ? `date: "${data.publishTime}"` : '',
      '---',
      '',
    ].filter(Boolean).join('\n');

    // Download images if requested
    if (downloadImages && data.images && data.images.length > 0) {
      const imagesDir = path.join(output, 'images');
      fs.mkdirSync(imagesDir, { recursive: true });

      const cookies = await page.evaluate(`(() => document.cookie)()`);

      for (let i = 0; i < data.images.length; i++) {
        const imgUrl = data.images[i];
        const ext = imgUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
        const imgFilename = `img_${i + 1}.${ext}`;
        const imgPath = path.join(imagesDir, imgFilename);

        try {
          await httpDownload(imgUrl, imgPath, {
            cookies: typeof cookies === 'string' ? cookies : '',
            timeout: 30000,
          });

          // Replace image URL in markdown with local path
          markdown = markdown.replace(
            new RegExp(imgUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            `./images/${imgFilename}`,
          );
        } catch {
          // Keep original URL if download fails
        }
      }
    }

    // Write markdown file
    const safeTitle = sanitizeFilename(data.title, 100);
    const filename = `${safeTitle}.md`;
    const filePath = path.join(output, filename);

    const fullContent = frontmatter + '\n' + markdown;
    fs.writeFileSync(filePath, fullContent, 'utf-8');

    const size = Buffer.byteLength(fullContent, 'utf-8');

    return [{
      title: data.title,
      author: data.author,
      status: 'success',
      size: formatBytes(size),
    }];
  },
});
