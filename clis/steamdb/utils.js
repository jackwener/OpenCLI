// steamdb shared helpers — used by rankings / rising / hot-tags / player-gainers.
//
// SteamDB is Cloudflare-fronted, so every command runs browser:true and reuses
// the real session. Three page-context primitives are exported as standalone
// functions so the SAME code runs in the live browser (injected via
// `${fn.toString()}`) and in JSDOM fixture tests (steamdb.test.js):
//   - extractRankingRows(): read the SSR ranking <table> on the current page.
//     Numeric cells carry raw values in td[data-sort]; columns are mapped by
//     header text so every SteamDB "data-sort table" (/charts/, /stats/*,
//     /upcoming/, wishlistactivity) flows through one path. NOT compatible with
//     /topsellers/ (weekly), which has no data-sort and needs its own parser.
//   - parseHoverFragment(html): parse the /api/RenderAppHover/ hover card
//     (tags / platforms / developer / microtrailer / screenshots / anti-cheat).
//   - reduceWeekSeries(values): reduce a GetGraphWeek hourly player series to a
//     momentum summary (avg last 24h vs avg first 24h).
//   - detectPageBlock(): classify a page that carries no ranking table, so a
//     throttle is never reported as an anti-bot challenge (see below).
//
// THREE DIFFERENT LIMITS sit in front of this site — keep them apart:
//   1. Cloudflare edge      -> solved by browser:true + the real session.
//   2. GetGraphWeek bursts  -> ~80 req/10s; handled in fetchPlayerMomentum.
//   3. SteamDB's OWN page limiter -> loading several pages back to back returns
//      a 200 page titled "Error · SteamDB" reading "Do not refresh this page so
//      much." It clears in ~2 minutes. detectPageBlock() names it exactly,
//      because calling it a "challenge or layout change" sends the caller
//      hunting an anti-bot problem that is not there.
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';

export const BASE = 'https://steamdb.info';
export const DOMAIN = 'steamdb.info';

// Every ranking/stats table ships ONE fixed page of rows (100 as of 2026-08-25)
// with no way to page past it, so a --limit/--scan above that silently returns
// fewer rows than asked. warnPageCap() says so on stderr instead of letting the
// caller read a short result as "that is all the data there is".
export const PAGE_ROW_CAP_HINT = 'SteamDB ships one fixed page of rows per table (~100) with no way to page past it.';

// Momentum sources shared by rising / hot-tags. `all/released/new-releases`
// read the mixed wishlist-mover table; `upcoming` reads the dedicated page.
export const RISING_SOURCES = {
    all: '/stats/wishlistactivity/',
    released: '/stats/wishlistactivity/',
    'new-releases': '/stats/wishlistactivity/',
    upcoming: '/upcoming/',
};

export function unwrapBrowser(value) {
    if (
        value && typeof value === 'object'
        && typeof value.session === 'string'
        && Object.prototype.hasOwnProperty.call(value, 'data')
    ) return value.data;
    return value;
}

