import { AuthRequiredError, EmptyResultError, ArgumentError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';

/**
 * band posts — List posts from a specific Band.
 *
 * Uses the INTERCEPT strategy: navigates to band.us home, installs a fetch
 * interceptor, then SPA-navigates to the target band's post page to capture
 * the get_posts_and_announcements API response.
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
    const limit = Number(kwargs.limit ?? 20);

    if (!bandNo) throw new ArgumentError('band_no', 'Band number is required. Get it from: band bands');

    // 1. Navigate to Band home first
    await page.goto('https://www.band.us/');
    await page.wait(2);

    const isLoggedIn = await page.evaluate(`() => document.cookie.includes('band_session')`);
    if (!isLoggedIn) throw new AuthRequiredError('band.us', 'Not logged in to Band');

    // 2. Install interceptor BEFORE SPA navigation
    await page.installInterceptor('get_posts_and_announcements');

    // 3. SPA navigate to the band's post page
    await page.evaluate(`() => {
      window.history.pushState({}, '', '/band/${bandNo}/post');
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }`);
    await page.wait(4);

    const finalRequests = await page.getInterceptedRequests();

    if (finalRequests.length === 0) {
      throw new EmptyResultError('band posts', 'No post data captured');
    }

    // 4. Parse get_posts_and_announcements response
    let items: any[] = [];
    for (const req of finalRequests) {
      const postItems = req?.result_data?.items;
      if (Array.isArray(postItems)) {
        items.push(...postItems);
      }
    }

    if (items.length === 0) {
      throw new EmptyResultError('band posts', 'No posts found in this Band');
    }

    return items.slice(0, limit).map((item: any) => {
      const post = item.post ?? item;
      const ts = post.created_at ? new Date(post.created_at) : null;
      const dateStr = ts
        ? ts.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
      // Strip Band markup tags
      const rawContent = (post.content ?? '').replace(/<band:[^>]+>[^<]*<\/band:[^>]+>/g, '').trim();
      return {
        date: dateStr,
        author: post.author?.name ?? '',
        content: rawContent.slice(0, 120),
        comments: post.comment_count ?? 0,
        url: post.web_url ?? `https://band.us/band/${bandNo}/post/${post.post_no}`,
      };
    });
  },
});
