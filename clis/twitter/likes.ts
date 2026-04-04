import { cli, Strategy } from '../../src/registry.js';
import { AuthRequiredError, CommandExecutionError } from '../../src/errors.js';
import { resolveTwitterQueryId, sanitizeQueryId } from './shared.js';

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const LIKES_QUERY_ID = 'RozQdCp4CilQzrcuU0NY5w';
const USER_BY_SCREEN_NAME_QUERY_ID = 'qRednkZG-rn1P6b48NINmQ';

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
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false
};

interface LikedTweet {
  id: string;
  author: string;
  name: string;
  text: string;
  likes: number;
  retweets: number;
  created_at: string;
  url: string;
}

function buildLikesUrl(queryId: string, userId: string, count: number, cursor?: string | null): string {
  const vars: Record<string, any> = {
    userId,
    count,
    includePromotedContent: false,
    withClientEventToken: false,
    withBirdwatchNotes: false,
    withVoice: true
  };
  if (cursor) vars.cursor = cursor;

  return `/i/api/graphql/${queryId}/Likes`
    + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
    + `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
}

function buildUserByScreenNameUrl(queryId: string, screenName: string): string {
  const vars = JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true });
  const feats = JSON.stringify({
    hidden_profile_subscriptions_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_tab_enabled: true,
    subscriptions_feature_can_gift_premium: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  });

  return `/i/api/graphql/${queryId}/UserByScreenName`
    + `?variables=${encodeURIComponent(vars)}`
    + `&features=${encodeURIComponent(feats)}`;
}

function extractLikedTweet(result: any, seen: Set<string>): LikedTweet | null {
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

function parseLikes(data: any, seen: Set<string>): { tweets: LikedTweet[]; nextCursor: string | null } {
  const tweets: LikedTweet[] = [];
  let nextCursor: string | null = null;

  const instructions =
    data?.data?.user?.result?.timeline_v2?.timeline?.instructions
    || data?.data?.user?.result?.timeline?.timeline?.instructions
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

      const direct = extractLikedTweet(content?.itemContent?.tweet_results?.result, seen);
      if (direct) {
        tweets.push(direct);
        continue;
      }

      for (const item of content?.items || []) {
        const nested = extractLikedTweet(item.item?.itemContent?.tweet_results?.result, seen);
        if (nested) tweets.push(nested);
      }
    }
  }

  return { tweets, nextCursor };
}

cli({
  site: 'twitter',
  name: 'likes',
  description: 'Fetch liked tweets of a Twitter user',
  domain: 'x.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'username', type: 'string', positional: true, help: 'Twitter screen name (without @). Defaults to logged-in user.' },
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['author', 'name', 'text', 'likes', 'url'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit || 20;
    let username = (kwargs.username || '').replace(/^@/, '');

    await page.goto('https://x.com');
    await page.wait(3);

    const ct0 = await page.evaluate(`() => {
      return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))?.split('=')[1] || null;
    }`);
    if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

    // If no username provided, detect the logged-in user
    if (!username) {
      const href = await page.evaluate(`() => {
        const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        return link ? link.getAttribute('href') : null;
      }`);
      if (!href) throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
      username = href.replace('/', '');
    }

    const likesQueryId = await resolveTwitterQueryId(page, 'Likes', LIKES_QUERY_ID);
    const userByScreenNameQueryId = await resolveTwitterQueryId(
      page,
      'UserByScreenName',
      USER_BY_SCREEN_NAME_QUERY_ID,
    );

    const headers = JSON.stringify({
      'Authorization': `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
      'X-Csrf-Token': ct0,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
    });

    // Get userId from screen_name
    const userId = await page.evaluate(`async () => {
      const screenName = ${JSON.stringify(username)};
      const url = ${JSON.stringify(buildUserByScreenNameUrl(userByScreenNameQueryId, username))};
      const resp = await fetch(url, { headers: ${headers}, credentials: 'include' });
      if (!resp.ok) return null;
      const d = await resp.json();
      return d.data?.user?.result?.rest_id || null;
    }`);

    if (!userId) {
      throw new CommandExecutionError(`Could not find user @${username}`);
    }

    const allTweets: LikedTweet[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (let i = 0; i < 5 && allTweets.length < limit; i++) {
      const fetchCount = Math.min(100, limit - allTweets.length + 10);
      const apiUrl = buildLikesUrl(likesQueryId, userId, fetchCount, cursor);

      const data = await page.evaluate(`async () => {
        const r = await fetch("${apiUrl}", { headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`);

      if (data?.error) {
        if (allTweets.length === 0) throw new CommandExecutionError(`HTTP ${data.error}: Failed to fetch likes. queryId may have expired.`);
        break;
      }

      const { tweets, nextCursor } = parseLikes(data, seen);
      allTweets.push(...tweets);

      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    return allTweets.slice(0, limit);
  },
});

export const __test__ = {
  sanitizeQueryId,
  buildLikesUrl,
  buildUserByScreenNameUrl,
  parseLikes,
};
