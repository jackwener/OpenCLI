/**
 * Shape-based field filter for `browser network --filter <fields>`.
 *
 * Agents know what fields a target request's body should contain
 * (e.g. "author, text, likes") but not which of the captured requests
 * carries that body. This module lets the network command filter
 * entries down to those whose inferred shape exposes every requested
 * field name as some path segment.
 *
 * Matching is "any-segment" (not last-segment-only): a field matches
 * if it equals any segment name of any path in the shape map. This
 * keeps nested-container fields (e.g. `legacy`, `author` used as an
 * object key with further nesting) findable.
 */
import type { Shape } from './shape.js';

export interface ParsedFilter {
    /** Deduped, order-preserving, trimmed non-empty field names. */
    fields: string[];
}

export interface FilterParseError {
    /** `invalid_filter` structured error reason for agents. */
    reason: string;
}

/**
 * Parse `--filter` argument value. Splits on `,`, trims, drops empties,
 * and dedupes (first-seen wins). Returns `FilterParseError` when the
 * result is empty after cleaning — which means the caller passed only
 * whitespace, commas, or an empty string.
 */
export function parseFilter(raw: string): ParsedFilter | FilterParseError {
    if (typeof raw !== 'string') {
        return { reason: `--filter value must be a non-empty comma-separated field list` };
    }
    const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length === 0) {
        return { reason: `--filter value must be a non-empty comma-separated field list (got "${raw}")` };
    }
    const seen = new Set<string>();
    const fields: string[] = [];
    for (const p of parts) {
        if (!seen.has(p)) { seen.add(p); fields.push(p); }
    }
    return { fields };
}

/**
 * Extract named segments from a shape path. Drops the leading `$`,
 * strips `[N]` array indices, and unwraps `["key"]` bracket-quoted
 * keys back to their raw string.
 *
 * Examples:
 *   `$`                              → []
 *   `$.data.items[0].author`         → ['data','items','author']
 *   `$.data.user["nick name"]`       → ['data','user','nick name']
 *   `$.rows[0][1]`                   → ['rows']
 */
export function extractSegments(path: string): string[] {
    if (!path || path === '$') return [];
    const out: string[] = [];
    // Start past the leading `$`; if path doesn't start with `$` treat
    // it as a raw segment list (keeps us robust to unexpected input).
    let i = path.startsWith('$') ? 1 : 0;
    while (i < path.length) {
        const c = path[i];
        if (c === '.') { i++; continue; }
        if (c === '[') {
            // Either `[N]` (numeric) or `["key"]` (quoted key). Handle both.
            const end = path.indexOf(']', i);
            if (end === -1) break;
            const inner = path.slice(i + 1, end);
            i = end + 1;
            if (inner.length >= 2 && inner.startsWith('"') && inner.endsWith('"')) {
                try { out.push(JSON.parse(inner) as string); }
                catch { out.push(inner.slice(1, -1)); }
            }
            // numeric index: drop
            continue;
        }
        // Bare identifier: read up to next `.` or `[`
        let j = i;
        while (j < path.length && path[j] !== '.' && path[j] !== '[') j++;
        out.push(path.slice(i, j));
        i = j;
    }
    return out;
}

/**
 * Collect the set of segment names used anywhere in a shape map.
 * The returned set is what we test field membership against.
 */
export function collectShapeSegments(shape: Shape): Set<string> {
    const acc = new Set<string>();
    for (const p of Object.keys(shape)) {
        for (const seg of extractSegments(p)) acc.add(seg);
    }
    return acc;
}

/**
 * True iff every field in `fields` equals some segment name in `shape`.
 * AND semantics: all fields must be present.
 */
export function shapeMatchesFilter(shape: Shape, fields: string[]): boolean {
    if (fields.length === 0) return true;
    const segs = collectShapeSegments(shape);
    for (const f of fields) {
        if (!segs.has(f)) return false;
    }
    return true;
}
