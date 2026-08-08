import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { loadXiaoyuzhouCredentials, requestXiaoyuzhouJson } from './auth.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 5000;
const DEFAULT_MAX_PAGES = 500;
const HARD_MAX_PAGES = 1000;
const HISTORY_ENDPOINT = '/v1/episode-played/list-history';
const PROGRESS_ENDPOINT = '/v1/playback-progress/list';
const PROGRESS_BATCH_SIZE = 50;

function positiveInteger(value, label, maximum) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new ArgumentError(`${label} must be an integer between 1 and ${maximum}`);
    }
    return parsed;
}

function episodeFrom(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const episode = entry.episode ?? entry;
    return episode && typeof episode === 'object' ? episode : null;
}

function asNumber(value) {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function asString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function fetchHistory(args) {
    const fetchAll = Boolean(args.all);
    const limit = fetchAll
        ? Number.POSITIVE_INFINITY
        : positiveInteger(args.limit ?? DEFAULT_LIMIT, 'limit', MAX_LIMIT);
    const maxPages = positiveInteger(args['max-pages'] ?? DEFAULT_MAX_PAGES, 'max-pages', HARD_MAX_PAGES);
    const episodesById = new Map();
    const seenCursors = new Set();
    let credentials = loadXiaoyuzhouCredentials();
    let loadMoreKey = null;
    let exhausted = false;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
        const response = await requestXiaoyuzhouJson(HISTORY_ENDPOINT, {
            method: 'POST',
            body: loadMoreKey == null ? {} : { loadMoreKey },
            credentials,
        });
        credentials = response.credentials;
        const page = response.data;
        const entries = Array.isArray(page)
            ? page
            : (Array.isArray(page?.data) ? page.data : null);
        if (entries == null) {
            throw new CommandExecutionError('Xiaoyuzhou history returned an unexpected response shape');
        }
        for (const entry of entries) {
            const episode = episodeFrom(entry);
            if (episode?.eid && !episodesById.has(String(episode.eid))) {
                episodesById.set(String(episode.eid), episode);
            }
            if (!fetchAll && episodesById.size >= limit) break;
        }
        if (!fetchAll && episodesById.size >= limit) break;

        // The live API returns rows in `data` and the cursor beside them at
        // the response root. Keep the nested fallback for older payloads.
        const next = response.raw?.loadMoreKey
            ?? (page && !Array.isArray(page) ? page.loadMoreKey : null);
        if (entries.length === 0 || next == null || next === '') {
            exhausted = true;
            break;
        }
        const cursorKey = JSON.stringify(next);
        if (seenCursors.has(cursorKey)) {
            throw new CommandExecutionError('Xiaoyuzhou history pagination repeated the same cursor');
        }
        seenCursors.add(cursorKey);
        loadMoreKey = next;

        if (pageNumber === maxPages) {
            throw new CommandExecutionError(
                `Xiaoyuzhou history stopped at the --max-pages safety limit (${maxPages}) before reaching the end`,
                'Increase --max-pages and retry.',
            );
        }
    }

    const episodes = [...episodesById.values()];
    if (episodes.length === 0) {
        throw new EmptyResultError('xiaoyuzhou history', 'The logged-in account has no playback history');
    }
    if (fetchAll && !exhausted) {
        throw new CommandExecutionError('Xiaoyuzhou history archive did not reach the end of pagination');
    }

    const selected = fetchAll ? episodes : episodes.slice(0, limit);
    const progressById = new Map();
    for (let offset = 0; offset < selected.length; offset += PROGRESS_BATCH_SIZE) {
        const eids = selected.slice(offset, offset + PROGRESS_BATCH_SIZE).map((episode) => String(episode.eid));
        const response = await requestXiaoyuzhouJson(PROGRESS_ENDPOINT, {
            method: 'POST',
            body: { eids },
            credentials,
        });
        credentials = response.credentials;
        const progressRows = Array.isArray(response.data)
            ? response.data
            : (Array.isArray(response.data?.data) ? response.data.data : null);
        if (progressRows == null) {
            throw new CommandExecutionError('Xiaoyuzhou playback progress returned an unexpected response shape');
        }
        for (const progressRow of progressRows) {
            if (progressRow?.eid) progressById.set(String(progressRow.eid), progressRow);
        }
    }

    return selected.map((episode, index) => {
        const eid = String(episode.eid);
        const progress = progressById.get(eid);
        const durationSec = asNumber(episode.duration);
        const progressSec = asNumber(progress?.progress);
        return {
            rank: index + 1,
            eid,
            title: asString(episode.title),
            podcast: asString(episode.podcast?.title),
            durationSec,
            progressSec,
            progressPct: durationSec > 0 && progressSec != null
                ? Number(((progressSec / durationSec) * 100).toFixed(1))
                : null,
            playedAt: asString(progress?.playedAt),
            pubDate: asString(episode.pubDate),
            finished: typeof episode.isFinished === 'boolean' ? episode.isFinished : null,
            url: `https://www.xiaoyuzhoufm.com/episode/${encodeURIComponent(eid)}`,
        };
    });
}

cli({
    site: 'xiaoyuzhou',
    name: 'history',
    access: 'read',
    description: 'List playback history for the logged-in Xiaoyuzhou account',
    domain: 'api.xiaoyuzhoufm.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Maximum rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). Ignored with --all.` },
        { name: 'all', type: 'bool', default: false, help: 'Fetch every history page until the API cursor is exhausted.' },
        { name: 'max-pages', type: 'int', default: DEFAULT_MAX_PAGES, help: `Pagination safety limit (default ${DEFAULT_MAX_PAGES}, max ${HARD_MAX_PAGES}).` },
    ],
    columns: [
        'rank',
        'eid',
        'title',
        'podcast',
        'durationSec',
        'progressSec',
        'progressPct',
        'playedAt',
        'pubDate',
        'finished',
        'url',
    ],
    func: fetchHistory,
});

export const __test__ = {
    asNumber,
    episodeFrom,
    positiveInteger,
};