// unix seconds -> YYYY-MM-DD (UTC), or null.
export function toDate(ts) {
    if (ts == null || !Number.isFinite(ts) || ts <= 0) return null;
    const d = new Date(ts * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// SteamDB sorts unrated apps with a -1 rating sentinel; that is "no score".
export function cleanRating(raw) {
    return raw != null && raw >= 0 ? raw : null;
}

// Page-context function (self-contained, no imports/closures): pick the table
// with the most /app/ links and read one raw row per game, mapping cells by
// header text. Runs against `document` — live page or JSDOM fixture alike.
export function extractRankingRows() {
    const tables = [...document.querySelectorAll('table')];
    let best = null;
    let bestN = 0;
    for (const t of tables) {
        const count = t.querySelectorAll('tbody tr td a[href*="/app/"]').length;
        if (count > bestN) { bestN = count; best = t; }
    }
    if (!best) return { rows: [] };

    const heads = [...best.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const idx = {};
    heads.forEach((h, i) => { if (!(h in idx)) idx[h] = i; });

    const rows = [];
    for (const tr of best.querySelectorAll('tbody tr')) {
        const namedLink = [...tr.querySelectorAll('a[href*="/app/"]')].find((a) => a.textContent.trim() !== '');
        const anyLink = namedLink || tr.querySelector('a[href*="/app/"]');
        const m = anyLink && anyLink.getAttribute('href').match(/\/app\/(\d+)/);
        if (!m) continue;
        const cells = [...tr.children];
        const ds = (headName) => {
            const i = idx[headName];
            if (i == null || !cells[i]) return null;
            const raw = cells[i].getAttribute('data-sort');
            if (raw == null || raw === '') return null;
            const num = Number(raw);
            return Number.isFinite(num) ? num : null;
        };
        const priceRaw = ds('Price');
        rows.push({
            appid: m[1],
            name: namedLink ? namedLink.textContent.trim() : null,
            currentPlayers: ds('Current') ?? ds('Online'),
            peak24h: ds('24h Peak'),
            peakAllTime: ds('All-Time Peak') ?? ds('Peak'),
            price: priceRaw == null ? null : priceRaw / 100,
            discountPct: ds('%'),
            rating: ds('Rating'),
            releaseTs: ds('Release'),
            follows: ds('Follows'),
            reviews: ds('Reviews'),
            gain7d: ds('7d Gain'),
        });
    }
    return { rows };
}

// Page-context function (self-contained, no imports/closures): classify a page
// that produced no ranking table. Returns null when the page looks normal — the
// caller then reports a genuine layout change. Order matters: SteamDB's own
// throttle page is checked FIRST so it is never mistaken for a Cloudflare
// interstitial. Uses innerText when available and falls back to textContent so
// the same function works under JSDOM in tests.
export function detectPageBlock() {
    const title = (document.title || '').trim();
    const body = document.body;
    const text = body ? (body.innerText || body.textContent || '') : '';
    if (/do not refresh this page so much/i.test(text)) {
        return { kind: 'rate-limit', title };
    }
    if (/just a moment|checking your browser|verify you are human|cf-browser-verification|enable javascript and cookies/i.test(text)) {
        return { kind: 'challenge', title };
    }
    if (/^error\b/i.test(title)) {
        return { kind: 'error-page', title };
    }
    return null;
}

// Page-context function (self-contained): parse one RenderAppHover HTML
// fragment. Needs a global DOMParser — the browser's, or JSDOM's in tests.
export function parseHoverFragment(html) {
    const stripEmoji = (s) => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tags = [...doc.querySelectorAll('.hover_tag')]
        .map((a) => stripEmoji(a.textContent.trim())).filter(Boolean);
    const platforms = [...doc.querySelectorAll('.hover_systems svg')]
        .map((s) => (s.getAttribute('class') || '').replace(/^octicon\s+octicon-/, ''))
        .filter((x) => x && x !== 'octicon');
    const devMeta = [...doc.querySelectorAll('.hover_meta')]
        .map((m) => m.textContent.trim()).find((t) => /^Developer:/i.test(t));
    const developer = devMeta ? devMeta.replace(/^Developer:\s*/i, '').trim() : null;
    let microtrailer = null;
    const mv = doc.querySelector('.hover_video');
    if (mv && mv.getAttribute('data-microtrailer')) {
        try {
            const j = JSON.parse(mv.getAttribute('data-microtrailer'));
            const mp4 = j && j.video && j.video['video/mp4'];
            if (mp4) microtrailer = `https://video.fastly.steamstatic.com/store_trailers/${mp4}?t=${j.time || ''}`;
        } catch { /* no trailer */ }
    }
    const ssEl = doc.querySelector('.js-open-screenshot-viewer');
    const screenshots = ssEl
        ? (ssEl.getAttribute('data-screenshots') || '').split(',').filter(Boolean).length : 0;
    const acMeta = [...doc.querySelectorAll('.hover_warning')]
        .map((m) => m.textContent.trim()).find((t) => /^Anti-Cheat:/i.test(t));
    const antiCheat = acMeta ? acMeta.replace(/^Anti-Cheat:\s*/i, '').trim() : null;
    return { tags, platforms, developer, microtrailer, screenshots, antiCheat };
}

// Page-context function (self-contained): reduce a GetGraphWeek hourly series
// to a momentum summary — avg of the last 24h vs the first 24h of the window.
// Returns null when there is too little history to compare.
export function reduceWeekSeries(values) {
    const vals = (Array.isArray(values) ? values : [])
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
    const n = vals.length;
    if (n < 6) return null;
    const w = Math.min(24, Math.floor(n / 2));
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
        playersNow: Math.round(avg(vals.slice(n - w))),
        players7dAgo: Math.round(avg(vals.slice(0, w))),
        peakWeek: Math.max(...vals),
        points: n,
    };
}

// Filter raw table rows to a momentum cohort for a phase, then sort hottest
// (largest 7d gain) first. Rows without a 7d-gain figure carry no signal.
export function buildCohort(rows, phase, { withinDays = 60, now }) {
    const isReleased = (r) => r.releaseTs != null && r.releaseTs <= now;
    const withGain = rows.filter((r) => r.gain7d != null);
    let cohort;
    if (phase === 'released') {
        cohort = withGain.filter(isReleased);
    } else if (phase === 'upcoming') {
        cohort = withGain.filter((r) => !isReleased(r));
    } else if (phase === 'new-releases') {
        const floor = now - withinDays * 86400;
        cohort = withGain.filter((r) => isReleased(r) && r.releaseTs >= floor);
    } else {
        cohort = withGain;
    }
    cohort.sort((a, b) => b.gain7d - a.gain7d);
    return cohort;
}

// Warn when the caller asked for more rows than the page can ever serve. Only
// fires on that specific silent cap (want > rows the page shipped), never on a
// cohort filter legitimately narrowing the result. `warn` is injectable so tests
// can assert the message without writing to stderr.
export function warnPageCap({ path, want, got, argName, warn = log.warn }) {
    if (!Number.isFinite(want) || !Number.isFinite(got) || want <= got) return false;
    const extra = path.startsWith('/charts/')
        ? ' Logged out, /charts/ is additionally filtered to games with 1K+ current players or 10K+ peak.'
        : '';
    warn(`steamdb: ${path} served ${got} rows, so --${argName} ${want} was capped at ${got}. ${PAGE_ROW_CAP_HINT}${extra}`);
    return true;
}

// Format the grouped detail object for a row (or null when not enriched).
export function formatDetail(d) {
    if (!d) return null;
    return {
        developer: d.developer,
        platforms: d.platforms.length ? d.platforms.join(',') : null,
        tags: d.tags.length ? d.tags.join(', ') : null,
        microtrailer: d.microtrailer,
        screenshots: d.screenshots,
        antiCheat: d.antiCheat,
    };
}

// Turn a detectPageBlock() verdict into a typed, correctly-named error. Kept
// out of extractTable so the wording lives in one place.
export function pageBlockError(block, url) {
    if (block.kind === 'rate-limit') {
        return new CommandExecutionError(
            `SteamDB is throttling this session — ${url} returned its "Do not refresh this page so much." error page`,
            "This is SteamDB's own page rate limiter, not a Cloudflare block and not a layout change. It clears in ~2 minutes; space steamdb commands ~30s apart.",
        );
    }
    if (block.kind === 'challenge') {
        return new CommandExecutionError(
            `Cloudflare challenge on ${url}`,
            'Open the page in the connected Chrome profile, clear the challenge once, then retry.',
        );
    }
    return new CommandExecutionError(
        `SteamDB returned an error page for ${url} (title: "${block.title}")`,
        'Retry in a minute. If it persists the page may have moved or been renamed.',
    );
}

// Navigate to a data-sort ranking page and return one raw row per game. Throws
// a named error when the page was throttled/challenged instead of handing the
// caller an empty array it would have to guess about.
export async function extractTable(page, path) {
    const url = `${BASE}${path}`;
    try {
        await page.goto(url, { waitUntil: 'load', settleMs: 600 });
    } catch (error) {
        throw new CommandExecutionError(`could not open ${url}: ${error?.message || error}`);
    }
    const script = `(() => {
        const extractRows = ${extractRankingRows.toString()};
        const detectBlock = ${detectPageBlock.toString()};
        const out = extractRows();
        const rows = out && Array.isArray(out.rows) ? out.rows : [];
        return { rows, block: rows.length ? null : detectBlock() };
    })()`;
    const parsed = unwrapBrowser(await page.evaluate(script));
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    if (!rows.length && parsed?.block) throw pageBlockError(parsed.block, url);
    return rows;
}

// Fetch + parse the hover card for a list of appids, concurrently, from page
// context (same-origin under Cloudflare). Returns { [appid]: parsed detail }.
// Apps that fail are simply absent — detail is best-effort enrichment.
export async function fetchDetails(page, appids) {
    if (!appids.length) return {};
    const script = `(async () => {
        const parseHover = ${parseHoverFragment.toString()};
        const ids = ${JSON.stringify(appids)};
        const out = {};
        const CONC = 8;
        const one = async (appid) => {
            try {
                const r = await fetch('/api/RenderAppHover/?appid=' + appid, { headers: { Accept: 'text/x-component' } });
                if (!r.ok) return;
                out[appid] = parseHover(await r.text());
            } catch { /* skip this app */ }
        };
        for (let i = 0; i < ids.length; i += CONC) {
            await Promise.all(ids.slice(i, i + CONC).map(one));
        }
        return out;
    })()`;
    const map = unwrapBrowser(await page.evaluate(script));
    return map && typeof map === 'object' ? map : {};
}

// Fetch GetGraphWeek for a list of appids and reduce each to a momentum
// summary. Returns { map, requested, ok, failed }: `failed` counts appids whose
// fetch failed even after one short retry — the caller uses it to tell a
// rate-limit (nearly all failed) apart from a genuine "no data" so a throttled
// burst is never reported as an empty result. Concurrency stays modest and the
// retry short: when the WHOLE batch is throttled the right move is to fail fast
// with a retryable error, not to spend minutes on backoff.
export async function fetchPlayerMomentum(page, appids) {
    if (!appids.length) return { map: {}, requested: 0, ok: 0, failed: 0 };
    const script = `(async () => {
        const reduceWeek = ${reduceWeekSeries.toString()};
        const ids = ${JSON.stringify(appids)};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = {};
        let failed = 0;
        const CONC = 6;
        const fetchOnce = async (appid) => {
            const r = await fetch('/api/GetGraphWeek/?appid=' + appid);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            return reduceWeek(j && j.data ? j.data.values : null);
        };
        const one = async (appid) => {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    const v = await fetchOnce(appid);
                    if (v) out[appid] = v;
                    return; // success (or genuinely short history) — done
                } catch {
                    if (attempt === 0) { await sleep(400); continue; }
                    failed += 1;
                }
            }
        };
        for (let i = 0; i < ids.length; i += CONC) {
            await Promise.all(ids.slice(i, i + CONC).map(one));
        }
        return { map: out, requested: ids.length, ok: Object.keys(out).length, failed };
    })()`;
    const res = unwrapBrowser(await page.evaluate(script));
    return res && typeof res === 'object' && res.map
        ? res
        : { map: {}, requested: appids.length, ok: 0, failed: appids.length };
}
