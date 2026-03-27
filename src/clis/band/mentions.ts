import { AuthRequiredError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';

/**
 * band mentions — Show Band notifications where you were @mentioned or assigned.
 *
 * Uses the INTERCEPT strategy: navigates to band.us home, installs a fetch
 * interceptor, then clicks the notification bell to trigger the get_news API
 * call (which Band makes with its own auth headers including the md signature).
 */
cli({
  site: 'band',
  name: 'mentions',
  description: 'Show Band notifications where you are @mentioned',
  domain: 'www.band.us',
  strategy: Strategy.INTERCEPT,
  browser: true,
  args: [
    {
      name: 'filter',
      default: 'mentioned',
      choices: ['mentioned', 'all', 'post', 'comment'],
      help: 'Filter: mentioned (default) | all | post | comment',
    },
    { name: 'limit', type: 'int', default: 20, help: 'Max results' },
    { name: 'unread', type: 'bool', default: false, help: 'Show only unread notifications' },
  ],
  columns: ['time', 'band', 'type', 'from', 'text', 'url'],

  func: async (page, kwargs) => {
    const filter = String(kwargs.filter ?? 'mentioned');
    const limit = Number(kwargs.limit ?? 20);
    const unreadOnly = Boolean(kwargs.unread);

    // 1. Navigate to Band home (ensures cookies are active)
    await page.goto('https://www.band.us/');
    await page.wait(2);

    // Verify we're logged in
    const isLoggedIn = await page.evaluate(`() => {
      return document.cookie.includes('band_session');
    }`);
    if (!isLoggedIn) throw new AuthRequiredError('band.us', 'Not logged in to Band');

    // 2. Install interceptor BEFORE triggering any API calls
    await page.installInterceptor('get_news');

    // 3. Click the notification bell (opens panel, triggers get_news for all)
    //    The bell button has class '_btnWidgetIcon' and text content containing 'お知らせ'.
    await page.evaluate(`() => {
      const bell = Array.from(document.querySelectorAll('button._btnWidgetIcon')).find(b =>
        b.textContent && b.textContent.includes('お知らせ')
      );
      if (bell) bell.click();
    }`);
    await page.wait(2);

    // 4. For @mention filter: click the @メンション tab (triggers server-side filtered get_news).
    //    For unread: also click 未確認のみ表示 button.
    if (filter === 'mentioned') {
      await page.evaluate(`() => {
        const tab = Array.from(document.querySelectorAll('button._btnFilter')).find(b =>
          b.textContent && b.textContent.includes('メンション')
        );
        if (tab) tab.click();
      }`);
      await page.wait(2);

      if (unreadOnly) {
        await page.evaluate(`() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            b.textContent && b.textContent.includes('未確認のみ')
          );
          if (btn) btn.click();
        }`);
        await page.wait(2);
      }
    }

    // 5. Retrieve intercepted data — use the LAST captured response (most specific filter)
    const requests = await page.getInterceptedRequests();
    if (!requests || requests.length === 0) {
      throw new EmptyResultError('band mentions', 'No notification data captured. Try running the command again.');
    }

    const lastReq = requests[requests.length - 1] as any;
    let items: any[] = Array.isArray(lastReq?.result_data?.news) ? lastReq.result_data.news : [];

    if (items.length === 0) {
      throw new EmptyResultError('band mentions', 'No notifications found');
    }

    // 6. Client-side filters for non-mention modes
    if (filter === 'all' && unreadOnly) {
      items = items.filter((n: any) => n.is_new === true);
    } else if (filter === 'post') {
      items = items.filter((n: any) => n.category === 'post');
    } else if (filter === 'comment') {
      items = items.filter((n: any) => n.category === 'comment');
    }

    return items.slice(0, limit).map((n: any) => {
      const ts = n.created_at ? new Date(n.created_at) : null;
      const timeStr = ts
        ? ts.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
      const type = n.filters?.includes('referred') ? '@mention' : n.category ?? '';
      // Strip Band markup tags from text
      const rawText = (n.subtext ?? '').replace(/<band:[^>]+>/g, '').replace(/<\/band:[^>]+>/g, '');
      return {
        time: timeStr,
        band: n.band?.name ?? '',
        type,
        from: n.actor?.name ?? '',
        text: rawText.slice(0, 100),
        url: n.action?.pc ?? '',
      };
    });
  },
});
