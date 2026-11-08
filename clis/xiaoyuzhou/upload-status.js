/**
 * xiaoyuzhou upload-status — query the state of an episode on the Xiaoyuzhou
 * podcaster backend.
 *
 * Reads the episode through the podcaster API (GET /v1/episode/get) from inside
 * the browser session, so the signed-in podcaster cookie is used. The reported
 * status is normalised to one of:
 *
 *   draft      — created but never published (托管草稿)
 *   reviewing  — published and waiting for the Xiaoyuzhou review
 *   published  — live on the platform
 *   rejected   — the review rejected it
 *   removed    — deleted by the podcaster
 *
 * Usage:
 *   opencli xiaoyuzhou upload-status 6aee5c665b7c4709bfe2436e
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const SITE = 'xiaoyuzhou';
const PODCASTER_HOST = 'podcaster.xiaoyuzhoufm.com';
const PODCASTER_ORIGIN = `https://${PODCASTER_HOST}`;
const PODCASTER_API = 'https://podcaster-api.xiaoyuzhoufm.com';
const PUBLIC_ORIGIN = 'https://www.xiaoyuzhoufm.com';
// 节目 id 不内置默认值:由 --podcast 或环境变量 YT2PODCAST_PODCAST_ID 提供。
const DEFAULT_PODCAST_ID = process.env.YT2PODCAST_PODCAST_ID || '';

const EID_RE = /^[0-9a-f]{24}$/i;

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

export function buildEpisodeUrl(eid) {
    return `${PUBLIC_ORIGIN}/episode/${eid}`;
}

/** The podcaster API answers 401 with this shape when the session is gone. */
export function isAuthFailure(payload) {
    if (!payload || typeof payload !== 'object') {
        return false;
    }
    const code = Number(payload.code);
    return code === 401 || code === 403;
}

/** Map the raw episode status onto the draft / reviewing / published states. */
export function normalizeEpisodeStatus(episode) {
    const status = String(episode?.status || '').toUpperCase();
    const review = String(episode?.reviewStatus || '').toUpperCase();
    const neverPublished = episode?.hasNeverPublished === true || episode?.hasNeverPublished === 'true';
    if (status === 'REMOVED' || status === 'DELETED') {
        return 'removed';
    }
    if (status === 'NORMAL' && !neverPublished) {
        if (review === 'PENDING') {
            return 'reviewing';
        }
        if (review === 'REJECTED') {
            return 'rejected';
        }
        return 'published';
    }
    if (review === 'REJECTED') {
        return 'rejected';
    }
    return 'draft';
}

async function apiFetch(page, endpoint, { method = 'GET', body, podcastId } = {}) {
    const script = `(async () => {
      try {
        const token = (document.cookie.match(/x-jike-access-token=([^;]+)/) || [])[1] || '';
        const headers = {
          'Content-Type': 'application/json',
          'x-jike-allow-app-token-in-cookie': 'true',
        };
        if (token) headers['x-jike-access-token'] = token;
        ${podcastId ? `headers['x-pid'] = ${JSON.stringify(podcastId)};` : ''}
        const response = await fetch(${JSON.stringify(PODCASTER_API + endpoint)}, {
          method: ${JSON.stringify(method)},
          headers,
          credentials: 'include',
          body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))},
        });
        const text = await response.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (error) { parsed = { __raw: text.slice(0, 400) }; }
        return { ok: response.ok, httpStatus: response.status, body: parsed };
      } catch (error) {
        return { ok: false, httpStatus: 0, body: null, error: String((error && error.message) || error) };
      }
    })()`;
    const raw = unwrapEvaluateResult(await page.evaluate(script));
    if (!raw || typeof raw !== 'object') {
        throw new CommandExecutionError('Xiaoyuzhou API call returned no result');
    }
    if (raw.error) {
        throw new CommandExecutionError(`Xiaoyuzhou API call failed: ${raw.error}`);
    }
    const payload = raw.body;
    if (raw.httpStatus === 401 || raw.httpStatus === 403 || isAuthFailure(payload)) {
        throw new AuthRequiredError(
            PODCASTER_HOST,
            `Xiaoyuzhou podcaster session is not valid (HTTP ${raw.httpStatus})`,
            `Open https://${PODCASTER_HOST}/ in Chrome, sign in to the podcaster backend, then retry.`,
        );
    }
    if (!raw.ok) {
        throw new CommandExecutionError(
            `Xiaoyuzhou API ${endpoint} failed with HTTP ${raw.httpStatus}`
            + (payload?.msg ? `: ${payload.msg}` : ''),
        );
    }
    return payload?.data ?? payload;
}

cli({
    site: SITE,
    name: 'upload-status',
    access: 'read',
    description: 'Show the status (draft / reviewing / published) of a Xiaoyuzhou episode',
    domain: PODCASTER_HOST,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'episode_id', positional: true, required: true, help: 'Episode id (eid)' },
        { name: 'podcast', default: DEFAULT_PODCAST_ID, help: 'Podcast id (required; or set YT2PODCAST_PODCAST_ID)' },
    ],
    columns: ['episode_id', 'title', 'status', 'review_status', 'duration_seconds', 'published', 'episode_url'],
    func: async (page, args) => {
        const eid = String(args.episode_id || '').trim();
        if (!eid) {
            throw new ArgumentError('<episode_id> is required');
        }
        if (!EID_RE.test(eid)) {
            throw new ArgumentError(`Episode id must be a 24 character hex string (got "${eid}")`);
        }
        const podcastId = String(args.podcast || DEFAULT_PODCAST_ID).trim();
        if (!podcastId) {
            throw new ArgumentError('Missing podcast id: pass --podcast <id> or set YT2PODCAST_PODCAST_ID');
        }

        await page.goto(`${PODCASTER_ORIGIN}/podcast`);
        await page.wait(2);

        const episode = await apiFetch(page, `/v1/episode/get?eid=${eid}`, { podcastId });
        if (!episode || typeof episode !== 'object') {
            throw new CommandExecutionError(`Xiaoyuzhou returned no episode for eid ${eid}`);
        }
        const status = normalizeEpisodeStatus(episode);
        return [{
            episode_id: String(episode.eid || eid),
            title: String(episode.title || ''),
            status,
            review_status: String(episode.reviewStatus || ''),
            duration_seconds: Number.isFinite(episode.duration) ? episode.duration : null,
            published: status === 'published' || status === 'reviewing',
            episode_url: buildEpisodeUrl(String(episode.eid || eid)),
        }];
    },
});
