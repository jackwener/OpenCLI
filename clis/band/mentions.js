import { AuthRequiredError, EmptyResultError, selectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
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
        const filter = kwargs.filter;
        const limit = kwargs.limit;
        const unreadOnly = kwargs.unread;
        // Navigate with a timestamp param to force a fresh page load each run.
        // Without this, same-URL navigation may skip the reload (preserving the JS context
        // and leaving the notification panel open from a previous run).
        await page.goto(`https://www.band.us/?_=${Date.now()}`);
        const cookies = await page.getCookies({ domain: 'band.us' });
        const isLoggedIn = cookies.some(c => c.name === 'band_session');
        if (!isLoggedIn)
            throw new AuthRequiredError('band.us', 'Not logged in to Band');
        // Install XHR interceptor before any clicks so all get_news responses are captured.
        await page.installInterceptor('get_news');
        // Wait for the bell button to appear (React hydration) instead of a fixed sleep.
        let bellReady = false;
        for (let i = 0; i < 20; i++) {
            const exists = await page.evaluate(`() => !!document.querySelector('button._btnWidgetIcon')`);
            if (exists) {
                bellReady = true;
                break;
            }
            await page.wait(0.5);
        }
        if (!bellReady) {
            throw selectorError('button._btnWidgetIcon', 'Notification bell not found. The Band.us UI may have changed.');
        }
        // Poll until a capture containing result_data.news arrives, up to maxSecs seconds.
        // getInterceptedRequests() clears the array on each call, so captures are accumulated
        // locally. The interceptor pattern 'get_news' also matches 'get_news_count' responses
        // which don't have result_data.news — keep polling until the real news response arrives.
        const waitForOneCapture = async (maxSecs = 8) => {
            const captures = [];
            for (let i = 0; i < maxSecs * 2; i++) {
                await page.wait(0.5); // 0.5 seconds per iteration (page.wait takes seconds)
                const reqs = await page.getInterceptedRequests();
                if (reqs.length > 0) {
                    captures.push(...reqs);
                    if (captures.some((r) => Array.isArray(r?.result_data?.news)))
                        return captures;
                }
            }
            return captures;
        };
        // Click the bell. Guard against the element disappearing between the readiness
        // check and the click (e.g. due to a React re-render) to surface a clear error.
        const bellClicked = await page.evaluate(`() => {
      const el = document.querySelector('button._btnWidgetIcon');
      if (!el) return false;
      el.click();
      return true;
    }`);
        if (!bellClicked) {
            throw selectorError('button._btnWidgetIcon', 'Notification bell disappeared before click. The Band.us UI may have changed.');
        }
        const requests = await waitForOneCapture();
        // Find the get_news response (has result_data.news); get_news_count responses do not.
        const newsReq = requests.find((r) => Array.isArray(r?.result_data?.news));
        if (!newsReq) {
            throw new EmptyResultError('band mentions', 'Failed to capture get_news response from Band.us. Try running the command again.');
        }
        let items = newsReq.result_data.news ?? [];
        if (items.length === 0) {
            throw new EmptyResultError('band mentions', 'No notifications found');
        }
        // Apply filters client-side from the full notification list.
        if (unreadOnly) {
            items = items.filter((n) => n.is_new === true);
        }
        if (filter === 'mentioned') {
            // 'filters' is Band's server-side tag array; 'referred' means you were @mentioned.
            items = items.filter((n) => n.filters?.includes('referred'));
        }
        else if (filter === 'post') {
            items = items.filter((n) => n.category === 'post');
        }
        else if (filter === 'comment') {
            items = items.filter((n) => n.category === 'comment');
        }
        // Band markup tags (<band:mention uid="...">, <band:sticker>, etc.) appear in
        // notification text; strip them to get plain readable content.
        const stripBandTags = (s) => s.replace(/<\/?band:[^>]+>/g, '');
        return items.slice(0, limit).map((n) => {
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
