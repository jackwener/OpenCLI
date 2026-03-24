import { CommandExecutionError } from '../../errors.js';
import type { IPage } from '../../types.js';

export function buildMediumTagUrl(topic?: string): string {
  return topic ? `https://medium.com/tag/${encodeURIComponent(topic)}` : 'https://medium.com/tag/technology';
}

export function buildMediumSearchUrl(keyword: string): string {
  return `https://medium.com/search?q=${encodeURIComponent(keyword)}`;
}

export function buildMediumUserUrl(username: string): string {
  return username.startsWith('@') ? `https://medium.com/${username}` : `https://medium.com/@${username}`;
}

export async function loadMediumPosts(page: IPage, url: string, limit: number): Promise<any[]> {
  if (!page) throw new CommandExecutionError('Browser session required for medium posts');
  await page.goto(url);
  await page.wait(5);
  const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const limit = ${Math.max(1, Math.min(limit, 50))};
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const posts = [];
      const seen = new Set();

      for (const article of Array.from(document.querySelectorAll('article'))) {
        try {
          const titleEl = article.querySelector('h2, h3, h1');
          const title = normalize(titleEl?.textContent);
          if (!title) continue;

          const linkEl = titleEl?.closest('a') || article.querySelector('a[href*="/@"], a[href*="/p/"]');
          let url = linkEl?.getAttribute('href') || '';
          if (!url) continue;
          if (!url.startsWith('http')) url = 'https://medium.com' + url;
          if (seen.has(url)) continue;

          const author = normalize(
            Array.from(article.querySelectorAll('a[href^="/@"]'))
              .map((node) => normalize(node.textContent))
              .find((text) => text && text !== title),
          );

          const allText = normalize(article.textContent);
          const dateEl = article.querySelector('time');
          const date = normalize(dateEl?.textContent) ||
            dateEl?.getAttribute('datetime') ||
            allText.match(/\\b(?:[A-Z][a-z]{2}\\s+\\d{1,2}|\\d+[dhmw]\\s+ago)\\b/)?.[0] ||
            '';

          const readTime = allText.match(/(\\d+)\\s*min\\s*read/i)?.[0] || '';
          const claps = allText.match(/\\b(\\d+(?:\\.\\d+)?[KkMm]?)\\s*claps?\\b/i)?.[1] || '';

          const description = normalize(
            Array.from(article.querySelectorAll('h3, p'))
              .map((node) => normalize(node.textContent))
              .find((text) => text && text !== title && text !== author && !/member-only story|response icon/i.test(text)),
          );

          seen.add(url);
          posts.push({
            rank: posts.length + 1,
            title,
            author,
            date,
            readTime,
            claps,
            description: description ? description.slice(0, 150) : '',
            url,
          });

          if (posts.length >= limit) break;
        } catch {}
      }

      return posts;
    })()
  `);

  return Array.isArray(data) ? data : [];
}
