// Pure helpers for the Strava adapter.
// Kept side-effect free (no DOM, no network) so they can be unit-tested in isolation
// from the raw shapes returned by page.evaluate().
import { ArgumentError } from '@jackwener/opencli/errors';

// Strava profile/activity links look like:
//   /activities/19010729205
//   /activities/18785265067#3497639849450753438
//   /activities/9981932437/best-efforts
// Pull the numeric activity id out of any of these.
export function parseActivityId(href) {
    if (!href)
        return null;
    const match = String(href).match(/\/activities\/(\d+)/);
    return match ? match[1] : null;
}

// Accept a bare id, an /activities/<id> path, or a full activity URL and return the id.
export function normalizeActivityId(input) {
    if (input == null)
        return '';
    const fromPath = parseActivityId(input);
    if (fromPath)
        return fromPath;
    const digits = String(input).match(/(\d+)/);
    return digits ? digits[1] : '';
}

// Accept a bare id, an /athletes/<id> path, or a full profile URL and return the id.
export function normalizeAthleteId(input) {
    if (input == null)
        return '';
    const fromPath = String(input).match(/\/athletes\/(\d+)/);
    if (fromPath)
        return fromPath[1];
    const digits = String(input).match(/(\d+)/);
    return digits ? digits[1] : '';
}

// Accept a bare id, a /clubs/<id> path, or a full club URL and return the id.
export function normalizeClubId(input) {
    if (input == null)
        return '';
    const fromPath = String(input).match(/\/clubs\/(\d+)/);
    if (fromPath)
        return fromPath[1];
    const digits = String(input).match(/(\d+)/);
    return digits ? digits[1] : '';
}

// Accept a bare id, a /segments/<id> path, or a full segment URL and return the id.
export function normalizeSegmentId(input) {
    if (input == null)
        return '';
    const fromPath = String(input).match(/\/segments\/(\d+)/);
    if (fromPath)
        return fromPath[1];
    const digits = String(input).match(/(\d+)/);
    return digits ? digits[1] : '';
}

// The recent-activities widget tags each row with an icon class such as
// "icon-ride" / "icon-run" / "icon-workout". Strip the "icon-" prefix to get the sport.
// Falls back to the icon's visible text ("Ride", "Run") when no class is present.
export function sportFromIcon(iconClass, fallbackText) {
    if (iconClass) {
        const match = String(iconClass).match(/icon-([a-z0-9]+)/i);
        if (match)
            return match[1].toLowerCase();
    }
    const text = (fallbackText || '').trim().toLowerCase();
    return text || '';
}

// Map a Strava inline-stats label to a stable column key.
const STAT_LABELS = {
    'distance': 'distance',
    'moving time': 'moving_time',
    'elapsed time': 'elapsed_time',
    'elevation': 'elevation',
    'pace': 'pace',
    'speed': 'speed',
    'calories': 'calories',
    'energy output': 'energy_output',
    'weighted avg power': 'weighted_avg_power',
    'total work': 'total_work',
};

// The activity page renders stats as <li><strong>59.39 km</strong>Distance</li>.
// page.evaluate() hands us [{ strong: '59.39 km', full: '59.39 km Distance' }, ...];
// recover a { distance, moving_time, elevation, ... } object keyed by the label.
export function parseInlineStats(items) {
    const out = {};
    for (const item of items || []) {
        const value = cleanText(item && item.strong);
        const full = cleanText(item && item.full);
        if (!value)
            continue;
        const label = (full.startsWith(value) ? full.slice(value.length) : full.replace(value, '')).trim();
        const key = STAT_LABELS[label.toLowerCase()];
        if (key && !out[key])
            out[key] = value;
    }
    return out;
}

// Strava's "More Stats" table on an activity page renders one metric per row:
//   <tr><th>Speed</th><td>28.8 km/h</td><td>53.9 km/h</td></tr>   (avg | max)
//   <tr><th>Heart Rate</th><td>146 bpm</td><td>180 bpm</td></tr>
//   <tr><th>Calories</th><td colspan=2>941</td></tr>              (single value)
// page.evaluate() hands us [{ label, avg, max }] (max '' for single-valued rows,
// where the lone <td> lands in the `avg` slot). Flatten paired metrics into
// avg_<key> / max_<key> and single metrics into a flat key. Unknown labels are
// dropped rather than guessed — see the adapter's no-silently-wrong-data rule.
const PAIRED_STAT_LABELS = {
    'speed': 'speed',
    'pace': 'pace',
    'heart rate': 'hr',
    'cadence': 'cadence',
    'power': 'power',
};
const SINGLE_STAT_LABELS = {
    'calories': 'calories',
    'temperature': 'temperature',
    'elapsed time': 'elapsed_time',
};
export function parseMoreStats(rows) {
    const out = {};
    for (const row of rows || []) {
        const label = cleanText(row && row.label).toLowerCase();
        const avg = cleanText(row && row.avg);
        const max = cleanText(row && row.max);
        if (!label)
            continue;
        const paired = PAIRED_STAT_LABELS[label];
        if (paired) {
            if (avg && !out['avg_' + paired])
                out['avg_' + paired] = avg;
            if (max && !out['max_' + paired])
                out['max_' + paired] = max;
            continue;
        }
        const single = SINGLE_STAT_LABELS[label];
        if (single && avg && !out[single])
            out[single] = avg;
    }
    return out;
}

// The first <a href*="follows?type=following"> is a bare "Following" label; the count
// lives on the next link. Return the first link text for that type that carries digits.
export function pickFollowCount(links, type) {
    for (const link of links || []) {
        const href = (link && link.href) || '';
        if (!href.includes('type=' + type))
            continue;
        const digits = String((link && link.text) || '').replace(/[^0-9]/g, '');
        if (digits)
            return digits;
    }
    return '';
}

export function cleanText(value, max) {
    const text = (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
    return max ? text.slice(0, max) : text;
}

// Write commands have real side effects (they notify other athletes / mutate clubs),
// so they refuse to run unless the caller passes --execute. Returns nothing; throws on guard.
export function requireExecute(kwargs, action) {
    if (!kwargs || kwargs.execute !== true) {
        throw new ArgumentError(`Refusing to ${action} without --execute. Re-run with --execute to actually perform this write.`);
    }
}
