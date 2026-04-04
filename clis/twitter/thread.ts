import { cli, Strategy } from '../../src/registry.js';
import { AuthRequiredError, CommandExecutionError } from '../../src/errors.js';

// ── Twitter GraphQL constants ──────────────────────────────────────────

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const TWEET_DETAIL_QUERY_ID = 'nBS-WpgA6ZG0CyNHD517JQ';

const FEATURES = {
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
};

const FIELD_TOGGLES = { withArticleRichContentState: true, withArticlePlainText: false };

// ── Pure functions (type-safe, testable) ───────────────────────────────

interface ThreadTweet {
  id: string;
  author: string;
  text: string;
  likes: number;
  retweets: number;
  in_reply_to?: string;
  created_at?: string;
  url: string;
}

function buildTweetDetailUrl(tweetId: string, cursor?: string | null): string {
  const vars: Record<string, any> = {
    focalTweetId: tweetId,
    referrer: 'tweet',
    with_rux_injections: false,
    includePromotedContent: false,
    rankingMode: 'Recency',
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
  };
  if (cursor) vars.cursor = cursor;

  return `/i/api/graphql/${TWEET_DETAIL_QUERY_ID}/TweetDetail`
    + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
    + `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`
    + `&fieldToggles=${encodeURIComponent(JSON.stringify(FIELD_TOGGLES))}`;
}

function extractTweet(r: any, seen: Set<string>): ThreadTweet | null {
  if (!r) return null;
  const tw = r.tweet || r;
  const l = tw.legacy || {};
  if (!tw.rest_id || seen.has(tw.rest_id)) return null;
  seen.add(tw.rest_id);

  const u = tw.core?.user_results?.result;
  const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
  const screenName = u?.legacy?.screen_name || u?.core?.screen_name || 'unknown';

  return {
    id: tw.rest_id,
    author: screenName,
    text: noteText || l.full_text || '',
    likes: l.favorite_count || 0,
    retweets: l.retweet_count || 0,
    in_reply_to: l.in_reply_to_status_id_str || undefined,
    created_at: l.created_at,
    url: `https://x.com/${screenName}/status/${tw.rest_id}`,
  };
}

function parseTweetDetail(data: any, seen: Set<string>): { tweets: ThreadTweet[]; nextCursor: string | null } {
  const tweets: ThreadTweet[] = [];
  let nextCursor: string | null = null;

  const instructions =
    data?.data?.threaded_conversation_with_injections_v2?.instructions
    || data?.data?.tweetResult?.result?.timeline?.instructions
    || [];

  for (const inst of instructions) {
    for (const entry of inst.entries || []) {
      // Cursor entries
      const c = entry.content;
      if (c?.entryType === 'TimelineTimelineCursor' || c?.__typename === 'TimelineTimelineCursor') {
        if (c.cursorType === 'Bottom' || c.cursorType === 'ShowMore') nextCursor = c.value;
        continue;
      }
      if (entry.entryId?.startsWith('cursor-bottom-') || entry.entryId?.startsWith('cursor-showMore-')) {
        nextCursor = c?.itemContent?.value || c?.value || nextCursor;
        continue;
      }

      // Direct tweet entry
      const tw = extractTweet(c?.itemContent?.tweet_results?.result, seen);
      if (tw) tweets.push(tw);

      // Conversation module (nested replies)
      for (const item of c?.items || []) {
        const nested = extractTweet(item.item?.itemContent?.tweet_results?.result, seen);
        if (nested) tweets.push(nested);
      }
    }
  }

  return { tweets, nextCursor };
}

// ── CLI definition ────────────────────────────────────────────────────

cli({
  site: 'twitter',
  name: 'thread',
  description: 'Get a tweet thread (original + all replies)',
  domain: 'x.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'tweet-id', positional: true, type: 'string', required: true },
    { name: 'limit', type: 'int', default: 50 },
  ],
  columns: ['id', 'author', 'text', 'likes', 'retweets', 'url'],
  func: async (page, kwargs) => {
    let tweetId = kwargs['tweet-id'];
    const urlMatch = tweetId.match(/\/status\/(\d+)/);
    if (urlMatch) tweetId = urlMatch[1];

    // Navigate to x.com for cookie context
    await page.goto('https://x.com');
    await page.wait(3);

    // Extract CSRF token — the only thing we need from the browser
    const ct0 = await page.evaluate(`() => {
      return document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('ct0='))?.split('=')[1] || null;
    }`);
    if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

    // Build auth headers in TypeScript
    const headers = JSON.stringify({
      'Authorization': `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
      'X-Csrf-Token': ct0,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
    });

    // Paginate — fetch in browser, parse in TypeScript
    const allTweets: ThreadTweet[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (let i = 0; i < 5; i++) {
      const apiUrl = buildTweetDetailUrl(tweetId, cursor);

      // Browser-side: just fetch + return JSON (3 lines)
      const data = await page.evaluate(`async () => {
        const r = await fetch("${apiUrl}", { headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`);

      if (data?.error) {
        if (allTweets.length === 0) throw new CommandExecutionError(`HTTP ${data.error}: Tweet not found or queryId expired`);
        break;
      }

      // TypeScript-side: type-safe parsing + cursor extraction
      const { tweets, nextCursor } = parseTweetDetail(data, seen);
      allTweets.push(...tweets);

      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    return allTweets.slice(0, kwargs.limit);
  },
});
