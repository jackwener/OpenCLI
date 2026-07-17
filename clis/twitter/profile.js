import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { describeTwitterApiError, normalizeTwitterScreenName, resolveTwitterQueryId, unwrapBrowserResult } from './shared.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';
const USER_BY_SCREEN_NAME_QUERY_ID = 'IGgvgiOx4QZndDHuD3x9TQ';

function isPlainObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value) {
    return typeof value === 'string' ? value : '';
}

export function mapTwitterProfileResult(result, screenName) {
    if (!isPlainObject(result)) {
        throw new CommandExecutionError(`Twitter profile response for @${screenName} is malformed`);
    }
    const hasLegacy = isPlainObject(result.legacy);
    const hasCore = isPlainObject(result.core);
    if (!hasLegacy && !hasCore) {
        throw new CommandExecutionError(`Twitter profile response for @${screenName} is missing profile fields`);
    }
    const legacy = hasLegacy ? result.legacy : {};
    const core = hasCore ? result.core : {};
    if (!stringField(core.screen_name) && !stringField(legacy.screen_name) && !stringField(core.name) && !stringField(legacy.name) && !stringField(core.created_at) && !stringField(legacy.created_at)) {
        throw new CommandExecutionError(`Twitter profile response for @${screenName} is missing profile identity fields`);
    }
    const location = isPlainObject(result.location) ? result.location : {};
    const expandedUrl = legacy.entities?.url?.urls?.[0]?.expanded_url || '';
    return [{
        screen_name: stringField(core.screen_name) || stringField(legacy.screen_name) || screenName,
        name: stringField(core.name) || stringField(legacy.name),
        bio: stringField(legacy.description),
        location: stringField(location.location) || stringField(legacy.location),
        url: stringField(expandedUrl),
        followers: legacy.followers_count || 0,
        following: legacy.friends_count || 0,
        tweets: legacy.statuses_count || 0,
        likes: legacy.favourites_count || 0,
        verified: Boolean(result.is_blue_verified || legacy.verified),
        created_at: stringField(core.created_at) || stringField(legacy.created_at),
    }];
}

cli({
    site: 'twitter',
    name: 'profile',
    access: 'read',
    description: 'Fetch a Twitter user profile — bio, stats, etc. (defaults to the logged-in user when no username is given)',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, help: 'Twitter screen name (with or without @). Defaults to the logged-in user when omitted.' },
    ],
    columns: ['screen_name', 'name', 'bio', 'location', 'url', 'followers', 'following', 'tweets', 'likes', 'verified', 'created_at'],
    func: async (page, kwargs) => {
        const rawUsername = String(kwargs.username ?? '').trim();
        let username = normalizeTwitterScreenName(rawUsername);
        if (rawUsername && !username) {
            throw new ArgumentError('twitter profile username must be a valid Twitter/X handle', 'Example: opencli twitter profile @jack');
        }
        // If no username, detect the logged-in user.
        // Bridge wraps primitive page.evaluate returns as { session, data:<value> };
        // unwrap so the href string is usable downstream.
        if (!username) {
            await page.goto('https://x.com/home');
            await page.wait({ selector: '[data-testid="primaryColumn"]' });
            const href = unwrapBrowserResult(await page.evaluate(`() => {
        const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        return link ? link.getAttribute('href') : null;
      }`));
            if (!href || typeof href !== 'string')
                throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
            username = normalizeTwitterScreenName(href);
            if (!username)
                throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
        }
        // Navigate directly to the user's profile page (gives us cookie context)
        await page.goto(`https://x.com/${username}`);
        await page.wait(3);
        // Read CSRF token directly from the cookie store via CDP — zero page.evaluate round-trip
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        const queryId = await resolveTwitterQueryId(page, 'UserByScreenName', USER_BY_SCREEN_NAME_QUERY_ID);
        const rawResult = unwrapBrowserResult(await page.evaluate(`
      async () => {
        const screenName = ${JSON.stringify(username)};
        const ct0 = ${JSON.stringify(ct0)};

        const bearer = ${JSON.stringify(TWITTER_BEARER_TOKEN)};
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

        let resp;
        try {
          resp = await fetch(url, {headers, credentials: 'include'});
        } catch (error) {
          return {ok: false, error: 'Twitter profile request failed: ' + String(error && error.message || error)};
        }
        if (!resp.ok) {
          return {
            ok: false,
            auth: resp.status === 401 || resp.status === 403,
            httpStatus: resp.status,
            error: 'HTTP ' + resp.status,
            hint: 'User may not exist, auth may be required, or queryId expired'
          };
        }
        let d;
        try {
          d = await resp.json();
        } catch (error) {
          return {ok: false, error: 'Twitter profile response was not JSON: ' + String(error && error.message || error)};
        }

        const result = d.data?.user?.result;
        if (!result) return {ok: false, notFound: true, error: 'User @' + screenName + ' not found'};
        return {ok: true, result};
      }
    `));
        if (!isPlainObject(rawResult)) {
            throw new CommandExecutionError('Twitter profile response payload is malformed');
        }
        if (!rawResult.ok) {
            // For HTTP errors, use fork's rich code mapping (429/401/403/404/5xx differentiation
            // from describeTwitterApiError); fall back to the plain message for non-HTTP failures
            // (fetch threw, JSON parse failed, payload malformed).
            const message = typeof rawResult.httpStatus === 'number'
                ? describeTwitterApiError('UserByScreenName', rawResult.httpStatus, rawResult.hint)
                : rawResult.error + (rawResult.hint ? ` (${rawResult.hint})` : '');
            if (rawResult.auth) {
                throw new AuthRequiredError('x.com', message);
            }
            if (rawResult.notFound) {
                throw new EmptyResultError('twitter profile', message);
            }
            throw new CommandExecutionError(message);
        }
        return mapTwitterProfileResult(rawResult.result, username);
    }
});

export const __test__ = { mapTwitterProfileResult };
