// Shared helpers for the Wikidata adapters.
//
// Wikidata exposes two complementary public endpoints:
//   • `wbsearchentities` on `www.wikidata.org/w/api.php` for keyword → Q-IDs
//   • `Special:EntityData/<qid>.json` for the canonical entity dump
// No API key. Anonymous traffic is rate-limited but generous; we set a polite UA.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const WIKIDATA_BASE = 'https://www.wikidata.org';
const UA = 'opencli-wikidata-adapter/1.0 (+https://github.com/jackwener/opencli; mailto:opencli@example.com)';

// Q-ID = an item; P-ID = a property; L-ID = a lexeme. We accept all three so the
// adapter can be reused for properties / lexemes without a separate command, but
// search only returns Q-IDs by default.
const ENTITY_ID_PATTERN = /^[QPL]\d+$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`wikidata ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`wikidata ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`wikidata ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireEntityId(value) {
    const raw = String(value ?? '').trim().toUpperCase();
    if (!raw) throw new ArgumentError('wikidata entity id is required (e.g. "Q937")');
    // Tolerate URL-paste like `https://www.wikidata.org/wiki/Q937`.
    const stripped = raw.replace(/^HTTPS?:\/\/[^/]+\/WIKI\//i, '');
    if (!ENTITY_ID_PATTERN.test(stripped)) {
        throw new ArgumentError(
            `wikidata entity id "${value}" is not a valid Q/P/L identifier`,
            'Expected format: "Q<digits>" (item), "P<digits>" (property), or "L<digits>" (lexeme).',
        );
    }
    return stripped;
}

export function requireLanguage(value, defaultValue = 'en') {
    const raw = String(value ?? defaultValue).trim().toLowerCase();
    // Wikidata language codes are 2-3 letter ISO 639 codes plus optional region (`zh-hans`).
    if (!/^[a-z]{2,3}(-[a-z]{2,8})?$/.test(raw)) {
        throw new ArgumentError(
            `wikidata language "${value}" is not a valid language code`,
            'Expected an ISO 639 language code such as "en", "fr", "zh", "zh-hans".',
        );
    }
    return raw;
}

export async function wikidataFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that www.wikidata.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Wikidata returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Wikidata throttles anonymous traffic; back off and retry.',
        );
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

/**
 * Pick a localised label / description from a `{<lang>: {value}}` map.
 * Falls back to English if the requested language is missing.
 */
export function pickLocalised(map, language) {
    if (!map || typeof map !== 'object') return null;
    const direct = map[language];
    if (direct && typeof direct.value === 'string' && direct.value.trim()) return direct.value;
    if (language !== 'en' && map.en && typeof map.en.value === 'string' && map.en.value.trim()) {
        return map.en.value;
    }
    return null;
}

export function joinAliases(aliases, language, max = 5) {
    if (!aliases || typeof aliases !== 'object') return '';
    // Mirror the label/description fallback: prefer requested language, then English.
    let list = Array.isArray(aliases[language]) ? aliases[language] : [];
    if (list.length === 0 && language !== 'en' && Array.isArray(aliases.en)) list = aliases.en;
    const names = list.map((a) => (a && typeof a.value === 'string' ? a.value : '')).filter(Boolean);
    if (names.length === 0) return '';
    if (names.length > max) return [...names.slice(0, max), `(+${names.length - max})`].join(', ');
    return names.join(', ');
}
