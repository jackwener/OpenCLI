import { cli, Strategy } from '../../src/registry.js';
import { AuthRequiredError, CommandExecutionError } from '../../src/errors.js';

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const BOOKMARKS_QUERY_ID = 'Fy0QMy4q_aZCpkO0PnyLYw';

const FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

interface BookmarkTweet {
  id: string;
  author: string;
  name: string;
  text: string;
  likes: number;
  retweets: number;
  created_at: string;
  url: string;
}

function buildBookmarksUrl(count: number, cursor?: string | null): string {
  const vars: Record<string, any> = {
    count,
    includePromotedContent: false,
  };
  if (cursor) vars.cursor = cursor;

  return `/i/api/graphql/${BOOKMARKS_QUERY_ID}/Bookmarks`
    + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
    + `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
}

function extractBookmarkTweet(result: any, seen: Set<string>): BookmarkTweet | null {
  if (!result) return null;
  const tw = result.tweet || result;
  const legacy = tw.legacy || {};
  if (!tw.rest_id || seen.has(tw.rest_id)) return null;
  seen.add(tw.rest_id);

  const user = tw.core?.user_results?.result;
  const screenName = user?.legacy?.screen_name || user?.core?.screen_name || 'unknown';
  const displayName = user?.legacy?.name || user?.core?.name || '';
  const noteText = tw.note_tweet?.note_tweet_results?.result?.text;

  return {
    id: tw.rest_id,
    author: screenName,
    name: displayName,
    text: noteText || legacy.full_text || '',
    likes: legacy.favorite_count || 0,
    retweets: legacy.retweet_count || 0,
    created_at: legacy.created_at || '',
    url: `https://x.com/${screenName}/status/${tw.rest_id}`,
  };
}

function parseBookmarks(data: any, seen: Set<string>): { tweets: BookmarkTweet[]; nextCursor: string | null } {
  const tweets: BookmarkTweet[] = [];
  let nextCursor: string | null = null;

  const instructions =
    data?.data?.bookmark_timeline_v2?.timeline?.instructions
    || data?.data?.bookmark_timeline?.timeline?.instructions
    || [];

  for (const inst of instructions) {
    for (const entry of inst.entries || []) {
      const content = entry.content;

      if (content?.entryType === 'TimelineTimelineCursor' || content?.__typename === 'TimelineTimelineCursor') {
        if (content.cursorType === 'Bottom' || content.cursorType === 'ShowMore') nextCursor = content.value;
        continue;
      }
      if (entry.entryId?.startsWith('cursor-bottom-') || entry.entryId?.startsWith('cursor-showMore-')) {
        nextCursor = content?.value || content?.itemContent?.value || nextCursor;
        continue;
      }

      const direct = extractBookmarkTweet(content?.itemContent?.tweet_results?.result, seen);
      if (direct) {
        tweets.push(direct);
        continue;
      }

      for (const item of content?.items || []) {
        const nested = extractBookmarkTweet(item.item?.itemContent?.tweet_results?.result, seen);
        if (nested) tweets.push(nested);
      }
    }
  }

  return { tweets, nextCursor };
}

cli({
  site: 'twitter',
  name: 'bookmarks',
  description: 'Fetch Twitter/X bookmarks',
  domain: 'x.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['author', 'text', 'likes', 'url'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit || 20;

    await page.goto('https://x.com');
    await page.wait(3);

    const ct0 = await page.evaluate(`() => {
      return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))?.split('=')[1] || null;
    }`);
    if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

    const queryId = await page.evaluate(`async () => {
      try {
        const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
        if (ghResp.ok) {
          const data = await ghResp.json();
          const entry = data['Bookmarks'];
          if (entry && entry.queryId) return entry.queryId;
        }
      } catch {}
      try {
        const scripts = performance.getEntriesByType('resource')
          .filter(r => r.name.includes('client-web') && r.name.endsWith('.js'))
          .map(r => r.name);
        for (const scriptUrl of scripts.slice(0, 15)) {
          try {
            const text = await (await fetch(scriptUrl)).text();
            const re = /queryId:"([A-Za-z0-9_-]+)"[^}]{0,200}operationName:"Bookmarks"/;
            const m = text.match(re);
            if (m) return m[1];
          } catch {}
        }
      } catch {}
      return null;
    }`) || BOOKMARKS_QUERY_ID;

    const headers = JSON.stringify({
      'Authorization': `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
      'X-Csrf-Token': ct0,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
    });

    const allTweets: BookmarkTweet[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (let i = 0; i < 5 && allTweets.length < limit; i++) {
      const fetchCount = Math.min(100, limit - allTweets.length + 10);
      const apiUrl = buildBookmarksUrl(fetchCount, cursor).replace(BOOKMARKS_QUERY_ID, queryId);

      const data = await page.evaluate(`async () => {
        const r = await fetch("${apiUrl}", { headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`);

      if (data?.error) {
        if (allTweets.length === 0) throw new CommandExecutionError(`HTTP ${data.error}: Failed to fetch bookmarks. queryId may have expired.`);
        break;
      }

      const { tweets, nextCursor } = parseBookmarks(data, seen);
      allTweets.push(...tweets);

      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    return allTweets.slice(0, limit);
  },
});
