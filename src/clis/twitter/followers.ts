import { AuthRequiredError, SelectorError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'twitter',
  name: 'followers',
  description: 'Get accounts following a Twitter/X user',
  domain: 'x.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  args: [
    { name: 'user', positional: true, type: 'string', required: false },
    { name: 'limit', type: 'int', default: 50 },
  ],
  columns: ['screen_name', 'name', 'bio', 'followers'],
  func: async (page, kwargs) => {
    let targetUser = kwargs.user;

    // If no user is specified, figure out the logged-in user's handle
    if (!targetUser) {
        await page.goto('https://x.com/home');
        await page.wait({ selector: '[data-testid="primaryColumn"]' });

        const href = await page.evaluate(`() => {
            const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
            return link ? link.getAttribute('href') : null;
        }`);

        if (!href) {
            throw new AuthRequiredError('x.com', 'Could not find logged-in user profile link. Are you logged in?');
        }
        targetUser = href.replace('/', '');
    }

    // 1. Navigate to profile page
    await page.goto(`https://x.com/${targetUser}`);
    await page.wait(3);

    // 2. Install interceptor BEFORE SPA navigation.
    //    goto() resets JS context, but SPA click preserves it.
    await page.installInterceptor('Followers');

    // 3. Click the followers link via SPA navigation (preserves interceptor).
    //    Twitter uses /verified_followers instead of /followers now.
    const safeUser = JSON.stringify(targetUser);
    const clicked = await page.evaluate(`() => {
        const target = ${safeUser};
        const selectors = [
            'a[href="/' + target + '/verified_followers"]',
            'a[href="/' + target + '/followers"]',
        ];
        for (const sel of selectors) {
            const link = document.querySelector(sel);
            if (link) { link.click(); return true; }
        }
        return false;
    }`);
    if (!clicked) {
        throw new SelectorError('Twitter followers link', 'Twitter may have changed the layout.');
    }
    await page.waitForCapture(5);

    // 4. Scroll to trigger pagination API calls
    await page.autoScroll({ times: Math.ceil(kwargs.limit / 20), delayMs: 2000 });

    // 5. Retrieve intercepted data
    const requests = await page.getInterceptedRequests();
    const requestList = Array.isArray(requests) ? requests : [];

    if (requestList.length === 0) {
       return [];
    }

    let results: any[] = [];
    for (const req of requestList) {
      try {
        // GraphQL response: { data: { user: { result: { timeline: ... } } } }
        let instructions = req.data?.user?.result?.timeline?.timeline?.instructions;
        if (!instructions) continue;

        let addEntries = instructions.find((i: any) => i.type === 'TimelineAddEntries');
        if (!addEntries) {
             addEntries = instructions.find((i: any) => i.entries && Array.isArray(i.entries));
        }

        if (!addEntries) continue;

        for (const entry of addEntries.entries) {
          if (!entry.entryId.startsWith('user-')) continue;

          const item = entry.content?.itemContent?.user_results?.result;
          if (!item || item.__typename !== 'User') continue;

          const core = item.core || {};
          const legacy = item.legacy || {};

          results.push({
            screen_name: core.screen_name || legacy.screen_name || 'unknown',
            name: core.name || legacy.name || 'unknown',
            bio: legacy.description || item.profile_bio?.description || '',
            followers: legacy.followers_count || legacy.normal_followers_count || 0
          });
        }
      } catch (e) {
        // ignore parsing errors for individual payloads
      }
    }

    // Deduplicate by screen_name
    const unique = new Map();
    results.forEach(r => unique.set(r.screen_name, r));
    const deduplicatedResults = Array.from(unique.values());

    return deduplicatedResults.slice(0, kwargs.limit);
  }
});
