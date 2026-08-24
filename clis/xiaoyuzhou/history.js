import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { loadXiaoyuzhouCredentials, requestXiaoyuzhouJson } from './auth.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 5000;
const DEFAULT_MAX_PAGES = 500;
const HARD_MAX_PAGES = 1000;
const HISTORY_ENDPOINT = '/v1/episode-played/list-history';
const PROGRESS_ENDPOINT = '/v1/playback-progress/list';
const XIAOYUZHOU_ID = /^[0-9a-f]{24}$/i;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value, label, maximum) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new ArgumentError(`--${label} must be an integer between 1 and ${maximum}`);
    }
    return parsed;
}

function requiredId(value, label) {
    if (typeof value !== 'string' || !XIAOYUZHOU_ID.test(value)) {
        throw new CommandExecutionError(`Xiaoyuzhou history returned an invalid ${label}`);
    }
    return value.toLowerCase();
}

function requiredString(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new CommandExecutionError(`Xiaoyuzhou history returned an invalid ${label}`);
    }
    return value.trim();
}

function optionalSeconds(value, label, { positive = false } = {}) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
        throw new CommandExecutionError(`Xiaoyuzhou history returned an invalid ${label}; expected seconds`);
    }
    return value;
}

function optionalIsoTime(value, label, { required = false } = {}) {
    if (value === null) {
        if (required) throw new CommandExecutionError(`Xiaoyuzhou history returned a missing ${label}`);
        return null;
    }
    if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) {
        throw new CommandExecutionError(`Xiaoyuzhou history returned an invalid ${label}`);
    }
    return new Date(value).toISOString();
}

function parseHistoryPage(response) {
    if (!isRecord(response) || !isRecord(response.raw) || response.raw.data !== response.data) {
        throw new CommandExecutionError('Xiaoyuzhou history returned an unexpected response shape');
    }
    const payload = response?.data;
    let entries;
    let next;
    if (Array.isArray(payload)) {
        entries = payload;
        next = response.raw?.loadMoreKey;
    }
    else if (isRecord(payload) && Array.isArray(payload.data)
        && !Object.prototype.hasOwnProperty.call(response.raw, 'loadMoreKey')) {
        entries = payload.data;
        next = payload.loadMoreKey;
    }
    else {
        throw new CommandExecutionError('Xiaoyuzhou history returned an unexpected response shape');
    }
    if (next == null || next === '') return { entries, next: null };
    if (typeof next !== 'string' || !next.trim()) {
        throw new CommandExecutionError('Xiaoyuzhou history returned an invalid loadMoreKey');
    }
    if (entries.length === 0) {
        throw new CommandExecutionError('Xiaoyuzhou history returned an empty page with a continuation cursor');
    }
    return { entries, next: next.trim() };
}

function parseHistoryEpisode(entry, rowNumber) {
    if (!isRecord(entry) || !isRecord(entry.episode)) {
        throw new CommandExecutionError(`Xiaoyuzhou history row ${rowNumber} is malformed; expected episode metadata`);
    }
    const episode = entry.episode;
    if (!isRecord(episode.podcast) || typeof episode.isFinished !== 'boolean') {
        throw new CommandExecutionError(`Xiaoyuzhou history row ${rowNumber} is missing podcast or finished state`);
    }
    return {
        eid: requiredId(episode.eid, `eid in row ${rowNumber}`),
        pid: requiredId(episode.pid, `pid in row ${rowNumber}`),
        title: requiredString(episode.title, `title in row ${rowNumber}`),
        podcast: requiredString(episode.podcast.title, `podcast title in row ${rowNumber}`),
        durationSec: optionalSeconds(episode.duration, `duration in row ${rowNumber}`, { positive: true }),
        pubDate: optionalIsoTime(episode.pubDate, `pubDate in row ${rowNumber}`, { required: true }),
        finished: episode.isFinished,
    };
}

