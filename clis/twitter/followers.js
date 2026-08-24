import { ArgumentError, AuthRequiredError, EmptyResultError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { looksLikePrivateTwitterTimeline, normalizeTwitterGraphqlPayload, normalizeTwitterScreenName, unwrapBrowserResult } from './shared.js';

const MAX_PAGINATION_PAGES = 100;
const CAPTURE_TIMEOUT_SECONDS = 10;

function extractFollower(result) {
    if (!result || result.__typename !== 'User')
        return null;
    const core = result.core || {};
    const legacy = result.legacy || {};
    const screenName = core.screen_name || legacy.screen_name || '';
    if (!screenName) {
        throw new CommandExecutionError('Malformed Twitter follower: missing screen_name');
    }
    return {
        screen_name: screenName,
        name: core.name || legacy.name || '',
        bio: result.profile_bio?.description || legacy.description || '',
    };
}

function parseFollowers(value) {
    const data = normalizeTwitterGraphqlPayload(value);
    const users = [];
    let nextCursor = null;
    let bottomTerminated = false;
    const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions
        || data?.data?.user?.result?.timeline?.timeline?.instructions
        || [];
    for (const instruction of instructions) {
        if (instruction?.type === 'TimelineTerminateTimeline' && instruction.direction === 'Bottom') {
            bottomTerminated = true;
        }
        for (const entry of instruction.entries || []) {
            const content = entry.content;
            if (content?.entryType === 'TimelineTimelineCursor' || content?.__typename === 'TimelineTimelineCursor') {
                if (content.cursorType === 'Bottom' || content.cursorType === 'ShowMore')
                    nextCursor = content.value;
                continue;
            }
            if (entry.entryId?.startsWith('cursor-bottom-') || entry.entryId?.startsWith('cursor-showMore-')) {
                nextCursor = content?.value || content?.itemContent?.value || nextCursor;
                continue;
            }
            if (entry.entryId?.startsWith('user-')) {
                const user = extractFollower(content?.itemContent?.user_results?.result);
                if (user)
                    users.push(user);
            }
        }
    }
    return { data, users, nextCursor: bottomTerminated ? null : nextCursor, bottomTerminated };
}

function twitterGraphqlError(payload) {
    const errors = payload?.errors;
    if (!Array.isArray(errors) || errors.length === 0)
        return null;
    const first = errors[0] || {};
    const code = first.code === undefined ? '' : ` ${first.code}`;
    const message = typeof first.message === 'string' ? `: ${first.message}` : '';
    return `Twitter Followers GraphQL error${code}${message}`;
}

function normalizeScreenName(value) {
    return normalizeTwitterScreenName(value);
}

cli({
    site: 'twitter',
    name: 'followers',
    access: 'read',
    description: 'Get accounts following a Twitter/X user (defaults to the logged-in user when no user is given)',
    domain: 'x.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    args: [
        {
            name: 'user',
            positional: true,
            type: 'string',
            required: false,
            help: 'Twitter/X handle (with or without @). Omit to fetch followers of the currently logged-in account.',
        },
        { name: 'limit', type: 'int', default: 50, help: 'Maximum number of follower rows to return (default 50). Must be a positive integer.' },
    ],
    // Preserve the historical three-column contract even though the GraphQL
    // payload also contains per-user relationship counts. Use `twitter profile`
    // when a dedicated follower count is needed.
    columns: ['screen_name', 'name', 'bio'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit;
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('limit must be a positive integer');
        }

        const rawUser = String(kwargs.user ?? '').trim();
        let targetUser = normalizeScreenName(rawUser);
        if (rawUser && !targetUser) {
            throw new ArgumentError('twitter followers user must be a valid Twitter/X handle', 'Example: opencli twitter followers @elonmusk --limit 100');
        }
        await page.goto('https://x.com/home');
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((cookie) => cookie.name === 'ct0')?.value || null;
        if (!ct0) {
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        }

        if (!targetUser) {
            // Bridge wraps primitive page.evaluate returns as { session, data:<value> };
            // unwrap so the href string is usable downstream.
            const href = unwrapBrowserResult(await page.evaluate(`() => {
                const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
                return link ? link.getAttribute('href') : null;
            }`));
            if (!href || typeof href !== 'string') {
                throw new AuthRequiredError('x.com', 'Could not find logged-in user profile link. Are you logged in?');
            }
            targetUser = normalizeScreenName(href);
            if (!targetUser) {
                throw new AuthRequiredError('x.com', 'Could not find logged-in user profile link. Are you logged in?');
            }
        }
        if (!targetUser) {
            throw new ArgumentError('twitter followers user cannot be empty', 'Example: opencli twitter followers @elonmusk --limit 100');
        }

        await page.installInterceptor('/Followers?');
        const targetPath = `/${targetUser}/followers`;
        await page.evaluate(`() => {
            const targetPath = ${JSON.stringify(targetPath)};
            window.history.pushState({}, '', targetPath);
            window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
        }`);
        try {
            await page.waitForCapture(CAPTURE_TIMEOUT_SECONDS);
        }
        catch {
            throw new TimeoutError('twitter followers API capture', CAPTURE_TIMEOUT_SECONDS, 'No Followers response was observed after opening the followers list.');
        }
        const currentPath = unwrapBrowserResult(await page.evaluate('() => window.location.pathname'));
        if (typeof currentPath !== 'string' || !currentPath.toLowerCase().endsWith('/followers')) {
            throw new CommandExecutionError('SPA navigation to Twitter followers failed');
        }

        const allFollowers = [];
        const seen = new Set();
        let cursor = null;
        let lastRawResponse = null;
        let pages = 0;

        const consumeCaptured = async () => {
            const requests = await page.getInterceptedRequests();
            if (!Array.isArray(requests)) {
                throw new CommandExecutionError('Twitter followers interceptor returned malformed responses');
            }
            for (const request of requests) {
                const { data, users, nextCursor } = parseFollowers(request);
                const graphqlError = twitterGraphqlError(data);
                if (graphqlError)
                    throw new CommandExecutionError(graphqlError);
                lastRawResponse = data;
                for (const user of users) {
                    if (!seen.has(user.screen_name)) {
                        seen.add(user.screen_name);
                        allFollowers.push(user);
                    }
                }
                cursor = nextCursor;
            }
        };

        await consumeCaptured();
        while (allFollowers.length < limit && cursor && pages < MAX_PAGINATION_PAGES) {
            const beforeCount = allFollowers.length;
            const beforeCursor = cursor;
            await page.autoScroll({ times: 1, delayMs: 500 });
            try {
                await page.waitForCapture(CAPTURE_TIMEOUT_SECONDS);
            }
            catch {
                throw new TimeoutError('twitter followers pagination', CAPTURE_TIMEOUT_SECONDS, `Twitter returned a continuation cursor after ${allFollowers.length} rows, but the next Followers response was not observed.`);
            }
            await consumeCaptured();
            pages++;
            if (allFollowers.length === beforeCount && cursor === beforeCursor) {
                throw new CommandExecutionError('Twitter followers pagination repeated a cursor without returning new users');
            }
        }
        if (allFollowers.length < limit && cursor && pages >= MAX_PAGINATION_PAGES) {
            throw new CommandExecutionError(`Twitter followers pagination exceeded ${MAX_PAGINATION_PAGES} pages before cursor exhaustion`);
        }
        if (allFollowers.length === 0) {
            if (looksLikePrivateTwitterTimeline(lastRawResponse)) {
                throw new EmptyResultError('twitter followers', `No follower data returned for @${targetUser} (the target account may have set their followers list to private)`);
            }
            throw new EmptyResultError('twitter followers', `No followers found for @${targetUser}`);
        }
        return allFollowers.slice(0, limit);
    }
});

export const __test__ = {
    extractFollower,
    normalizeScreenName,
    parseFollowers,
    twitterGraphqlError,
};
