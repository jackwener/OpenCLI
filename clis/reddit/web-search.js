// Runs in the page context; redditFetchJson (./api.js) is injected by the caller.
export async function fetchRankedRedditSearch(query, subreddit, sort, time, limit, legacyPath) {
    const origin = 'https://www.reddit.com';
    const params = new URLSearchParams({ q: query, type: 'posts', sort, t: time });
    if (subreddit) params.set('restrict_sr', '1');
    let next = `${subreddit ? '/r/' + encodeURIComponent(subreddit) : ''}/search/?${params}`;
    const seenPages = new Set();
    const ids = [];
    const seenIds = new Set();
    // What each result card itself shows, kept in case /by_id hydration is
    // blocked by Reddit's network-security filter (#2720).
    const cards = new Map();
    function readCard(unit, id, context) {
        const permalink = Array.from(unit.querySelectorAll('a[href*="/comments/"]'))
            .map(a => a.getAttribute('href') || '').find(href => /^\/r\/[^/]+\/comments\/[a-z0-9]+\//i.test(href)) || '';
        const counts = {};
        for (const number of unit.querySelectorAll('faceplate-number[number]')) {
            const label = (number.parentElement?.textContent || '').toLowerCase();
            const key = /\bcomments?\b/.test(label) ? 'num_comments' : /\b(?:votes?|upvotes?|points?)\b/.test(label) ? 'score' : '';
            if (key && !(key in counts)) counts[key] = Number(number.getAttribute('number')) || 0;
        }
        const created = Date.parse(unit.querySelector('faceplate-timeago[ts]')?.getAttribute('ts') || '');
        const subreddit = context?.subreddit?.name || '';
        return { kind: 't3', data: {
            id: id.slice(3), name: id,
            title: typeof context?.post?.title === 'string' ? context.post.title : '',
            subreddit_name_prefixed: subreddit ? 'r/' + subreddit : '',
            author: typeof context?.profile?.name === 'string' ? context.profile.name : '',
            score: counts.score || 0,
            num_comments: counts.num_comments || 0,
            permalink,
            created_utc: Number.isFinite(created) ? created / 1000 : 0,
            selftext: '',
        } };
    }
    const wall = (response, text, url) => ({ kind: 'login-wall', sentinel: {
        __loginWall: true, status: response.status, url: response.url || url,
        contentType: response.headers.get('content-type') || '', bodyPreview: text.slice(0, 100),
    } });
    const blocked = (response, url) => ({ kind: 'fetch-failed', where: '/search/',
        failure: { reason: 'blocked', status: response.status, url: response.url || url } });
    async function listing(url, where) {
        const result = await redditFetchJson(url);
        if (!result.ok) return { kind: 'fetch-failed', failure: result.failure, where };
        const payload = result.data;
        if (!Array.isArray(payload?.data?.children)) return { kind: 'malformed', detail: 'payload is missing data.children' };
        return { kind: 'ok', rows: payload.data.children };
    }
    for (let page = 0; next && ids.length < limit && page < 10; page++) {
        if (seenPages.has(next)) return { kind: 'malformed', detail: 'web search repeated its pagination cursor' };
        seenPages.add(next);
        const response = await fetch(next, { credentials: 'include' });
        const text = await response.text();
        if (response.status === 429) return { kind: 'fetch-failed', where: '/search/', failure: { reason: 'rate-limited', status: 429, url: response.url || next } };
        const html = /text\/html/i.test(response.headers.get('content-type') || '');
        if (html && !response.ok && /blocked by network security/i.test(text)) return blocked(response, next);
        if (!response.ok) {
            if ([401, 403].includes(response.status) && html) return wall(response, text, next);
            return { kind: 'http', status: response.status };
        }
        const landed = new URL(response.url || next, origin);
        if (landed.origin !== origin || /\/login\/?$|\/account\/login|\/challenge\/?$/.test(landed.pathname)) return wall(response, text, next);
        const doc = new DOMParser().parseFromString(text, 'text/html');
        // Reddit serves two result-card layouts depending on the query; both carry
        // the same post telemetry, links and counts.
        const units = Array.from(doc.querySelectorAll('[data-testid="search-post-unit"], [data-testid="sdui-post-unit"]'));
        if (!units.length && /blocked by network security/i.test(doc.body?.textContent || '')) return blocked(response, next);
        if ((!units.length && /^(?:log in|login|access denied|blocked|security verification|just a moment)/i.test(doc.title))
            || (!units.length && /whoa there, pardner|you.ve been blocked/i.test(doc.body?.textContent || ''))
            || (!units.length && doc.querySelector('form[action*="/login"], #loginForm, #challenge-form, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'))) return wall(response, text, next);
        for (const unit of units) {
            const unitIds = new Set();
            let context = null;
            for (const tracker of unit.querySelectorAll('search-telemetry-tracker[data-faceplate-tracking-context]')) {
                try {
                    const parsed = JSON.parse(tracker.getAttribute('data-faceplate-tracking-context'));
                    const id = parsed?.post?.id;
                    if (typeof id === 'string' && /^t3_[a-z0-9]+$/.test(id)) { unitIds.add(id); context = context || parsed; }
                } catch { /* Ignore non-post telemetry, never execute page scripts. */ }
            }
            if (unitIds.size !== 1) return { kind: 'malformed', detail: 'web search result has missing or ambiguous post identity' };
            const id = [...unitIds][0];
            if (!seenIds.has(id)) { seenIds.add(id); ids.push(id); cards.set(id, readCard(unit, id, context)); }
            if (ids.length === limit) break;
        }
        if (ids.length >= limit) { next = ''; break; }
        // Only markup incompatibility on the first page can use the legacy API.
        // Auth, rate limits, transport failures and partial-page failures are terminal.
        if (!units.length && page === 0) {
            if (/no (?:results|posts) found|couldn.t find any results/i.test(doc.body?.textContent || '')) return { kind: 'ok', rows: [] };
            const legacy = await listing(legacyPath, legacyPath.split('?')[0]);
            return legacy.kind === 'ok' ? { ...legacy, fallback: true } : legacy;
        }
        const cursors = new Set();
        for (const partial of doc.querySelectorAll('faceplate-partial[src]')) {
            const raw = partial.getAttribute('src');
            let url;
            try { url = new URL(raw, origin); } catch { continue; }
            if (!/^\/svc\/shreddit\/search(?:\/|$)/.test(url.pathname)) continue;
            if (url.origin !== origin || url.username || url.password) return { kind: 'malformed', detail: 'web search returned an unsafe pagination URL' };
            if (!url.searchParams.get('cursor')) continue;
            if (url.searchParams.has('q') && url.searchParams.get('q') !== query) return { kind: 'malformed', detail: 'web search pagination changed the query' };
            cursors.add(url.pathname + url.search);
        }
        if (cursors.size > 1) return { kind: 'malformed', detail: 'web search has ambiguous pagination cursors' };
        next = [...cursors][0] || '';
    }
    const byName = new Map();
    for (let offset = 0; offset < ids.length; offset += 100) {
        const result = await listing('/by_id/' + ids.slice(offset, offset + 100).join(',') + '.json?raw_json=1', '/by_id post hydration');
        if (result.kind === 'fetch-failed' && result.failure?.reason === 'blocked' && offset === 0) {
            const rows = ids.map(id => cards.get(id)).filter(row => row && row.data.title && row.data.permalink);
            if (rows.length !== ids.length) return result;
            return { kind: 'ok', rows, missing: 0, capped: Boolean(next && ids.length < limit), cardsOnly: true };
        }
        if (result.kind !== 'ok') return result;
        for (const row of result.rows) {
            const name = row?.data?.name || (row?.data?.id ? 't3_' + row.data.id : '');
            if ((row.kind === undefined || row.kind === 't3') && seenIds.has(name) && !byName.has(name)) {
                if (!/^[a-z0-9]+$/.test(row?.data?.id || '') || name !== 't3_' + row.data.id) return { kind: 'malformed', detail: 'hydrated post identity does not match its fullname' };
                byName.set(name, row);
            }
        }
    }
    const rows = ids.map(id => byName.get(id)).filter(Boolean);
    if (ids.length && !rows.length) return { kind: 'malformed', detail: 'no ranked posts could be hydrated' };
    return { kind: 'ok', rows, missing: ids.length - rows.length, capped: Boolean(next && ids.length < limit) };
}