function parseProgressRows(response, episodes) {
    if (!Array.isArray(response?.data)) {
        throw new CommandExecutionError('Xiaoyuzhou playback progress returned an unexpected response shape');
    }
    const requested = new Map(episodes.map((episode) => [episode.eid, episode]));
    const progressById = new Map();
    for (const [index, row] of response.data.entries()) {
        if (!isRecord(row)) {
            throw new CommandExecutionError(`Xiaoyuzhou playback progress row ${index + 1} is malformed`);
        }
        const eid = requiredId(row.eid, `progress eid in row ${index + 1}`);
        const episode = requested.get(eid);
        if (!episode) {
            throw new CommandExecutionError(`Xiaoyuzhou playback progress returned unrequested eid ${eid}`);
        }
        if (progressById.has(eid)) {
            throw new CommandExecutionError(`Xiaoyuzhou playback progress returned duplicate eid ${eid}`);
        }
        const pid = requiredId(row.pid, `progress pid in row ${index + 1}`);
        if (pid !== episode.pid) {
            throw new CommandExecutionError(`Xiaoyuzhou playback progress pid did not match history eid ${eid}`);
        }
        const progressSec = optionalSeconds(row.progress, `progress in row ${index + 1}`);
        if (progressSec !== null && episode.durationSec !== null && progressSec > episode.durationSec) {
            throw new CommandExecutionError(`Xiaoyuzhou playback progress exceeded duration for eid ${eid}`);
        }
        progressById.set(eid, {
            progressSec,
            playedAt: optionalIsoTime(row.playedAt, `playedAt in row ${index + 1}`),
        });
    }
    for (const episode of episodes) {
        if (!progressById.has(episode.eid)) {
            throw new CommandExecutionError(
                `Xiaoyuzhou playback progress omitted requested eid ${episode.eid}; the history join is incomplete`,
            );
        }
    }
    return progressById;
}

async function fetchHistory(args = {}) {
    const fetchAll = args.all ?? false;
    if (typeof fetchAll !== 'boolean') {
        throw new ArgumentError('--all must be a boolean');
    }
    const limit = fetchAll ? null : positiveInteger(args.limit ?? DEFAULT_LIMIT, 'limit', MAX_LIMIT);
    const maxPages = positiveInteger(args['max-pages'] ?? DEFAULT_MAX_PAGES, 'max-pages', HARD_MAX_PAGES);
    let credentials = loadXiaoyuzhouCredentials();
    const seenEpisodeIds = new Set();
    const seenCursors = new Set();
    const rows = [];
    let loadMoreKey = null;
    let exhausted = false;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
        const historyResponse = await requestXiaoyuzhouJson(HISTORY_ENDPOINT, {
            method: 'POST',
            body: loadMoreKey === null ? {} : { loadMoreKey },
            credentials,
        });
        credentials = historyResponse.credentials;
        const page = parseHistoryPage(historyResponse);
        const episodes = page.entries.map((entry, index) => parseHistoryEpisode(entry, index + 1));
        for (const episode of episodes) {
            if (seenEpisodeIds.has(episode.eid)) {
                throw new CommandExecutionError(
                    `Xiaoyuzhou history repeated eid ${episode.eid}; the pagination snapshot may have changed and event-vs-overlap semantics are ambiguous`,
                );
            }
            seenEpisodeIds.add(episode.eid);
        }

        const remaining = fetchAll ? episodes.length : limit - rows.length;
        const selected = episodes.slice(0, remaining);
        if (selected.length > 0) {
            const progressResponse = await requestXiaoyuzhouJson(PROGRESS_ENDPOINT, {
                method: 'POST',
                body: { eids: selected.map((episode) => episode.eid) },
                credentials,
            });
            credentials = progressResponse.credentials;
            const progressById = parseProgressRows(progressResponse, selected);
            for (const episode of selected) {
                const progress = progressById.get(episode.eid);
                rows.push({
                    rank: rows.length + 1,
                    eid: episode.eid,
                    pid: episode.pid,
                    title: episode.title,
                    podcast: episode.podcast,
                    durationSec: episode.durationSec,
                    progressSec: progress.progressSec,
                    progressPct: episode.durationSec !== null && progress.progressSec !== null
                        ? Number(((progress.progressSec / episode.durationSec) * 100).toFixed(1))
                        : null,
                    playedAt: progress.playedAt,
                    pubDate: episode.pubDate,
                    finished: episode.finished,
                    url: `https://www.xiaoyuzhoufm.com/episode/${episode.eid}`,
                });
            }
        }
        if (!fetchAll && rows.length >= limit) break;
        if (page.next === null) {
            exhausted = true;
            break;
        }
        if (page.next === loadMoreKey || seenCursors.has(page.next)) {
            throw new CommandExecutionError('Xiaoyuzhou history pagination repeated the same cursor');
        }
        if (pageNumber === maxPages) {
            throw new CommandExecutionError(
                `Xiaoyuzhou history stopped at the --max-pages safety limit (${maxPages}) before reaching the end`,
            );
        }
        seenCursors.add(page.next);
        loadMoreKey = page.next;
    }

    if (rows.length === 0) {
        throw new EmptyResultError('xiaoyuzhou history', 'The logged-in account has no playback history');
    }
    if (fetchAll && !exhausted) {
        throw new CommandExecutionError('Xiaoyuzhou history archive did not reach the end of pagination');
    }
    return rows;
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
    columns: ['rank', 'eid', 'pid', 'title', 'podcast', 'durationSec', 'progressSec', 'progressPct', 'playedAt', 'pubDate', 'finished', 'url'],
    func: fetchHistory,
});
