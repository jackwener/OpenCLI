// Shared helpers for NASA's Astronomy Picture Of the Day (APOD) adapter.
//
// Endpoint: https://api.nasa.gov/planetary/apod
//   ?api_key=DEMO_KEY                 (default; rate-limited but free)
//   ?date=YYYY-MM-DD                  single image
//   ?start_date=…&end_date=…          date range (inclusive)
//
// `DEMO_KEY` is documented to allow ~30 reqs/hr / 50 reqs/day per IP.
// Users can opt into their own key via NASA_API_KEY for higher quotas.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const APOD_BASE = 'https://api.nasa.gov/planetary/apod';
const UA = 'opencli-nasa-apod-adapter (+https://github.com/jackwener/opencli)';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// APOD started 1995-06-16; reject anything earlier (server-side error otherwise).
const APOD_EPOCH = '1995-06-16';

export function apodKey() {
    const v = process.env.NASA_API_KEY?.trim();
    return v && v.length > 0 ? v : 'DEMO_KEY';
}

export function requireOptionalDate(value, label = 'date') {
    if (value == null || value === '') return null;
    const s = String(value).trim();
    if (!DATE_PATTERN.test(s)) {
        throw new ArgumentError(`nasa-apod ${label} must be in YYYY-MM-DD format (e.g. "2026-01-01")`);
    }
    if (s < APOD_EPOCH) {
        throw new ArgumentError(`nasa-apod ${label} cannot be earlier than ${APOD_EPOCH} (APOD launch date)`);
    }
    return s;
}

export function requireDate(value, label = 'date') {
    const v = requireOptionalDate(value, label);
    if (!v) throw new ArgumentError(`nasa-apod ${label} is required (YYYY-MM-DD)`);
    return v;
}

export async function apodFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.nasa.gov is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `NASA APOD returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'NASA throttles DEMO_KEY at ~30/hr; set NASA_API_KEY (free at api.nasa.gov) for higher quotas.',
        );
    }
    if (!resp.ok) {
        let detail = '';
        try {
            const text = await resp.text();
            const m = text.match(/"msg"\s*:\s*"([^"]+)"/);
            if (m) detail = ` (${m[1]})`;
        }
        catch { /* ignore */ }
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}${detail}`);
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

/** Project a single APOD record onto our standard row shape. */
export function projectApod(item) {
    return {
        date: String(item?.date ?? '').trim(),
        title: String(item?.title ?? '').trim(),
        explanation: String(item?.explanation ?? '').trim(),
        mediaType: String(item?.media_type ?? '').trim(),
        url: String(item?.url ?? '').trim(),
        hdUrl: String(item?.hdurl ?? '').trim(),
        copyright: item?.copyright ? String(item.copyright).trim() : null,
        serviceVersion: String(item?.service_version ?? '').trim(),
        pageUrl: item?.date ? `https://apod.nasa.gov/apod/ap${item.date.slice(2).replace(/-/g, '')}.html` : '',
    };
}
