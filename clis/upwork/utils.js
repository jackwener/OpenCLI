/**
 * Upwork adapter utilities.
 *
 * Upwork is a Nuxt (Vue) SSR app behind Cloudflare. Every adapter runs
 * through the user's logged-in browser session (Strategy.COOKIE,
 * browser: true) because bare fetches hit a `__cf_bm` challenge and
 * because most surfaces only render data for an authenticated user.
 *
 * The list pages (search, best-matches feed) ship their full result
 * payload inside `window.__NUXT__.state` — we read straight from that
 * global instead of DOM-scraping rendered cards. Job detail uses the
 * Vuex store (`window.$nuxt.$store.state.jobDetails.*`). All helpers
 * below are pure (arg validation, decoders, URL builders, row mappers)
 * so they stay unit-testable without a browser.
 */

import {
    ArgumentError,
    CommandExecutionError,
} from '@jackwener/opencli/errors';

export const UPWORK_ORIGIN = 'https://www.upwork.com';

const CIPHERTEXT_PATTERN = /^~0[12]\d{15,21}$/;

const FEED_TABS = {
    'best-matches': { path: '/nx/find-work/best-matches', state: 'feedBestMatch' },
    'most-recent': { path: '/nx/find-work/most-recent', state: 'feedMostRecent' },
};

const SORT_VALUES = new Set(['recency', 'relevance', 'client_total_charge', 'client_total_reviews']);

export function unwrapBrowserResult(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'session' in value && 'data' in value) {
        return value.data;
    }
    return value;
}

export function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function coerceInt(value) {
    if (value === undefined || value === null || value === '') return NaN;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && Number.isInteger(n) ? n : NaN;
}

export function requireQuery(value, label = 'query') {
    const q = String(value ?? '').trim();
    if (!q) throw new ArgumentError(`upwork ${label} cannot be empty`);
    return q;
}

export function requirePositiveInt(value, defaultValue, label) {
    const raw = value ?? defaultValue;
    const n = coerceInt(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`upwork ${label} must be a positive integer`);
    }
    return n;
}

export function requireBoundedInt(value, defaultValue, min, max, label) {
    const n = requirePositiveInt(value, defaultValue, label);
    if (n < min) throw new ArgumentError(`upwork ${label} must be >= ${min}`);
    if (n > max) throw new ArgumentError(`upwork ${label} must be <= ${max}`);
    return n;
}

/**
 * Upwork job ids are the ciphertext form starting with `~01` or `~02`
 * (the encoded uid surfaced everywhere in URLs and search results).
 * Accepts a bare ciphertext or a full `/jobs/~02…` URL.
 */
export function requireCiphertext(value) {
    let id = String(value ?? '').trim();
    if (!id) throw new ArgumentError('upwork job id is required');
    const urlMatch = id.match(/~0[12]\d+/);
    if (urlMatch) id = urlMatch[0];
    if (!CIPHERTEXT_PATTERN.test(id)) {
        throw new ArgumentError(`upwork job id "${value}" is not a valid ciphertext (expected ~01… or ~02… followed by digits)`);
    }
    return id;
}

export function requireFeedTab(value, defaultValue = 'best-matches') {
    const v = String(value ?? defaultValue).trim().toLowerCase();
    if (!FEED_TABS[v]) {
        throw new ArgumentError(`upwork tab must be one of ${Object.keys(FEED_TABS).join(' / ')}, got "${value}"`);
    }
    return v;
}

export function requireSort(value, defaultValue = 'recency') {
    const v = String(value ?? defaultValue).trim().toLowerCase();
    if (!SORT_VALUES.has(v)) {
        throw new ArgumentError(`upwork sort must be one of ${Array.from(SORT_VALUES).join(' / ')}, got "${value}"`);
    }
    return v;
}

/**
 * Build the Upwork search URL. Only forwards filters the user actually
 * supplied so the URL stays canonical and round-trippable.
 */
