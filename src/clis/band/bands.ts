import { AuthRequiredError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';

/**
 * band bands — List all Bands you belong to.
 *
 * Uses the INTERCEPT strategy to capture the get_band_list_with_filter
 * API response that Band.us automatically makes on the home page.
 */
cli({
  site: 'band',
  name: 'bands',
  description: 'List all Bands you belong to',
  domain: 'www.band.us',
  strategy: Strategy.INTERCEPT,
  browser: true,
  args: [],
  columns: ['band_no', 'name', 'members'],

  func: async (page, _kwargs) => {
    // 1. Navigate to home, verify login, extract a band_no from sidebar links
    await page.goto('https://www.band.us/');
    await page.wait(1);

    const isLoggedIn = await page.evaluate(`() => document.cookie.includes('band_session')`);
    if (!isLoggedIn) throw new AuthRequiredError('band.us', 'Not logged in to Band');

    // Extract any band_no visible in the sidebar — needed for SPA navigation trigger
    const bandNo = await page.evaluate(`() => {
      const link = Array.from(document.querySelectorAll('a[href*="/band/"]'))
        .map(a => a.getAttribute('href').match(/\\/band\\/(\\d+)/))
        .find(m => m);
      return link ? link[1] : null;
    }`);
    if (!bandNo) throw new EmptyResultError('band bands', 'No band links found on page. Are you logged in?');
    const bandNoStr = String(bandNo);

    // 2. Install interceptor BEFORE SPA navigation.
    //    Navigating to a band page triggers get_band_list_with_filter automatically.
    await page.installInterceptor('get_band_list_with_filter');

    await page.evaluate(`() => {
      window.history.pushState({}, '', '/band/${bandNoStr}/post');
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }`);
    await page.wait(4);

    const requests = await page.getInterceptedRequests();
    if (!requests || requests.length === 0) {
      throw new EmptyResultError('band bands', 'No band list data captured. Try again.');
    }

    let bands: any[] = [];
    for (const req of requests) {
      const data = req?.result_data;
      if (Array.isArray(data)) {
        bands.push(...data.map((d: any) => d.band).filter(Boolean));
      }
    }

    if (bands.length === 0) {
      throw new EmptyResultError('band bands', 'No bands found');
    }

    return bands.map((b: any) => ({
      band_no: b.band_no,
      name: b.name ?? '',
      members: b.member_count ?? 0,
    }));
  },
});
