/**
 * Zhihu download — export articles to Markdown format.
 *
 * Usage:
 *   opencli zhihu download --url "https://zhuanlan.zhihu.com/p/xxx" --output ./zhihu
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { downloadArticle } from '@jackwener/opencli/download/article-download';
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
    columns: ['title', 'author', 'publish_time', 'status', 'size'],
    func: async (page, kwargs) => {
        const url = kwargs.url;
        // Navigate to article page
        await page.goto(url);
        await page.wait(3);
        // Extract article content
        const data = await page.evaluate(`
      (() => {
        const result = {
          title: '',
          author: '',
          publishTime: '',
          contentHtml: '',
          imageUrls: []
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
          result.contentHtml = contentEl.innerHTML;

          // Extract image URLs
          contentEl.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('data-original') || img.getAttribute('data-actualsrc') || img.src;
            if (src && !src.includes('data:image')) {
              result.imageUrls.push(src);
            }
          });
        }

        return result;
      })()
    `);
        return downloadArticle({
            title: data?.title || '',
            author: data?.author,
            publishTime: data?.publishTime,
            sourceUrl: url,
            contentHtml: data?.contentHtml || '',
            imageUrls: data?.imageUrls,
        }, {
            output: kwargs.output,
            downloadImages: kwargs['download-images'],
            imageHeaders: { Referer: 'https://zhuanlan.zhihu.com/' },
        });
    },
});