export function buildSearchUrl({ query, location, category, sort, page, perPage }) {
    const params = new URLSearchParams();
    params.set('q', query);
    if (location) params.set('location', location);
    if (category) params.set('category2_uid', category);
    if (sort && sort !== 'recency') params.set('sort', sort);
    if (perPage && perPage !== 10) params.set('per_page', String(perPage));
    if (page && page > 1) params.set('page', String(page));
    return `${UPWORK_ORIGIN}/nx/search/jobs/?${params.toString()}`;
}

export function buildFeedUrl(tab) {
    const t = FEED_TABS[tab];
    if (!t) throw new ArgumentError(`unknown feed tab "${tab}"`);
    return `${UPWORK_ORIGIN}${t.path}`;
}

export function feedStateKey(tab) {
    const t = FEED_TABS[tab];
    if (!t) throw new ArgumentError(`unknown feed tab "${tab}"`);
    return t.state;
}

export function buildJobUrl(ciphertext) {
    return `${UPWORK_ORIGIN}/jobs/${ciphertext}`;
}

export function isValidCiphertext(value) {
    return CIPHERTEXT_PATTERN.test(String(value ?? '').trim());
}

/**
 * Strip Upwork's `<span class="highlight">…</span>` markup that wraps
 * matched query terms in search results, then collapse whitespace.
 * Empty / null returns ''.
 */
