import { AuthRequiredError, EmptyResultError, ArgumentError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';

/**
 * band posts — List posts from a specific Band.
 *
 * Band.us signs every API request with a per-request HMAC (`md` header) generated
 * by its own JavaScript, so we cannot replicate it externally. Instead we use
 * Strategy.INTERCEPT: install an XHR interceptor, then SPA-navigate to the target
 * band's post page — which causes Band's React app to call get_posts_and_announcements
 * with its own auth headers automatically.
 */
cli({
  site: 'band',
  name: 'posts',
  description: 'List posts from a Band',
  domain: 'www.band.us',
  strategy: Strategy.INTERCEPT,
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

    if (!bandNo) throw new ArgumentError('band_no', 'Band number is required. Get it from: band bands');

    await page.goto('https://www.band.us/');
    await page.wait(2); // wait for React hydration and cookie settlement

    const isLoggedIn = await page.evaluate(`() => document.cookie.includes('band_session')`);
    if (!isLoggedIn) throw new AuthRequiredError('band.us', 'Not logged in to Band');

    // Install XHR interceptor before triggering navigation so we don't miss the request.
    await page.installInterceptor('get_posts_and_announcements');

    // SPA navigation: history.pushState keeps the React app alive (no full reload),
    // so the interceptor stays active. PopStateEvent signals React Router to re-render.
    await page.evaluate(`() => {
      window.history.pushState({}, '', '/band/${bandNo}/post');
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }`);
    await page.wait(4); // allow time for the XHR round-trip to complete

    const requests = await page.getInterceptedRequests();
    if (requests.length === 0) {
      throw new EmptyResultError('band posts', 'No post data captured');
    }

    // result_data.items contains both posts and announcements. Filter to items that
    // have a resolvable post object with at least a post_no or web_url to link to.
    const items = (requests as any[]).flatMap(req =>
      Array.isArray(req?.result_data?.items) ? req.result_data.items : []
    ).filter((item: any) => {
      const post = item.post ?? item;
      return post.post_no || post.web_url;
    });

    if (items.length === 0) {
      throw new EmptyResultError('band posts', 'No posts found in this Band');
    }

    // Band markup tags (<band:mention>, <band:sticker>, etc.) appear in content;
    // strip them to get plain text.
    const stripBandTags = (s: string) => s.replace(/<\/?band:[^>]+>/g, '').trim();

    return items.slice(0, limit).map((item: any) => {
      // Some bands wrap the post under item.post; others return the post object directly.
      const post = item.post ?? item;
      const ts = post.created_at ? new Date(post.created_at) : null;
      return {
        date: ts
          ? ts.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '',
        author: post.author?.name ?? '',
        content: stripBandTags(post.content ?? '').slice(0, 120),
        comments: post.comment_count ?? 0,
        url: post.web_url ?? `https://band.us/band/${bandNo}/post/${post.post_no}`,
      };
    });
  },
});
