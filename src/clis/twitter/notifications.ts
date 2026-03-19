import { cli, Strategy } from '../../registry.js';

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
    // 1. Navigate directly to notifications
    await page.goto('https://x.com/notifications');
    await page.wait(3);

    // 2. Install interceptor after page load (must be after goto, not before,
    //    because goto triggers a full navigation that resets the JS context).
    //    Note: this misses the initial request fired during hydration;
    //    we rely on scroll-triggered pagination to capture data.
    await page.installInterceptor('NotificationsTimeline');

    // 3. Scroll to trigger API calls (load more notifications)
    await page.autoScroll({ times: 2, delayMs: 2000 });

    // 4. Retrieve data
    const requests = await page.getInterceptedRequests();
    if (!requests || requests.length === 0) return [];

    let results: any[] = [];
    const seen = new Set<string>();
    for (const req of requests) {
      try {
        let instructions: any[] = [];
        if (req.data?.data?.viewer?.timeline_response?.timeline?.instructions) {
             instructions = req.data.data.viewer.timeline_response.timeline.instructions;
        } else if (req.data?.data?.viewer_v2?.user_results?.result?.notification_timeline?.timeline?.instructions) {
             instructions = req.data.data.viewer_v2.user_results.result.notification_timeline.timeline.instructions;
        } else if (req.data?.data?.timeline?.instructions) {
             instructions = req.data.data.timeline.instructions;
        }

        let addEntries = instructions.find((i: any) => i.type === 'TimelineAddEntries');
        
        // Sometimes it's the first object without a 'type' field but has 'entries'
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
            
            // Twitter wraps standard notifications 
            let item = itemContent?.notification_results?.result || itemContent?.tweet_results?.result || itemContent;

            let actionText = 'Notification';
            let author = 'unknown';
            let text = '';
            let urlStr = '';
            
            if (item.__typename === 'TimelineNotification') {
                 // Greet likes, retweet, mentions
                 text = item.rich_message?.text || item.message?.text || '';
                 const fromUser = item.template?.from_users?.[0]?.user_results?.result;
                 author = fromUser?.legacy?.screen_name || fromUser?.core?.screen_name || 'unknown';
                 urlStr = item.notification_url?.url || '';
                 actionText = item.notification_icon || 'Activity';
                 
                 // If there's an attached tweet
                 const targetTweet = item.template?.target_objects?.[0]?.tweet_results?.result;
                 if (targetTweet) {
                    const targetText = targetTweet.note_tweet?.note_tweet_results?.result?.text || targetTweet.legacy?.full_text || '';
                    text += text && targetText ? ' | ' + targetText : targetText;
                    if (!urlStr) {
                         urlStr = `https://x.com/i/status/${targetTweet.rest_id}`;
                    }
                 }
            } else if (item.__typename === 'TweetNotification') {
                 // Direct mention/reply
                 const tweet = item.tweet_result?.result;
                 author = tweet?.core?.user_results?.result?.legacy?.screen_name || 'unknown';
                 text = tweet?.note_tweet?.note_tweet_results?.result?.text || tweet?.legacy?.full_text || item.message?.text || '';
                 actionText = 'Mention/Reply';
                 urlStr = `https://x.com/i/status/${tweet?.rest_id}`;
            } else if (item.__typename === 'Tweet') {
                 author = item.core?.user_results?.result?.legacy?.screen_name || 'unknown';
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
