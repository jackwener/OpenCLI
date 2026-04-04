import { CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';

cli({
  site: 'twitter',
  name: 'notifications',
  description: 'Get Twitter/X notifications',
  domain: 'x.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['id', 'action', 'author', 'text', 'url'],
  func: async (page, kwargs) => {
    // 1. Navigate to home first (we need a loaded Twitter page for SPA navigation)
    await page.goto('https://x.com/home');
    await page.wait(3);

    // 2. Install interceptor BEFORE SPA navigation
    await page.installInterceptor('NotificationsTimeline');

    // 3. SPA navigate to notifications via history API
    await page.evaluate(`() => {
        window.history.pushState({}, '', '/notifications');
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }`);
    await page.waitForCapture(5);

    // Verify SPA navigation succeeded
    const currentUrl = await page.evaluate('() => window.location.pathname');
    if (currentUrl !== '/notifications') {
        throw new CommandExecutionError('SPA navigation to notifications failed. Twitter may have changed its routing.');
    }

    // 4. Scroll to trigger pagination
    await page.autoScroll({ times: 2, delayMs: 2000 });

    // 5. Retrieve data
    const requests = await page.getInterceptedRequests();
    if (!requests || requests.length === 0) return [];

    let results: any[] = [];
    const seen = new Set<string>();
    for (const req of requests) {
      try {
        // GraphQL response: { data: { viewer: ... } } (one level of .data)
        let instructions: any[] = [];
        if (req.data?.viewer?.timeline_response?.timeline?.instructions) {
             instructions = req.data.viewer.timeline_response.timeline.instructions;
        } else if (req.data?.viewer_v2?.user_results?.result?.notification_timeline?.timeline?.instructions) {
             instructions = req.data.viewer_v2.user_results.result.notification_timeline.timeline.instructions;
        } else if (req.data?.timeline?.instructions) {
             instructions = req.data.timeline.instructions;
        }

        let addEntries = instructions.find((i: any) => i.type === 'TimelineAddEntries');
        if (!addEntries) {
             addEntries = instructions.find((i: any) => i.entries && Array.isArray(i.entries));
        }
        if (!addEntries) continue;

        for (const entry of addEntries.entries) {
          if (!entry.entryId.startsWith('notification-')) {
             if (entry.content?.items) {
                 for (const subItem of entry.content.items) {
                     processNotificationItem(subItem.item?.itemContent, subItem.entryId);
                 }
             }
             continue;
          }

          processNotificationItem(entry.content?.itemContent, entry.entryId);
        }

        function processNotificationItem(itemContent: any, entryId: string) {
            if (!itemContent) return;

            let item = itemContent?.notification_results?.result || itemContent?.tweet_results?.result || itemContent;

            let actionText = 'Notification';
            let author = 'unknown';
            let text = '';
            let urlStr = '';

            if (item.__typename === 'TimelineNotification') {
                 text = item.rich_message?.text || item.message?.text || '';
                 const fromUser = item.template?.from_users?.[0]?.user_results?.result;
                 // Twitter moved screen_name from legacy to core
                 author = fromUser?.core?.screen_name || fromUser?.legacy?.screen_name || 'unknown';
                 urlStr = item.notification_url?.url || '';
                 actionText = item.notification_icon || 'Activity';

                 const targetTweet = item.template?.target_objects?.[0]?.tweet_results?.result;
                 if (targetTweet) {
                    const targetText = targetTweet.note_tweet?.note_tweet_results?.result?.text || targetTweet.legacy?.full_text || '';
                    text += text && targetText ? ' | ' + targetText : targetText;
                    if (!urlStr) {
                         urlStr = `https://x.com/i/status/${targetTweet.rest_id}`;
                    }
                 }
            } else if (item.__typename === 'TweetNotification') {
                 const tweet = item.tweet_result?.result;
                 const tweetUser = tweet?.core?.user_results?.result;
                 author = tweetUser?.core?.screen_name || tweetUser?.legacy?.screen_name || 'unknown';
                 text = tweet?.note_tweet?.note_tweet_results?.result?.text || tweet?.legacy?.full_text || item.message?.text || '';
                 actionText = 'Mention/Reply';
                 urlStr = `https://x.com/i/status/${tweet?.rest_id}`;
            } else if (item.__typename === 'Tweet') {
                 const tweetUser = item.core?.user_results?.result;
                 author = tweetUser?.core?.screen_name || tweetUser?.legacy?.screen_name || 'unknown';
                 text = item.note_tweet?.note_tweet_results?.result?.text || item.legacy?.full_text || '';
                 actionText = 'Mention';
                 urlStr = `https://x.com/i/status/${item.rest_id}`;
            }

            const id = item.id || item.rest_id || entryId;
            if (seen.has(id)) return;
            seen.add(id);

            results.push({
              id,
              action: actionText,
              author: author,
              text: text,
              url: urlStr || `https://x.com/notifications`
            });
        }
      } catch (e) {
        // ignore parsing errors for individual payloads
      }
    }

    return results.slice(0, kwargs.limit);
  }
});
