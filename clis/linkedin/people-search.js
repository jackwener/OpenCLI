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
      const handle = m[1];
      if (seenHandles.has(handle)) continue;
      const aria = a.querySelector('span[aria-hidden="true"]');
      let name = normalize(aria ? aria.textContent : a.textContent);
      name = name.replace(/^Status is (online|offline)\.?\s*/i, '')
                 .replace(/'?s profile$/i, '')
                 .replace(/\s*[•·].*$/, '').trim();
      if (!name) continue;
      seenHandles.add(handle);
      personEntries.push({ handle, name });
    }

    const lines = (main.innerText || '').split(/\n+/).map(normalize).filter(Boolean);

    // skip() rejects mutual-connection lines, so candidates that only
    // appear as mutual-connection links inside another card's row
    // never resolve a name index and get filtered out below.
    const nameToIndex = new Map();
    for (const { name } of personEntries) {
      if (nameToIndex.has(name)) continue;
      const match = lines.findIndex((l) =>
        !skip(l) && (
          l === name
          || l.startsWith(name + ' ')
          || l.startsWith(name + ',')
          || l.startsWith(name + "'")
        )
      );
      if (match >= 0) nameToIndex.set(name, match);
    }

    const resolved = personEntries.filter((p) => nameToIndex.has(p.name));
    const rows = [];
    for (let i = 0; i < resolved.length; i++) {
      const { handle, name } = resolved[i];
      const startIdx = nameToIndex.get(name);
      let stopIdx = lines.length;
      for (let j = i + 1; j < resolved.length; j++) {
        const otherStart = nameToIndex.get(resolved[j].name);
        if (otherStart != null && otherStart > startIdx) {
          stopIdx = otherStart;
          break;
        }
      }
      const slice = lines.slice(startIdx + 1, stopIdx).filter((l) => l !== name && !skip(l));
      rows.push({
        name,
        headline: slice[0] || '',
        location: slice[1] || '',
        profile_url: 'https://www.linkedin.com/in/' + handle + '/',
      });
    }
    return { rows };
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

        await page.goto(buildSearchUrl(keywords));
        await page.wait(6);

        const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
        const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
        if (!jsession) {
            throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn in the browser.');
        }

        const result = unwrapEvaluateResult(await page.evaluate(extractionScript()));
        if (result?.error) {
            // If LinkedIn redirected away from the search page that
            // usually means CUL was reached or the account is gated.
            throw new CommandExecutionError(`LinkedIn redirected away from the search page (${result.error}). Likely Commercial Use Limit reached - the limit resets on the 1st of next month.`);
        }
        const rows = Array.isArray(result?.rows) ? result.rows : [];
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
    extractionScript,
};
