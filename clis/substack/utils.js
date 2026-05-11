import { CommandExecutionError } from '@jackwener/opencli/errors';
const FEED_POST_LINK_SELECTOR = 'a[href*="/home/post/"], a[href*="/p/"]';
const ARCHIVE_POST_LINK_SELECTOR = 'a[href*="/p/"]';
export function buildSubstackBrowseUrl(category) {
    if (!category || category === 'all')
        return 'https://substack.com/';
    const slug = category === 'tech' ? 'technology' : category;
    return `https://substack.com/browse/${slug}`;
}
export async function loadSubstackFeed(page, url, limit) {
    if (!page)
        throw new CommandExecutionError('Browser session required for substack feed');
    await page.goto(url);
    await page.wait({ selector: FEED_POST_LINK_SELECTOR, timeout: 5 });
    const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const limit = ${Math.max(1, Math.min(limit, 50))};
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const posts = [];
      const seen = new Set();

      const allLinks = Array.from(document.querySelectorAll('a')).filter((link) => {
        const href = link.getAttribute('href') || '';
        return href.includes('/home/post/') || href.includes('/p/');
      });

      for (const linkEl of allLinks) {
        let postUrl = linkEl.getAttribute('href') || '';
        if (!postUrl) continue;
        if (!postUrl.startsWith('http')) postUrl = 'https://substack.com' + postUrl;
        if (seen.has(postUrl)) continue;

        const lines = (linkEl.innerText || '')
          .split('\\n')
          .map((line) => normalize(line))
          .filter(Boolean);

        const readMeta = lines.find((line) => /\\b(read|watch|listen)\\b/i.test(line)) || '';
        if (!readMeta) continue;

        const date = lines.find((line) => /^[A-Z]{3}\\s+\\d{1,2}$/i.test(line)) || '';
        const contentLines = lines.filter((line) =>
          line &&
          line !== date &&
          line !== readMeta &&
          line.toLowerCase() !== 'save' &&
          line.toLowerCase() !== 'more' &&
          !/^(sign in|create account|get app)$/i.test(line),
        );

        const metaParts = readMeta.split('∙').map((part) => normalize(part));
        const author = metaParts[0] || '';
        const readTime = metaParts.slice(1).join(' ∙ ') || readMeta;
        const title = contentLines.length >= 2 ? contentLines[1] : (contentLines[0] || '');
        const description = contentLines.length >= 3 ? contentLines.slice(2).join(' ') : '';
        if (!title) continue;

        seen.add(postUrl);
        posts.push({
          rank: posts.length + 1,
          title,
          author,
          date,
          readTime,
          description: description.slice(0, 150),
          url: postUrl,
        });

        if (posts.length >= limit) break;
      }

      return posts;
    })()
  `);
    return Array.isArray(data) ? data : [];
}
export async function loadSubstackArchive(page, baseUrl, limit) {
    if (!page)
        throw new CommandExecutionError('Browser session required for substack archive');
    await page.goto(`${baseUrl}/archive`);
    await page.wait({ selector: ARCHIVE_POST_LINK_SELECTOR, timeout: 5 });
    const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const limit = ${Math.max(1, Math.min(limit, 50))};
      const grouped = new Map();

      for (const link of Array.from(document.querySelectorAll('a[href*="/p/"]'))) {
        const rawHref = link.getAttribute('href') || '';
        if (!rawHref || rawHref === '/p/upgrade') continue;

        const url = rawHref.startsWith('http') ? rawHref : ${JSON.stringify(baseUrl)} + rawHref;
        const text = normalize(link.textContent);
        if (!text) continue;
        if (/^(subscribe|paid|home|about|latest|top|discussions)$/i.test(text)) continue;
        if (/^[\\d,]+$/.test(text)) continue;

        const entry = grouped.get(url) || { texts: new Set(), date: '' };
        entry.texts.add(text);

        const container = link.closest('article, section, div') || link.parentElement || link;
        const containerText = normalize(container.textContent);
        if (!entry.date) {
          entry.date = containerText.match(/\\b(?:[A-Z]{3}\\s+\\d{1,2}|[A-Z][a-z]{2}\\s+\\d{1,2})\\b/)?.[0] || '';
        }

        grouped.set(url, entry);
      }

      const posts = [];
      for (const [url, entry] of Array.from(grouped.entries())) {
        const texts = Array.from(entry.texts).map((text) => normalize(text)).filter((text) => text.length > 3).sort((a, b) => a.length - b.length);
        const title = texts[0] || '';
        const description = texts.find((text) => text !== title) || '';
        if (!title) continue;
        posts.push({
          rank: posts.length + 1,
          title,
          date: entry.date,
          description: description.slice(0, 150),
          url,
        });
        if (posts.length >= limit) break;
      }

      return posts;
    })()
  `);
    return Array.isArray(data) ? data : [];
}
export const __test__ = {
    FEED_POST_LINK_SELECTOR,
    ARCHIVE_POST_LINK_SELECTOR,
};
