import { AuthRequiredError, CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';
import { resolveTwitterQueryId } from './shared.js';

// ── Twitter GraphQL constants ──────────────────────────────────────────

const BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const HOME_TIMELINE_QUERY_ID = 'c-CzHF1LboFilMpsx4ZCrQ';
const HOME_LATEST_TIMELINE_QUERY_ID = 'BKB7oi212Fi7kQtCBGE4zA';

type TimelineType = 'for-you' | 'following';

interface TimelineEndpointConfig {
  endpoint: string;
  method: 'GET' | 'POST';
  fallbackQueryId: string;
}

// Endpoint config: for-you uses GET HomeTimeline, following uses POST HomeLatestTimeline
const TIMELINE_ENDPOINTS: Record<TimelineType, TimelineEndpointConfig> = {
  'for-you': { endpoint: 'HomeTimeline', method: 'GET', fallbackQueryId: HOME_TIMELINE_QUERY_ID },
  following: { endpoint: 'HomeLatestTimeline', method: 'POST', fallbackQueryId: HOME_LATEST_TIMELINE_QUERY_ID },
};

const FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: false,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

// ── Pure functions (type-safe, testable) ───────────────────────────────

interface TimelineTweet {
  id: string;
  author: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  created_at: string;
  url: string;
}

function buildTimelineVariables(type: TimelineType, count: number, cursor?: string | null): Record<string, unknown> {
  const vars: Record<string, unknown> = {
    count,
    includePromotedContent: false,
    latestControlAvailable: true,
    requestContext: 'launch',
  };
  if (type === 'for-you') vars.withCommunity = true;
  if (type === 'following') vars.seenTweetIds = [];
  if (cursor) vars.cursor = cursor;
  return vars;
}

function buildHomeTimelineUrl(queryId: string, endpoint: string, vars: Record<string, unknown>): string {

  return (
    `/i/api/graphql/${queryId}/${endpoint}` +
    `?variables=${encodeURIComponent(JSON.stringify(vars))}` +
    `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`
  );
}

function extractTweet(result: any, seen: Set<string>): TimelineTweet | null {
  if (!result) return null;
  const tw = result.tweet || result;
  const l = tw.legacy || {};
  if (!tw.rest_id || seen.has(tw.rest_id)) return null;
  seen.add(tw.rest_id);

  const u = tw.core?.user_results?.result;
  const screenName = u?.legacy?.screen_name || u?.core?.screen_name || 'unknown';
  const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
  const views = tw.views?.count ? parseInt(tw.views.count, 10) : 0;

  return {
    id: tw.rest_id,
    author: screenName,
    text: noteText || l.full_text || '',
    likes: l.favorite_count || 0,
    retweets: l.retweet_count || 0,
    replies: l.reply_count || 0,
    views,
    created_at: l.created_at || '',
    url: `https://x.com/${screenName}/status/${tw.rest_id}`,
  };
}

function parseHomeTimeline(data: any, seen: Set<string>): { tweets: TimelineTweet[]; nextCursor: string | null } {
  const tweets: TimelineTweet[] = [];
  let nextCursor: string | null = null;

  // Both HomeTimeline and HomeLatestTimeline share the same response envelope
  const instructions = data?.data?.home?.home_timeline_urt?.instructions || [];

  for (const inst of instructions) {
    for (const entry of inst.entries || []) {
      const c = entry.content;

      // Cursor entries
      if (c?.entryType === 'TimelineTimelineCursor' || c?.__typename === 'TimelineTimelineCursor') {
        if (c.cursorType === 'Bottom') nextCursor = c.value;
        continue;
      }
      if (entry.entryId?.startsWith('cursor-bottom-')) {
        nextCursor = c?.value || nextCursor;
        continue;
      }

      // Single tweet entry
      const tweetResult = c?.itemContent?.tweet_results?.result;
      if (tweetResult) {
        // Skip promoted content
        if (c?.itemContent?.promotedMetadata) continue;
        const tw = extractTweet(tweetResult, seen);
        if (tw) tweets.push(tw);
        continue;
      }

      // Conversation module (grouped tweets)
      for (const item of c?.items || []) {
        const nested = item.item?.itemContent?.tweet_results?.result;
        if (nested) {
          if (item.item?.itemContent?.promotedMetadata) continue;
          const tw = extractTweet(nested, seen);
          if (tw) tweets.push(tw);
        }
      }
    }
  }

  return { tweets, nextCursor };
}

// ── CLI definition ────────────────────────────────────────────────────

cli({
  site: 'twitter',
  name: 'timeline',
  description: 'Fetch Twitter timeline (for-you or following)',
  domain: 'x.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    {
      name: 'type',
      default: 'for-you',
      choices: ['for-you', 'following'],
      help: 'Timeline type: for-you (algorithmic) or following (chronological)',
    },
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['id', 'author', 'text', 'likes', 'retweets', 'replies', 'views', 'created_at', 'url'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit || 20;
    const timelineType: TimelineType = kwargs.type === 'following' ? 'following' : 'for-you';
    const { endpoint, method, fallbackQueryId } = TIMELINE_ENDPOINTS[timelineType];

    // Navigate to x.com for cookie context
    await page.goto('https://x.com');
    await page.wait(3);

    // Extract CSRF token
    const ct0 = await page.evaluate(`() => {
      return document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('ct0='))?.split('=')[1] || null;
    }`);
    if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

    // Dynamically resolve queryId for the selected endpoint
    const queryId = await resolveTwitterQueryId(page, endpoint, fallbackQueryId);

    // Build auth headers
    const headers = JSON.stringify({
      Authorization: `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
      'X-Csrf-Token': ct0,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
    });

    // Paginate — fetch in browser, parse in TypeScript
    const allTweets: TimelineTweet[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (let i = 0; i < 5 && allTweets.length < limit; i++) {
      const fetchCount = Math.min(40, limit - allTweets.length + 5); // over-fetch slightly for promoted filtering
      const variables = buildTimelineVariables(timelineType, fetchCount, cursor);
      const apiUrl = buildHomeTimelineUrl(queryId, endpoint, variables);

      const data = await page.evaluate(`async () => {
        const r = await fetch("${apiUrl}", { method: "${method}", headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`);

      if (data?.error) {
        if (allTweets.length === 0)
          throw new CommandExecutionError(`HTTP ${data.error}: Failed to fetch timeline. queryId may have expired.`);
        break;
      }

      const { tweets, nextCursor } = parseHomeTimeline(data, seen);
      allTweets.push(...tweets);

      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    return allTweets.slice(0, limit);
  },
});

export const __test__ = {
  buildTimelineVariables,
  buildHomeTimelineUrl,
  parseHomeTimeline,
};
