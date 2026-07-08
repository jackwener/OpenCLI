// Shared helpers for the REST Countries adapter (https://restcountries.com).
//
// REST Countries is a free public country-metadata API, no API key required.
// We hit v3.1 only. The `fields=` query param is mandatory in v3.1 to keep
// payloads small; we always specify the agent-useful projection.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const REST_COUNTRIES_BASE = 'https://restcountries.com/v3.1';
const UA = 'opencli-rest-countries-adapter/1.0 (+https://github.com/jackwener/opencli; mailto:opencli@example.com)';

// REST Countries valid region values; subregions are validated server-side.
export const REST_COUNTRIES_REGIONS = new Set(['africa', 'americas', 'asia', 'europe', 'oceania', 'antarctic']);

// Fields the adapter always requests; keep this list aligned with `columns` so
// rows never have null-where-absent silent drops.
export const COUNTRY_FIELDS = [
    'name', 'cca2', 'cca3', 'ccn3', 'capital', 'region', 'subregion',
    'population', 'area', 'languages', 'currencies', 'flag', 'latlng', 'timezones',
    'independent', 'unMember', 'landlocked',
].join(',');

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`rest-countries ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`rest-countries ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`rest-countries ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireRegion(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) throw new ArgumentError('rest-countries region is required (e.g. "europe", "asia")');
    if (!REST_COUNTRIES_REGIONS.has(raw)) {
        throw new ArgumentError(
            `rest-countries region "${value}" is not recognised`,
            `Allowed regions: ${[...REST_COUNTRIES_REGIONS].join(', ')}.`,
        );
    }
    return raw;
}

export async function restCountriesFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that restcountries.com is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `REST Countries returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} returned HTTP 429 (rate limited)`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    let body;
    try {
        body = await resp.json();
    }
    catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    return body;
}

/** Convert REST Countries' `{cur: {name, symbol}}` map to a comma-joined list. */
export function joinCurrencies(currencies) {
    if (!currencies || typeof currencies !== 'object') return '';
    return Object.entries(currencies)
        .map(([code, info]) => {
            const name = info && typeof info.name === 'string' ? info.name : '';
            return name ? `${code} (${name})` : code;
        })
        .join(', ');
}

/** Convert `{eng: 'English', fra: 'French'}` map to a comma-joined list of language names. */
export function joinLanguages(languages) {
    if (!languages || typeof languages !== 'object') return '';
    return Object.values(languages).filter((v) => typeof v === 'string' && v.trim()).join(', ');
}

/** Project a REST Countries v3.1 country object into a row matching the adapter columns. */
export function projectCountry(c) {
    const common = c?.name?.common ?? null;
    const official = c?.name?.official ?? null;
    const cca3 = typeof c?.cca3 === 'string' ? c.cca3 : null;
    return {
        commonName: typeof common === 'string' ? common : null,
        officialName: typeof official === 'string' ? official : null,
        cca2: typeof c?.cca2 === 'string' ? c.cca2 : null,
        cca3,
        ccn3: typeof c?.ccn3 === 'string' ? c.ccn3 : null,
        capital: Array.isArray(c?.capital) ? c.capital.join(', ') : null,
        region: typeof c?.region === 'string' ? c.region : null,
        subregion: typeof c?.subregion === 'string' ? c.subregion : null,
        population: typeof c?.population === 'number' ? c.population : null,
        area: typeof c?.area === 'number' ? c.area : null,
        languages: joinLanguages(c?.languages),
        currencies: joinCurrencies(c?.currencies),
        latitude: Array.isArray(c?.latlng) && typeof c.latlng[0] === 'number' ? c.latlng[0] : null,
        longitude: Array.isArray(c?.latlng) && typeof c.latlng[1] === 'number' ? c.latlng[1] : null,
        timezones: Array.isArray(c?.timezones) ? c.timezones.join(', ') : null,
        independent: typeof c?.independent === 'boolean' ? c.independent : null,
        unMember: typeof c?.unMember === 'boolean' ? c.unMember : null,
        landlocked: typeof c?.landlocked === 'boolean' ? c.landlocked : null,
        flag: typeof c?.flag === 'string' ? c.flag : null,
        url: cca3 ? `https://restcountries.com/v3.1/alpha/${cca3.toLowerCase()}` : '',
    };
}
