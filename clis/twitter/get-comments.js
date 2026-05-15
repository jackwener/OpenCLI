/**
 * Twitter get-comments — get replies to a tweet with reply-able IDs.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    TWITTER_BEARER_TOKEN,
    buildTweetDetailUrl,
    extractTweetId,
    parseTweetDetail,
} from './thread-utils.js';

function readLimit(raw) {
    const limit = Number(raw ?? 30);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ArgumentError('Argument "limit" must be an integer in [1, 100].');
    }
    return limit;
}

export function buildTwitterDomRepliesScript(tweetId, limit) {
    return `(async () => {
      const tweetId = ${JSON.stringify(tweetId)};
      const limit = ${limit};
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const clean = (value, max = 500) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, max);
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.9)));
        await wait(900);
      }
      const rows = [];
      const seen = new Set([tweetId]);
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"], [data-testid="cellInnerDiv"] article'));
      for (const article of articles) {
        const statusLinks = Array.from(article.querySelectorAll('a[href*="/status/"]'));
        const href = statusLinks.map(a => a.getAttribute('href') || '').find(value => /\\/status\\/\\d+/.test(value) && !value.includes('/analytics'));
        const match = href?.match(/\\/status\\/(\\d+)/);
        if (!match) continue;
        const id = match[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const authorHref = Array.from(article.querySelectorAll('a[href^="/"], a[href^="https://x.com/"]'))
          .map(a => a.getAttribute('href') || '')
          .find(value => !/\\/status\\//.test(value) && /^\\/?[A-Za-z0-9_]{1,15}(?:\\?|$|\\/)/.test(value.replace(/^https:\\/\\/x\\.com\\//, '')));
        const authorMatch = authorHref?.replace(/^https:\\/\\/x\\.com\\//, '').match(/^\\/?([A-Za-z0-9_]{1,15})/);
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const text = clean(textEl?.innerText || textEl?.textContent || '', 500);
        if (!text) continue;
        const time = article.querySelector('time')?.getAttribute('datetime') || '';
        const likeLabel = Array.from(article.querySelectorAll('[data-testid="like"], [aria-label]'))
          .map(el => el.getAttribute('aria-label') || '')
          .find(label => /like/i.test(label)) || '';
        const likesMatch = likeLabel.match(/([0-9,.]+)\\s+like/i);
        rows.push({
          rank: rows.length + 1,
          comment_id: id,
          author: authorMatch ? authorMatch[1] : '',
          text,
          likes: likesMatch ? likesMatch[1] : 0,
          time,
          url: 'https://x.com/i/status/' + id,
        });
        if (rows.length >= limit) break;
      }
      return rows;
    })()`;
}

export const command = cli({
    site: 'twitter',
    name: 'get-comments',
    access: 'read',
    description: 'Get replies to a tweet with reply-able IDs',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    args: [
        { name: 'tweet-id', positional: true, type: 'string', required: true, help: 'Tweet ID or URL' },
        { name: 'limit', type: 'int', default: 30, help: 'Max replies to return' },
    ],
    columns: ['rank', 'comment_id', 'author', 'text', 'likes', 'time', 'url'],
    func: async (page, kwargs) => {
        const tweetId = extractTweetId(kwargs['tweet-id']);
        const limit = readLimit(kwargs.limit);

        await page.goto(`https://x.com/i/status/${tweetId}`);
        await page.wait(3);

        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((cookie) => cookie.name === 'ct0')?.value || null;
        if (!ct0) {
            const domRows = await page.evaluate(buildTwitterDomRepliesScript(tweetId, limit));
            if (Array.isArray(domRows) && domRows.length > 0)
                return domRows;
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        }

        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });
        const allTweets = [];
        const seen = new Set();
        let cursor = null;

        try {
            for (let i = 0; i < 5; i++) {
                const apiUrl = new URL(buildTweetDetailUrl(tweetId, cursor), 'https://x.com').toString();
                const data = await page.evaluate(`async () => {
        const r = await fetch("${apiUrl}", { headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`);
                if (data?.error) {
                    if (allTweets.length === 0)
                        throw new CommandExecutionError(`HTTP ${data.error}: Tweet not found or queryId expired`);
                    break;
                }
                const { tweets, nextCursor } = parseTweetDetail(data, seen);
                allTweets.push(...tweets);
                if (!nextCursor || nextCursor === cursor)
                    break;
                cursor = nextCursor;
            }
        }
        catch (error) {
            const domRows = await page.evaluate(buildTwitterDomRepliesScript(tweetId, limit));
            if (Array.isArray(domRows) && domRows.length > 0)
                return domRows;
            throw error;
        }

        const replies = allTweets.filter((tweet) => tweet.in_reply_to === tweetId && tweet.id !== tweetId);
        if (replies.length === 0) {
            const domRows = await page.evaluate(buildTwitterDomRepliesScript(tweetId, limit));
            if (Array.isArray(domRows) && domRows.length > 0)
                return domRows;
            throw new EmptyResultError('twitter/get-comments', 'No replies found on this tweet');
        }

        return replies.slice(0, limit).map((tweet, i) => ({
            rank: i + 1,
            comment_id: tweet.id,
            author: tweet.author,
            text: String(tweet.text || '').substring(0, 500),
            likes: tweet.likes,
            time: tweet.created_at || '',
            url: tweet.url,
        }));
    },
});

export const __test__ = {
    buildTwitterDomRepliesScript,
};
