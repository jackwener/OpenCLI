import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { resolveTwitterQueryId } from './shared.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';
const TWEET_RESULT_BY_REST_ID_QUERY_ID = '7xflPyRiUxGVbJd4uWmbfg';
cli({
    site: 'twitter',
    name: 'article',
    access: 'read',
    description: 'Fetch a Twitter Article (long-form content) and export as Markdown',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    args: [
        { name: 'tweet-id', type: 'string', positional: true, required: true, help: 'Tweet ID or URL containing the article' },
    ],
    columns: ['title', 'author', 'content', 'url'],
    func: async (page, kwargs) => {
        // Extract tweet ID from URL if needed.
        // Article URLs (x.com/i/article/{articleId}) use a different ID than
        // tweet status URLs — the GraphQL endpoint needs the parent tweet ID.
        let tweetId = kwargs['tweet-id'];
        const isArticleUrl = /\/article\/\d+/.test(tweetId);
        const urlMatch = tweetId.match(/\/(?:status|article)\/(\d+)/);
        if (urlMatch)
            tweetId = urlMatch[1];
        if (isArticleUrl) {
            // Navigate to the article page and resolve the parent tweet ID from DOM
            await page.goto(`https://x.com/i/article/${tweetId}`);
            await page.wait(3);
            const resolvedId = await page.evaluate(`
        (function() {
          var links = document.querySelectorAll('a[href*="/status/"]');
          for (var i = 0; i < links.length; i++) {
            var m = links[i].href.match(/\\/status\\/(\\d+)/);
            if (m) return m[1];
          }
          var og = document.querySelector('meta[property="og:url"]');
          if (og && og.content) {
            var m2 = og.content.match(/\\/status\\/(\\d+)/);
            if (m2) return m2[1];
          }
          return null;
        })()
      `);
            if (!resolvedId || typeof resolvedId !== 'string') {
                throw new CommandExecutionError(`Could not resolve article ${tweetId} to a tweet ID. The article page may not contain a linked tweet.`);
            }
            tweetId = resolvedId;
        }
        // Navigate to the tweet page for cookie context
        await page.goto(`https://x.com/i/status/${tweetId}`);
        await page.wait(3);
        // Read CSRF token directly from the cookie store via CDP — zero page.evaluate round-trip
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        const queryId = await resolveTwitterQueryId(page, 'TweetResultByRestId', TWEET_RESULT_BY_REST_ID_QUERY_ID);
        const result = await page.evaluate(`
      async () => {
        const tweetId = "${tweetId}";
        const ct0 = ${JSON.stringify(ct0)};

        const bearer = ${JSON.stringify(TWITTER_BEARER_TOKEN)};
        const headers = {
          'Authorization': 'Bearer ' + decodeURIComponent(bearer),
          'X-Csrf-Token': ct0,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Twitter-Active-User': 'yes'
        };

        const variables = JSON.stringify({
          tweetId: tweetId,
          withCommunity: false,
          includePromotedContent: false,
          withVoice: false,
        });
        const features = JSON.stringify({
          longform_notetweets_consumption_enabled: true,
          responsive_web_twitter_article_tweet_consumption_enabled: true,
          longform_notetweets_rich_text_read_enabled: true,
          longform_notetweets_inline_media_enabled: true,
          articles_preview_enabled: true,
          responsive_web_graphql_exclude_directive_enabled: true,
          verified_phone_label_enabled: false,
        });
        const fieldToggles = JSON.stringify({
          withArticleRichContentState: true,
          withArticlePlainText: true,
        });

        const url = '/i/api/graphql/' + ${JSON.stringify(queryId)} + '/TweetResultByRestId?variables='
          + encodeURIComponent(variables)
          + '&features=' + encodeURIComponent(features)
          + '&fieldToggles=' + encodeURIComponent(fieldToggles);

        const resp = await fetch(url, {headers, credentials: 'include'});
        if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Tweet may not exist or queryId expired'};
        const d = await resp.json();

        const result = d.data?.tweetResult?.result;
        if (!result) return {error: 'Article not found'};

        // Unwrap TweetWithVisibilityResults
        const tw = result.tweet || result;
        const legacy = tw.legacy || {};
        const user = tw.core?.user_results?.result;
        const screenName = user?.legacy?.screen_name || user?.core?.screen_name || 'unknown';

        // Extract article content
        const articleResults = tw.article?.article_results?.result;
        if (!articleResults) {
          // Fallback: return note_tweet text if present
          const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
          if (noteText) {
            return [{
              title: '(Note Tweet)',
              author: screenName,
              content: noteText,
              url: 'https://x.com/' + screenName + '/status/' + tweetId,
            }];
          }
          return {error: 'Tweet ' + tweetId + ' has no article content'};
        }

        const title = articleResults.title || '(Untitled)';
        const contentState = articleResults.content_state || {};
        const blocks = contentState.blocks || [];

        // Convert draft.js blocks to Markdown
        const parts = [];
        let orderedCounter = 0;
        for (const block of blocks) {
          const blockType = block.type || 'unstyled';
          if (blockType === 'atomic') continue;
          const text = block.text || '';
          if (!text) continue;
          if (blockType !== 'ordered-list-item') orderedCounter = 0;

          if (blockType === 'header-one')           parts.push('# ' + text);
          else if (blockType === 'header-two')      parts.push('## ' + text);
          else if (blockType === 'header-three')    parts.push('### ' + text);
          else if (blockType === 'blockquote')       parts.push('> ' + text);
          else if (blockType === 'unordered-list-item') parts.push('- ' + text);
          else if (blockType === 'ordered-list-item') {
            orderedCounter++;
            parts.push(orderedCounter + '. ' + text);
          }
          else if (blockType === 'code-block')       parts.push('\`\`\`\\n' + text + '\\n\`\`\`');
          else                                       parts.push(text);
        }

        return [{
          title,
          author: screenName,
          content: parts.join('\\n\\n') || legacy.full_text || '',
          url: 'https://x.com/' + screenName + '/status/' + tweetId,
        }];
      }
    `);
        if (result?.error) {
            throw new CommandExecutionError(result.error + (result.hint ? ` (${result.hint})` : ''));
        }
        return result || [];
    }
});
