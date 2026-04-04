import { AuthRequiredError, EmptyResultError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';

/**
 * band posts — List posts from a specific Band.
 *
 * Band.us renders the post list in the DOM for logged-in users, so we navigate
 * directly to the band's post page and extract everything from the DOM — no XHR
 * interception or home-page detour required.
 */
cli({
  site: 'band',
  name: 'posts',
  description: 'List posts from a Band',
  domain: 'www.band.us',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    {
      name: 'band_no',
      positional: true,
      required: true,
      type: 'int',
      help: 'Band number (get it from: band bands)',
    },
    { name: 'limit', type: 'int', default: 20, help: 'Max results' },
  ],
  columns: ['date', 'author', 'content', 'comments', 'url'],

  func: async (page, kwargs) => {
    const bandNo = Number(kwargs.band_no);
    const limit = Number(kwargs.limit);

    // Navigate directly to the band's post page — no home-page detour needed.
    await page.goto(`https://www.band.us/band/${bandNo}/post`);

    const cookies = await page.getCookies({ domain: 'band.us' });
    const isLoggedIn = cookies.some(c => c.name === 'band_session');
    if (!isLoggedIn) throw new AuthRequiredError('band.us', 'Not logged in to Band');

    // Extract post list from the DOM. Poll until post items appear (React hydration).
    const posts: {
      date: string;
      author: string;
      content: string;
      comments: number;
      url: string;
    }[] = await page.evaluate(`
      (async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
        const limit = ${limit};

        // Wait up to 9 s for post items to render.
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('article.cContentsCard._postMainWrap')) break;
          await sleep(300);
        }

        // Band embeds custom <band:mention>, <band:sticker>, etc. tags in content.
        const stripTags = s => s.replace(/<\\/?band:[^>]+>/g, '');

        const results = [];
        const postEls = Array.from(
          document.querySelectorAll('article.cContentsCard._postMainWrap')
        );

        for (const el of postEls) {
          // URL: first post permalink link (absolute or relative).
          const linkEl = el.querySelector('a[href*="/post/"]');
          const href = linkEl?.getAttribute('href') || '';
          if (!href) continue;
          const url = href.startsWith('http') ? href : 'https://www.band.us' + href;

          // Author name — a.text in the post header area.
          const author = norm(el.querySelector('a.text')?.textContent);

          // Date / timestamp.
          const date = norm(el.querySelector('time')?.textContent);

          // Post body text (strip Band markup tags, truncate for listing).
          const bodyEl = el.querySelector('.postText._postText');
          const content = bodyEl
            ? stripTags(norm(bodyEl.innerText || bodyEl.textContent)).slice(0, 120)
            : '';

          // Comment count is in span.count inside the count area.
          const commentEl = el.querySelector('span.count');
          const comments = commentEl ? parseInt((commentEl.textContent || '').replace(/[^0-9]/g, ''), 10) || 0 : 0;

          if (results.length >= limit) break;
          results.push({ date, author, content, comments, url });
        }

        return results;
      })()
    `);

    if (!posts || posts.length === 0) {
      throw new EmptyResultError('band posts', 'No posts found in this Band');
    }

    return posts;
  },
});
