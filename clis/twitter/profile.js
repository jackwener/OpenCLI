import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { resolveTwitterQueryId } from './shared.js';
const USER_BY_SCREEN_NAME_QUERY_ID = 'qRednkZG-rn1P6b48NINmQ';
cli({
    site: 'twitter',
    name: 'profile',
    description: 'Fetch a Twitter user profile (bio, stats, etc.)',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, help: 'Twitter screen name (without @). Defaults to logged-in user.' },
    ],
    columns: ['screen_name', 'name', 'bio', 'location', 'url', 'followers', 'following', 'tweets', 'likes', 'verified', 'created_at'],
    func: async (page, kwargs) => {
        let username = (kwargs.username || '').replace(/^@/, '');
        // If no username, detect the logged-in user
        if (!username) {
            await page.goto('https://x.com/home');
            await page.wait({ selector: '[data-testid="primaryColumn"]' });
            const href = await page.evaluate(`() => {
        const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        return link ? link.getAttribute('href') : null;
      }`);
            if (!href)
                throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
            username = href.replace('/', '');
        }
        // Navigate directly to the user's profile page (gives us cookie context)
        await page.goto(`https://x.com/${username}`);
        await page.wait(3);
        const queryId = await resolveTwitterQueryId(page, 'UserByScreenName', USER_BY_SCREEN_NAME_QUERY_ID);
        const result = await page.evaluate(`
      async () => {
        const screenName = "${username}";
        const ct0 = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('ct0='))?.split('=')[1];
        if (!ct0) return {error: 'No ct0 cookie — not logged into x.com'};

        const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
        const headers = {
          'Authorization': 'Bearer ' + decodeURIComponent(bearer),
          'X-Csrf-Token': ct0,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Twitter-Active-User': 'yes'
        };

        const variables = JSON.stringify({
          screen_name: screenName,
          withSafetyModeUserFields: true,
        });
        const features = JSON.stringify({
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

        const url = '/i/api/graphql/' + ${JSON.stringify(queryId)} + '/UserByScreenName?variables='
          + encodeURIComponent(variables)
          + '&features=' + encodeURIComponent(features);

        const resp = await fetch(url, {headers, credentials: 'include'});
        if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'User may not exist or queryId expired'};
        const d = await resp.json();

        const result = d.data?.user?.result;
        if (!result) return {error: 'User @' + screenName + ' not found'};

        const legacy = result.legacy || {};
        const expandedUrl = legacy.entities?.url?.urls?.[0]?.expanded_url || '';

        return [{
          screen_name: legacy.screen_name || screenName,
          name: legacy.name || '',
          bio: legacy.description || '',
          location: legacy.location || '',
          url: expandedUrl,
          followers: legacy.followers_count || 0,
          following: legacy.friends_count || 0,
          tweets: legacy.statuses_count || 0,
          likes: legacy.favourites_count || 0,
          verified: result.is_blue_verified || legacy.verified || false,
          created_at: legacy.created_at || '',
        }];
      }
    `);
        if (result?.error) {
            if (String(result.error).includes('No ct0 cookie'))
                throw new AuthRequiredError('x.com', result.error);
            throw new CommandExecutionError(result.error + (result.hint ? ` (${result.hint})` : ''));
        }
        return result || [];
    }
});
