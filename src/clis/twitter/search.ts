import { cli, Strategy } from '../../registry.js';

cli({
  site: 'twitter',
  name: 'search',
  description: 'Search Twitter/X for tweets',
  domain: 'x.com',
  strategy: Strategy.INTERCEPT, // Use intercept strategy
  browser: true,
  args: [
    { name: 'query', type: 'string', required: true },
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['id', 'author', 'text', 'likes', 'views', 'url'],
  func: async (page, kwargs) => {
    // 1. Navigate directly to the search page
    const q = encodeURIComponent(kwargs.query);
    await page.goto(`https://x.com/search?q=${q}&f=top`);
    await page.wait(3);

    // 2. Install interceptor after page load (must be after goto, not before,
    //    because goto triggers a full navigation that resets the JS context).
    //    Note: this misses the initial SearchTimeline request fired during
    //    hydration; we rely on scroll-triggered pagination to capture data.
    await page.installInterceptor('SearchTimeline');

    // 3. Scroll to trigger SearchTimeline API calls (pagination)
    await page.autoScroll({ times: 3, delayMs: 2000 });
    
    // 4. Retrieve data
    const requests = await page.getInterceptedRequests();
    if (!requests || requests.length === 0) return [];

    let results: any[] = [];
    const seen = new Set<string>();
    for (const req of requests) {
      try {
        const insts = req.data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
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

          results.push({
            id: tweet.rest_id,
            author: tweet.core?.user_results?.result?.legacy?.screen_name || 'unknown',
            text: tweet.note_tweet?.note_tweet_results?.result?.text || tweet.legacy?.full_text || '',
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