export function stripHighlight(text) {
    if (text == null) return '';
    return String(text)
        .replace(/<span class="highlight">/g, '')
        .replace(/<\/span>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Decode `tierText` codes into stable lowercase labels.
 *   - search rows use the i18n-keyed form: `jsn_Entry_205` / `_Intermediate_206` / `_Expert_207`
 *   - feed rows already pass through the rendered label: `Entry level` / `Intermediate` / `Expert`
 *   - detail uses a numeric `contractorTier`: 1 / 2 / 3
 * Returns 'entry' | 'intermediate' | 'expert' | '' (unknown).
 */
export function decodeExperienceLevel(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number') {
        if (value === 1) return 'entry';
        if (value === 2) return 'intermediate';
        if (value === 3) return 'expert';
        return '';
    }
    const v = String(value).toLowerCase();
    if (v.includes('entry')) return 'entry';
    if (v.includes('intermediate')) return 'intermediate';
    if (v.includes('expert')) return 'expert';
    return '';
}

/**
 * Decode the `engagement` workload code. Search rows ship it as
 * `usnuxt_Engagement_421.fullTime` / `.partTime`; detail surfaces it
 * pre-rendered as `More than 30 hrs/week`. Returns 'full-time' /
 * 'part-time' / '' or passes the rendered string through.
 */
export function decodeWorkload(value) {
    if (value == null || value === '') return '';
    const v = String(value);
    const suffix = v.includes('.') ? v.split('.').pop() : v;
    const lower = suffix.toLowerCase();
    if (lower === 'fulltime' || lower.includes('full')) return 'full-time';
    if (lower === 'parttime' || lower.includes('part')) return 'part-time';
    if (lower.includes('hrs/week') || lower.includes('hours')) return suffix.trim();
    return '';
}

/**
 * Decode `proposalsTier` to a compact bucket label. Search ships it as
 * `usnuxt_JobProposalTier_418.lessThan5` etc; feed ships it pre-rendered
 * as `15 to 20` / `5 to 10`. Returns the bucket like '<5' / '5-10' /
 * '20-50' / '50+', or '' if unrecognized.
 */
export function decodeProposalsTier(value) {
    if (value == null || value === '') return '';
    const v = String(value);
    const suffix = v.includes('.') ? v.split('.').pop() : v;
    const s = suffix.trim();
    if (/^lessThan(\d+)$/i.test(s)) return `<${s.match(/\d+/)[0]}`;
    if (/^(\d+)plus$/i.test(s)) return `${s.match(/\d+/)[0]}+`;
    const range = s.match(/^(\d+)\s*(?:to|-|–)\s*(\d+)$/i);
    if (range) return `${range[1]}-${range[2]}`;
    return s;
}

/**
 * Format the budget into a single human-readable column.
 *   - hourly (type 2):  "$40-$70/hr"  or "$30/hr"  or "" (no budget set)
 *   - fixed  (type 1):  "$200"  or "" (no amount)
 * Used by search/feed; detail uses formatBudgetFromDetail (different shape).
 */
export function formatBudget(job) {
    const type = job?.type;
    const min = Number(job?.hourlyBudget?.min) || 0;
    const max = Number(job?.hourlyBudget?.max) || 0;
    const amount = Number(job?.amount?.amount) || 0;
    if (type === 2) {
        if (min > 0 && max > 0 && max !== min) return `$${min}-$${max}/hr`;
        if (max > 0) return `$${max}/hr`;
        if (min > 0) return `$${min}/hr`;
        return '';
    }
    if (type === 1) return amount > 0 ? `$${amount}` : '';
    return '';
}

/** Detail page uses `extendedBudgetInfo.{hourlyBudgetMin,Max}` + `budget.amount`. */
export function formatBudgetFromDetail(job) {
    const type = job?.type;
    const min = Number(job?.extendedBudgetInfo?.hourlyBudgetMin) || 0;
    const max = Number(job?.extendedBudgetInfo?.hourlyBudgetMax) || 0;
    const amount = Number(job?.budget?.amount) || 0;
    if (type === 2) {
        if (min > 0 && max > 0 && max !== min) return `$${min}-$${max}/hr`;
        if (max > 0) return `$${max}/hr`;
        if (min > 0) return `$${min}/hr`;
        return '';
    }
    if (type === 1) return amount > 0 ? `$${amount}` : '';
    return '';
}

export function jobType(type) {
    if (type === 1) return 'fixed';
    if (type === 2) return 'hourly';
    return '';
}

/**
 * Join skills/attrs into a comma-separated string. Search rows have
 * `attrs[].prettyName`; feed rows additionally have `skills[].prefLabel`;
 * detail has neither (skills live elsewhere). The function picks
 * whichever array is populated and dedupes.
 */
export function formatSkills(job) {
    const candidates = [];
    const arrs = [job?.attrs, job?.skills, job?.ontologySkills];
    for (const arr of arrs) {
        if (!Array.isArray(arr)) continue;
        for (const s of arr) {
            const name = (s?.prettyName ?? s?.prefLabel ?? s?.name ?? '').trim();
            if (name && !candidates.includes(name)) candidates.push(name);
        }
    }
    return candidates.join(', ');
}

/**
 * Normalize a search/feed job entry into the shared LIST_COLUMNS row shape.
 * Returns null when the row lacks a round-trippable ciphertext identity.
 */
export function jobToListRow(job, rank) {
    const id = String(job?.ciphertext ?? '').trim();
    if (!isValidCiphertext(id)) return null;
    const client = job?.client || {};
    const country = client?.location?.country || '';
    const rating = Number(client?.totalFeedback);
    return {
        rank,
        id,
        title: stripHighlight(job?.title),
        type: jobType(job?.type),
        budget: formatBudget(job),
        experienceLevel: decodeExperienceLevel(job?.tierText ?? job?.tier),
        proposalsTier: decodeProposalsTier(job?.proposalsTier),
        skills: formatSkills(job),
        clientCountry: country,
        clientRating: Number.isFinite(rating) && rating > 0 ? rating : null,
        publishedOn: job?.publishedOn || job?.createdOn || '',
        url: buildJobUrl(id),
    };
}

export function jobsToListRows(jobs, { offset = 0, limit } = {}) {
    const rows = [];
    const source = limit ? jobs.slice(0, limit) : jobs;
    for (const [index, job] of source.entries()) {
        const rank = offset + index + 1;
        const row = jobToListRow(job, rank);
        if (!row) {
            throw new CommandExecutionError(`Upwork result at rank ${rank} did not include a valid ciphertext id; cannot produce round-trippable detail rows.`);
        }
        rows.push(row);
    }
    return rows;
}

export const LIST_COLUMNS = [
    'rank', 'id', 'title', 'type', 'budget',
    'experienceLevel', 'proposalsTier', 'skills',
    'clientCountry', 'clientRating', 'publishedOn', 'url',
];

export const DETAIL_COLUMNS = [
    'id', 'title', 'type', 'budget', 'experienceLevel', 'workload',
    'category', 'skills', 'description',
    'clientCountry', 'clientSpent', 'clientHires', 'clientRating',
    'proposalsCount', 'publishedOn', 'url',
];
