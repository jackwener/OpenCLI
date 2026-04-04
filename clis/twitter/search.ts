import { CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

/**
 * Trigger Twitter search SPA navigation with fallback strategies.
 *
 * Primary: pushState + popstate (works in most environments).
 * Fallback: Type into the search input and press Enter when pushState fails
 *   intermittently (e.g. due to Twitter A/B tests or timing races — see #690).
 *
 * Both strategies preserve the JS context so the fetch interceptor stays alive.
 */
async function navigateToSearch(page: Pick<IPage, 'evaluate' | 'wait'>, query: string, filter: string): Promise<void> {
  const searchUrl = JSON.stringify(`/search?q=${encodeURIComponent(query)}&f=${filter}`);
  let lastPath = '';

  // Strategy 1 (primary): pushState + popstate with retry
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.evaluate(`
      (() => {
        window.history.pushState({}, '', ${searchUrl});
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      })()
    `);

    try {
      await page.wait({ selector: '[data-testid="primaryColumn"]' });
    } catch {
      // selector timeout — fall through to path check or next attempt
    }

    lastPath = String(await page.evaluate('() => window.location.pathname') || '');
    if (lastPath.startsWith('/search')) {
      return;
    }

    if (attempt < 2) {
      await page.wait(1);
    }
  }

  // Strategy 2 (fallback): Use the search input on /explore.
  // The nativeSetter + Enter approach triggers Twitter's own form handler,
  // performing SPA navigation without a full page reload.
  const queryStr = JSON.stringify(query);
  const navResult = await page.evaluate(`(async () => {
    try {
      const input = document.querySelector('[data-testid="SearchBox_Search_Input"]');
      if (!input) return { ok: false };

      input.focus();
      await new Promise(r => setTimeout(r, 300));

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      if (!nativeSetter) return { ok: false };
      nativeSetter.call(input, ${queryStr});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));

      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));

      return { ok: true };
    } catch {
      return { ok: false };
    }
  })()`);

  if (navResult?.ok) {
    try {
      await page.wait({ selector: '[data-testid="primaryColumn"]' });
    } catch {
      // fall through to path check
    }
    lastPath = String(await page.evaluate('() => window.location.pathname') || '');
    if (lastPath.startsWith('/search')) {
      if (filter === 'live') {
        await page.evaluate(`(() => {
          const tabs = document.querySelectorAll('[role="tab"]');
          for (const tab of tabs) {
            if (tab.textContent.includes('Latest') || tab.textContent.includes('最新')) {
              tab.click();
              return;
            }
          }
        })()`);
        await page.wait(2);
      }
      return;
    }
  }

  throw new CommandExecutionError(
    `SPA navigation to /search failed. Final path: ${lastPath || '(empty)'}. Twitter may have changed its routing.`,
  );
}

cli({
  site: 'twitter',
  name: 'search',
  description: 'Search Twitter/X for tweets',
  domain: 'x.com',
  strategy: Strategy.INTERCEPT, // Use intercept strategy
  browser: true,
  args: [
    { name: 'query', type: 'string', required: true, positional: true },
    { name: 'filter', type: 'string', default: 'top', choices: ['top', 'live'] },
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['id', 'author', 'text', 'created_at', 'likes', 'views', 'url'],
  func: async (page, kwargs) => {
    const query = kwargs.query;
    const filter = kwargs.filter === 'live' ? 'live' : 'top';

    // 1. Navigate to x.com/explore (has a search input at the top)
    await page.goto('https://x.com/explore');
    await page.wait(3);

    // 2. Install interceptor BEFORE triggering search.
    //    SPA navigation preserves the JS context, so the monkey-patched
    //    fetch will capture the SearchTimeline API call.
    await page.installInterceptor('SearchTimeline');

    // 3. Trigger SPA navigation to search results via history API.
    //    pushState + popstate triggers React Router's listener without
    //    a full page reload, so the interceptor stays alive.
    //    Note: the previous approach (nativeSetter + Enter keydown on the
    //    search input) does not reliably trigger Twitter's form submission.
    await navigateToSearch(page, query, filter);

    // 4. Scroll to trigger additional pagination
    await page.autoScroll({ times: 3, delayMs: 2000 });

    // 6. Retrieve captured data
    const requests = await page.getInterceptedRequests();
    if (!requests || requests.length === 0) return [];

    let results: any[] = [];
    const seen = new Set<string>();
    for (const req of requests) {
      try {
        const insts = req?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
        const addEntries = insts.find((i: any) => i.type === 'TimelineAddEntries')
          || insts.find((i: any) => i.entries && Array.isArray(i.entries));
        if (!addEntries?.entries) continue;

        for (const entry of addEntries.entries) {
          if (!entry.entryId.startsWith('tweet-')) continue;
          
          let tweet = entry.content?.itemContent?.tweet_results?.result;
          if (!tweet) continue;

          // Handle retweet wrapping
          if (tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
              tweet = tweet.tweet;
          }
          if (!tweet.rest_id || seen.has(tweet.rest_id)) continue;
          seen.add(tweet.rest_id);

          // Twitter moved screen_name from legacy to core
          const tweetUser = tweet.core?.user_results?.result;

          results.push({
            id: tweet.rest_id,
            author: tweetUser?.core?.screen_name || tweetUser?.legacy?.screen_name || 'unknown',
            text: tweet.note_tweet?.note_tweet_results?.result?.text || tweet.legacy?.full_text || '',
            created_at: tweet.legacy?.created_at || '',
            likes: tweet.legacy?.favorite_count || 0,
            views: tweet.views?.count || '0',
            url: `https://x.com/i/status/${tweet.rest_id}`
          });
        }
      } catch (e) {
        // ignore parsing errors for individual payloads
      }
    }

    return results.slice(0, kwargs.limit);
  }
});
