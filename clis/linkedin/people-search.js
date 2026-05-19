/**
 * LinkedIn people-search via SSR DOM text-slice. Voyager people-search
 * REST returns HTTP 500 from a web context; LinkedIn renders results
 * server-side now. One navigation per call consumes one CUL query.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const LINKEDIN_DOMAIN = 'www.linkedin.com';
const SEARCH_URL_BASE = 'https://www.linkedin.com/search/results/people/';
const MAX_LIMIT = 10;

function normalizeWhitespace(value) {
    return String(value ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function requireStringArg(args, key, label = key) {
    const value = normalizeWhitespace(args[key]);
    if (!value) throw new ArgumentError(`${label} is required`);
    return value;
}

function parseLimit(value) {
    if (value === undefined || value === null || value === '') return 5;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return limit;
}

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
    return payload;
}

function buildSearchUrl(keywords) {
    return SEARCH_URL_BASE + '?keywords=' + encodeURIComponent(keywords);
}

function looksLinkedInAuthWall(value) {
    const text = normalizeWhitespace(value).toLowerCase();
    if (!text) return false;
    return /linkedin\.com\/(?:login|checkpoint|authwall|uas)/i.test(text)
        || /\b(sign in|log in|join linkedin|captcha|verification required)\b/i.test(text)
        || /(请登录|登录领英|安全验证)/.test(text);
}

function normalizeProfileUrl(value) {
    const raw = normalizeWhitespace(value);
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return '';
        if (host !== 'linkedin.com' && host !== 'www.linkedin.com') return '';
        const match = parsed.pathname.match(/^\/in\/([^/?#]+)\/?$/);
        if (!match || !match[1]) return '';
        return `https://www.linkedin.com/in/${match[1]}/`;
    } catch {
        return '';
    }
}

function normalizePeopleRows(rows) {
    if (!Array.isArray(rows)) {
        throw new CommandExecutionError('LinkedIn people search returned malformed extraction payload: missing rows array');
    }
    return rows.map((row, index) => {
        if (!row || typeof row !== 'object') {
            throw new CommandExecutionError(`LinkedIn people search returned malformed row at index ${index}`);
        }
        const name = normalizeWhitespace(row.name);
        const profileUrl = normalizeProfileUrl(row.profile_url);
        if (!name || !profileUrl) {
            throw new CommandExecutionError(`LinkedIn people search returned row without stable profile identity at index ${index}`);
        }
        return {
            name,
            headline: normalizeWhitespace(row.headline),
            location: normalizeWhitespace(row.location),
            profile_url: profileUrl,
        };
    });
}

function parseNonNegativeCount(value, label) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0) {
        throw new CommandExecutionError(`LinkedIn people search returned malformed extraction payload: invalid ${label}`);
    }
    return count;
}

function extractionScript() {
    // Class-based selectors are dead (LinkedIn rotates hashed class
    // names on every deploy) and display:contents flattens the DOM
    // tree so per-card containers don't exist. Read main.innerText
    // and slice between consecutive person-name lines instead.
    return String.raw`(() => {
    if (!/search\/results\/people/.test(window.location.href)) {
      return { error: 'not on people search page', url: window.location.href };
    }
    const main = document.querySelector('main') || document.body;
    const normalize = (s) => String(s || '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();
    const skip = (l) => !l
      || /^Status is/.test(l)
      || /^(Message|Connect|Follow|View profile|Pending|Remove)$/i.test(l)
      || /^[•·]\s*(?:1st|2nd|3rd\+?|degree)/i.test(l)
      || /^[•·]/.test(l)
      || l.includes('mutual connection')
      || l.includes('shared connection')
      || /^Summary:/i.test(l)
      || /^About this profile/i.test(l);

    const anchors = Array.from(main.querySelectorAll('a[href*="/in/"]'));
    const personEntries = [];
    const seenHandles = new Set();
    for (const a of anchors) {
      const m = (a.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
      if (!m || !m[1]) continue;
      const profileHandle = m[1];
      if (seenHandles.has(profileHandle)) continue;
      const aria = a.querySelector('span[aria-hidden="true"]');
      let name = normalize(aria ? aria.textContent : a.textContent);
      name = name.replace(/^Status is (online|offline)\.?\s*/i, '')
                 .replace(/'?s profile$/i, '')
                 .replace(/\s*[•·].*$/, '').trim();
      if (!name) continue;
      seenHandles.add(profileHandle);
      personEntries.push({ profileHandle, displayName: name });
    }

    const lines = (main.innerText || '').split(/\n+/).map(normalize).filter(Boolean);

    // skip() rejects mutual-connection lines, so candidates that only
    // appear as mutual-connection links inside another card's row
    // never resolve a name index and get filtered out below.
    const nameToIndex = new Map();
    for (const { displayName } of personEntries) {
      if (nameToIndex.has(displayName)) continue;
      const match = lines.findIndex((l) =>
        !skip(l) && (
          l === displayName
          || l.startsWith(displayName + ' ')
          || l.startsWith(displayName + ',')
          || l.startsWith(displayName + "'")
        )
      );
      if (match >= 0) nameToIndex.set(displayName, match);
    }

    const resolved = personEntries.filter((p) => nameToIndex.has(p.displayName));
    const rows = [];
    for (let i = 0; i < resolved.length; i++) {
      const { profileHandle, displayName } = resolved[i];
      const startIdx = nameToIndex.get(displayName);
      let stopIdx = lines.length;
      for (let j = i + 1; j < resolved.length; j++) {
        const otherStart = nameToIndex.get(resolved[j].displayName);
        if (otherStart != null && otherStart > startIdx) {
          stopIdx = otherStart;
          break;
        }
      }
      const slice = lines.slice(startIdx + 1, stopIdx).filter((l) => l !== displayName && !skip(l));
      rows.push({
        name: displayName,
        headline: slice[0] || '',
        location: slice[1] || '',
        profile_url: 'https://www.linkedin.com/in/' + profileHandle + '/',
      });
    }
    return {
      rows,
      candidate_count: personEntries.length,
      person_entries_count: personEntries.length,
      resolved_count: resolved.length,
    };
  })()`;
}

cli({
    site: 'linkedin',
    name: 'people-search',
    access: 'read',
    description: 'Search standard LinkedIn (not Sales Navigator) for people by keyword. Each invocation consumes against LinkedIn\'s monthly Commercial Use Limit on people search; throttle accordingly.',
    domain: LINKEDIN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'keywords', type: 'string', required: true, positional: true, help: 'People search keywords, e.g. "site reliability engineer berlin"' },
        { name: 'limit', type: 'int', default: 5, help: `Maximum people to return (1-${MAX_LIMIT}); each query counts toward LinkedIn's monthly CUL` },
    ],
    columns: ['rank', 'name', 'headline', 'location', 'profile_url'],
    func: async (page, args) => {
        if (!page) throw new CommandExecutionError('Browser session required for linkedin people-search');
        const keywords = requireStringArg(args, 'keywords', '--keywords');
        const limit = parseLimit(args.limit);

        try {
            await page.goto(buildSearchUrl(keywords));
            await page.wait(6);
        } catch (error) {
            throw new CommandExecutionError(`LinkedIn people search navigation failed: ${error?.message || error}`);
        }

        let cookies;
        try {
            cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
        } catch (error) {
            throw new CommandExecutionError(`LinkedIn cookie lookup failed: ${error?.message || error}`);
        }
        if (!Array.isArray(cookies)) {
            throw new CommandExecutionError('LinkedIn cookie lookup returned malformed payload');
        }
        const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
        if (!jsession) {
            throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn in the browser.');
        }

        let result;
        try {
            result = unwrapEvaluateResult(await page.evaluate(extractionScript()));
        } catch (error) {
            throw new CommandExecutionError(`LinkedIn people search extraction failed: ${error?.message || error}`);
        }
        if (result?.error) {
            if (looksLinkedInAuthWall(`${result.url || ''} ${result.error || ''}`)) {
                throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn people search requires an active signed-in browser session.');
            }
            // If LinkedIn redirected away from the search page that
            // usually means CUL was reached or the account is gated.
            throw new CommandExecutionError(`LinkedIn redirected away from the search page (${result.error}). Likely Commercial Use Limit reached - the limit resets on the 1st of next month.`);
        }
        if (!result || typeof result !== 'object') {
            throw new CommandExecutionError('LinkedIn people search returned malformed extraction payload');
        }
        const candidateCount = parseNonNegativeCount(result.candidate_count, 'candidate_count');
        parseNonNegativeCount(result.person_entries_count, 'person_entries_count');
        const resolvedCount = parseNonNegativeCount(result.resolved_count, 'resolved_count');
        const rows = normalizePeopleRows(result.rows);
        if (rows.length === 0 && (candidateCount > 0 || resolvedCount > 0)) {
            throw new CommandExecutionError('LinkedIn people search found profile candidates but could not parse stable result rows');
        }
        if (rows.length === 0) {
            throw new EmptyResultError(`No people found on the rendered page for "${keywords}". The search may have returned zero results, or the DOM markup may have changed.`);
        }
        return rows.slice(0, limit).map((p, i) => ({ rank: i + 1, ...p }));
    },
});

export const __test__ = {
    normalizeWhitespace,
    parseLimit,
    buildSearchUrl,
    looksLinkedInAuthWall,
    normalizeProfileUrl,
    normalizePeopleRows,
    parseNonNegativeCount,
    extractionScript,
};
