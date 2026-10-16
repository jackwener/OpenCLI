import { ArgumentError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { unwrapEvaluateResult } from './_shared/evaluate-result.js';
import { gotoInstagramHome } from './_shared/navigation.js';
const INSTAGRAM_GRAPHQL_PATH = '/graphql/query';
const INSTAGRAM_TIMELINE_FIELD = 'xdt_api__v1__feed__user_timeline_graphql_connection';
const INSTAGRAM_USERNAME_RE = /^(?=.*[A-Za-z0-9_])[A-Za-z0-9._]{1,30}$/;
const INSTAGRAM_MEDIA_ID_RE = /^\d+(_\d+)?$/;
const INSTAGRAM_CAPTURE_TIMEOUT_SECONDS = 15;
const INSTAGRAM_MAX_PAGINATION_PAGES = 5;
const INSTAGRAM_MEDIA_TYPES = new Map([[1, 'photo'], [2, 'video'], [8, 'carousel']]);
const INSTAGRAM_DRIFT_HINT = 'The response shape changed; the adapter needs updating.';
function requirePage(page) {
    if (!page)
        throw new CommandExecutionError('Browser session required for instagram user');
    return page;
}
function normalizeInstagramLimit(kwargs) {
    const limit = kwargs.limit;
    if (!Number.isInteger(limit) || limit < 1) {
        throw new ArgumentError(`Invalid limit: ${kwargs.limit}`, 'Expected a positive integer, for example: opencli instagram user natgeo --limit 5');
    }
    return limit;
}
function normalizeInstagramUsername(kwargs) {
    const username = String(kwargs.username ?? '').trim().replace(/^@/, '');
    if (!INSTAGRAM_USERNAME_RE.test(username)) {
        throw new ArgumentError(`Invalid Instagram username: ${kwargs.username}`, 'Expected letters, digits, periods or underscores, for example: opencli instagram user natgeo');
    }
    return username;
}
function buildRouteToProfileJs(username) {
    return `() => {
      const path = ${JSON.stringify(`/${username}/`)};
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }`;
}
function instagramGraphqlError(payload) {
    const errors = payload?.errors;
    if (!Array.isArray(errors) || errors.length === 0)
        return null;
    const message = typeof errors[0]?.message === 'string' ? `: ${errors[0].message}` : '';
    return `Instagram GraphQL error${message}`;
}
function isCaptureTimeout(error) {
    return /no network capture/i.test(String(error?.message ?? error));
}
function readMediaId(node, index) {
    const id = node.pk ?? node.id;
    if ((typeof id !== 'string' && typeof id !== 'number') || !INSTAGRAM_MEDIA_ID_RE.test(String(id))) {
        throw new CommandExecutionError(`Instagram timeline edge #${index + 1} carried no usable media id`, INSTAGRAM_DRIFT_HINT);
    }
    return String(id);
}
function mapTimelineNode(node, index) {
    const type = INSTAGRAM_MEDIA_TYPES.get(node.media_type);
    if (!type) {
        throw new CommandExecutionError(`Instagram post #${index + 1} returned unsupported media_type ${node.media_type}`, INSTAGRAM_DRIFT_HINT);
    }
    return {
        index: index + 1,
        caption: (node.caption?.text || '').replace(/\n/g, ' ').substring(0, 100),
        likes: node.like_count ?? 0,
        comments: node.comment_count ?? 0,
        type,
        date: node.taken_at ? new Date(node.taken_at * 1000).toLocaleDateString() : '',
    };
}
function appendTimelineNodes(nodes, seen, connection, username) {
    const edges = connection.edges;
    if (!Array.isArray(edges)) {
        throw new CommandExecutionError(`Instagram timeline response for ${username} had no edges array`, INSTAGRAM_DRIFT_HINT);
    }
    edges.forEach((edge, index) => {
        const node = edge?.node;
        if (!node || typeof node !== 'object') {
            throw new CommandExecutionError(`Instagram timeline edge #${index + 1} carried no media node`, INSTAGRAM_DRIFT_HINT);
        }
        const id = readMediaId(node, index);
        if (seen.has(id))
            return;
        seen.add(id);
        nodes.push(node);
    });
}
/** The pattern matches every GraphQL call, so one wait rarely yields the timeline. */
async function drainCapturesUntil(browserPage, consume, isDone, deadline) {
    while (!isDone() && Date.now() < deadline) {
        const seconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
        try {
            await browserPage.waitForCapture(seconds);
        }
        catch (error) {
            if (!isCaptureTimeout(error))
                throw error;
            return;
        }
        await consume();
    }
}
cli({
    site: 'instagram',
    name: 'user',
    access: 'read',
    description: 'Get recent posts from an Instagram user',
    domain: 'www.instagram.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    args: [
        { name: 'username', required: true, positional: true, help: 'Instagram username' },
        { name: 'limit', type: 'int', default: 12, help: 'Number of posts' },
    ],
    columns: ['index', 'caption', 'likes', 'comments', 'type', 'date'],
    func: async (page, kwargs) => {
        const browserPage = requirePage(page);
        const username = normalizeInstagramUsername(kwargs);
        const limit = normalizeInstagramLimit(kwargs);
        // Instagram retired /api/v1/feed/user/* and answers web_profile_info
        // with 429 (#2456). Reload forced: goto skips an already-parked tab.
        await gotoInstagramHome(browserPage, true);
        await browserPage.installInterceptor(INSTAGRAM_GRAPHQL_PATH);
        await browserPage.evaluate(buildRouteToProfileJs(username));
        const nodes = [];
        const seen = new Set();
        let pageInfo = null;
        let sawTimeline = false;
        let graphqlError = null;
        const consumeCaptured = async () => {
            const requests = await browserPage.getInterceptedRequests();
            if (!Array.isArray(requests)) {
                throw new CommandExecutionError('Instagram timeline interceptor returned malformed responses');
            }
            for (const request of requests) {
                const connection = request?.data?.[INSTAGRAM_TIMELINE_FIELD];
                if (!connection) {
                    // Unrelated queries match too: keep the cause, raise later.
                    graphqlError = graphqlError ?? instagramGraphqlError(request);
                    continue;
                }
                sawTimeline = true;
                appendTimelineNodes(nodes, seen, connection, username);
                pageInfo = connection.page_info ?? null;
            }
        };
        await drainCapturesUntil(browserPage, consumeCaptured, () => sawTimeline, Date.now() + INSTAGRAM_CAPTURE_TIMEOUT_SECONDS * 1000);
        // pushState sets the pathname synchronously; only a later read settles.
        const pathname = unwrapEvaluateResult(await browserPage.evaluate('() => window.location.pathname'));
        if (typeof pathname !== 'string' || pathname.toLowerCase() !== `/${username.toLowerCase()}/`) {
            throw new CommandExecutionError(`Could not route to /${username}/ (still on ${pathname})`, 'Instagram may have changed its routing; the adapter needs updating.');
        }
        if (!sawTimeline) {
            if (graphqlError) {
                throw new CommandExecutionError(graphqlError, 'Instagram rejected the timeline query; retry later or check the session.');
            }
            throw new CommandExecutionError(`Instagram returned no timeline response for ${username}`, 'The profile may be private or unavailable, or you may need to log in to Instagram.');
        }
        let pages = 0;
        while (nodes.length < limit && pageInfo?.has_next_page && pages < INSTAGRAM_MAX_PAGINATION_PAGES) {
            const before = nodes.length;
            await browserPage.autoScroll({ times: 1, delayMs: 500 });
            await drainCapturesUntil(browserPage, consumeCaptured, () => nodes.length > before || pageInfo?.has_next_page === false, Date.now() + INSTAGRAM_CAPTURE_TIMEOUT_SECONDS * 1000);
            pages += 1;
            if (nodes.length === before && pageInfo?.has_next_page !== false) {
                throw new TimeoutError('instagram user pagination', INSTAGRAM_CAPTURE_TIMEOUT_SECONDS, `Instagram reported more posts after ${nodes.length} rows, but the next timeline response was not observed.`);
            }
        }
        if (nodes.length < limit && pageInfo?.has_next_page && pages >= INSTAGRAM_MAX_PAGINATION_PAGES) {
            throw new CommandExecutionError(`Instagram timeline pagination exceeded ${INSTAGRAM_MAX_PAGINATION_PAGES} pages before reaching ${limit} posts`, 'Re-run with a smaller --limit.');
        }
        if (nodes.length === 0) {
            throw new EmptyResultError('instagram user', `${username} has no visible posts`);
        }
        return nodes.slice(0, limit).map(mapTimelineNode);
    },
});
