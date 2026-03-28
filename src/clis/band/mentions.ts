import { AuthRequiredError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';

/**
 * band mentions — Show Band notifications where you were @mentioned.
 *
 * Band.us signs every API request with a per-request HMAC (`md` header) generated
 * by its own JavaScript, so we cannot replicate it externally. Instead we use
 * Strategy.INTERCEPT: install an XHR interceptor, open the notification panel by
 * clicking the bell to trigger the get_news XHR call, then apply client-side
 * filtering to extract notifications matching the requested filter/unread options.
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
    const filter = kwargs.filter as string;
    const limit = kwargs.limit as number;
    const unreadOnly = kwargs.unread as boolean;

    // Navigate with a timestamp param to force a fresh page load each run.
    // Without this, same-URL navigation may skip the reload (preserving the JS context
    // and leaving the notification panel open from a previous run).
    await page.goto(`https://www.band.us/?_=${Date.now()}`);
    await page.wait(2);

    const isLoggedIn = await page.evaluate(`() => document.cookie.includes('band_session')`);
    if (!isLoggedIn) throw new AuthRequiredError('band.us', 'Not logged in to Band');

    // Install XHR interceptor before any clicks so all get_news responses are captured.
    await page.installInterceptor('get_news');

    // Poll until a capture containing result_data.news arrives, up to maxSecs seconds.
    // getInterceptedRequests() clears the array on each call, so captures are accumulated
    // locally. The interceptor pattern 'get_news' also matches 'get_news_count' responses
    // which don't have result_data.news — keep polling until the real news response arrives.
    const waitForOneCapture = async (maxSecs = 8): Promise<any[]> => {
      const captures: any[] = [];
      for (let i = 0; i < maxSecs * 2; i++) {
        await page.wait(0.5); // 0.5 seconds per iteration (page.wait takes seconds)
        const reqs = await page.getInterceptedRequests();
        if (reqs.length > 0) {
          captures.push(...reqs);
          if (captures.some((r: any) => Array.isArray(r?.result_data?.news))) return captures;
        }
      }
      return captures;
    };

    // Click the notification bell to open the panel. This triggers an initial get_news
    // call for all notification types. Use the CSS class directly — text-based matching
    // is locale-dependent and breaks when Band.us is set to a non-Japanese language.
    const bellFound = await page.evaluate(`() => {
      const bell = document.querySelector('button._btnWidgetIcon');
      if (bell) { bell.click(); return true; }
      return false;
    }`);
    if (!bellFound) {
      throw new EmptyResultError('band mentions', 'Notification bell not found (selector: button._btnWidgetIcon). The Band.us UI may have changed.');
    }

    const requests = await waitForOneCapture();

    if (requests.length === 0) {
      throw new EmptyResultError('band mentions', 'No notification data captured. Try running the command again.');
    }

    // Find the get_news response (has result_data.news); get_news_count responses do not.
    const newsReq = requests.find((r: any) => Array.isArray(r?.result_data?.news)) as any;
    let items: any[] = newsReq?.result_data?.news ?? [];

    if (items.length === 0) {
      throw new EmptyResultError('band mentions', 'No notifications found');
    }

    // Apply filters client-side from the full notification list.
    if (unreadOnly) {
      items = items.filter((n: any) => n.is_new === true);
    }
    if (filter === 'mentioned') {
      // 'filters' is Band's server-side tag array; 'referred' means you were @mentioned.
      items = items.filter((n: any) => n.filters?.includes('referred'));
    } else if (filter === 'post') {
      items = items.filter((n: any) => n.category === 'post');
    } else if (filter === 'comment') {
      items = items.filter((n: any) => n.category === 'comment');
    }

    // Band markup tags (<band:mention uid="...">, <band:sticker>, etc.) appear in
    // notification text; strip them to get plain readable content.
    const stripBandTags = (s: string) => s.replace(/<\/?band:[^>]+>/g, '');

    return items.slice(0, limit).map((n: any) => {
      const ts = n.created_at ? new Date(n.created_at) : null;
      return {
        time: ts
          ? ts.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '',
        band: n.band?.name ?? '',
        // 'filters' is Band's server-side tag array; 'referred' means you were @mentioned.
        type: n.filters?.includes('referred') ? '@mention' : n.category ?? '',
        from: n.actor?.name ?? '',
        text: stripBandTags(n.subtext ?? '').slice(0, 100),
        url: n.action?.pc ?? '',
      };
    });
  },
});
