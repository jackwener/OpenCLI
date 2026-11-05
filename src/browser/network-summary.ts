import { ArgumentError } from '../errors.js';
import type { CachedNetworkEntry } from './network-cache.js';
import { deriveKey } from './network-key.js';

export interface NetworkSummaryOptions {
    groupBy?: 'endpoint' | 'origin';
    sort?: 'requests' | 'failures' | 'size' | 'recent';
    offset?: number;
    limit?: number;
}

interface Count { value: string; count: number }
export interface NetworkSummaryMetrics {
    requests: number;
    failed: number;
    failure_rate: number | null;
    statuses: {
        informational: number; success: number; redirect: number;
        client_error: number; server_error: number; no_response: number; unknown: number;
    };
    status_codes: Array<{ status: number; count: number }>;
    response_size: {
        unit: 'characters'; known_requests: number; unknown_requests: number;
        total: number | null; min: number | null; max: number | null; mean: number | null;
        overflow: boolean;
    };
    truncated_bodies: number;
    observed: {
        first: string | null; last: string | null; span_ms: number | null;
        known_requests: number; unknown_requests: number;
    };
}

export interface NetworkSummaryGroup extends NetworkSummaryMetrics {
    origin: string | null;
    method: string | null;
    pathname: string | null;
    methods: Count[];
    content_types: Count[];
    example_keys: string[];
}

export interface NetworkSummaryReport {
    schema_version: 1;
    group_by: 'endpoint' | 'origin';
    sort: 'requests' | 'failures' | 'size' | 'recent';
    totals: NetworkSummaryMetrics;
    diagnostics: { invalid_urls: number; unknown_methods: number };
    pagination: { total_groups: number; offset: number; limit: number; next_offset: number | null };
    groups: NetworkSummaryGroup[];
}

interface Accumulator {
    requests: number;
    statuses: NetworkSummaryMetrics['statuses'];
    statusCodes: Map<number, number>;
    sizes: number;
    sizeTotal: number | null;
    sizeMin: number | null;
    sizeMax: number | null;
    truncated: number;
    timestamps: number;
    first: number | null;
    last: number | null;
}

interface Group {
    origin: string | null;
    method: string | null;
    pathname: string | null;
    metrics: Accumulator;
    methods: Map<string, number>;
    contentTypes: Map<string, number>;
    keys: Set<string>;
}

function accumulator(): Accumulator {
    return {
        requests: 0,
        statuses: { informational: 0, success: 0, redirect: 0, client_error: 0, server_error: 0, no_response: 0, unknown: 0 },
        statusCodes: new Map(), sizes: 0, sizeTotal: 0, sizeMin: null, sizeMax: null,
        truncated: 0, timestamps: 0, first: null, last: null,
    };
}

function increment<K>(map: Map<K, number>, key: K): void { map.set(key, (map.get(key) ?? 0) + 1); }

function accumulate(target: Accumulator, entry: CachedNetworkEntry): void {
    target.requests++;
    const status = entry.status;
    if (status === 0) target.statuses.no_response++;
    else if (Number.isInteger(status) && status >= 100 && status <= 599) {
        const category = (['informational', 'success', 'redirect', 'client_error', 'server_error'] as const)[Math.floor(status / 100) - 1];
        target.statuses[category]++;
    } else target.statuses.unknown++;
    if (Number.isInteger(status) && (status === 0 || (status >= 100 && status <= 599))) increment(target.statusCodes, status);

    // The capture protocol measures decoded body characters, not network bytes.
    // Do not infer missing sizes from serialized JSON or request metadata.
    const size = entry.body_full_size ?? entry.size;
    if (Number.isSafeInteger(size) && size >= 0) {
        target.sizes++;
        if (target.sizeTotal !== null) {
            const sum = target.sizeTotal + size;
            target.sizeTotal = Number.isSafeInteger(sum) ? sum : null;
        }
        target.sizeMin = target.sizeMin === null ? size : Math.min(target.sizeMin, size);
        target.sizeMax = target.sizeMax === null ? size : Math.max(target.sizeMax, size);
    }
    if (entry.body_truncated === true) target.truncated++;
    const time = entry.timestamp;
    if (typeof time === 'number' && Number.isFinite(time) && time > 0 && time <= 8.64e15) {
        target.timestamps++;
        target.first = target.first === null ? time : Math.min(target.first, time);
        target.last = target.last === null ? time : Math.max(target.last, time);
    }
}

function metrics(target: Accumulator): NetworkSummaryMetrics {
    const failed = target.statuses.client_error + target.statuses.server_error + target.statuses.no_response;
    const knownStatuses = target.requests - target.statuses.unknown;
    return {
        requests: target.requests, failed, failure_rate: knownStatuses ? failed / knownStatuses : null,
        statuses: target.statuses,
        status_codes: [...target.statusCodes].sort(([a], [b]) => a - b).map(([status, count]) => ({ status, count })),
        response_size: {
            unit: 'characters', known_requests: target.sizes, unknown_requests: target.requests - target.sizes,
            total: target.sizes ? target.sizeTotal : null, min: target.sizeMin, max: target.sizeMax,
            mean: target.sizes && target.sizeTotal !== null ? target.sizeTotal / target.sizes : null,
            overflow: target.sizeTotal === null,
        },
        truncated_bodies: target.truncated,
        observed: {
            first: target.first === null ? null : new Date(target.first).toISOString(),
            last: target.last === null ? null : new Date(target.last).toISOString(),
            span_ms: target.first === null || target.last === null ? null : target.last - target.first,
            known_requests: target.timestamps, unknown_requests: target.requests - target.timestamps,
        },
    };
}

function counts(map: Map<string, number>): Count[] {
    return [...map].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b)).map(([value, count]) => ({ value, count }));
}

/** Validate before reading the live buffer: capture is a destructive drain. */
export function resolveNetworkSummaryOptions(options: NetworkSummaryOptions = {}): Required<NetworkSummaryOptions> {
    const { groupBy = 'endpoint', sort = 'requests', offset = 0, limit = 20 } = options;
    if (groupBy !== 'endpoint' && groupBy !== 'origin') throw new ArgumentError('--group-by must be endpoint or origin.');
    if (!['requests', 'failures', 'size', 'recent'].includes(sort)) throw new ArgumentError('--sort must be requests, failures, size, or recent.');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ArgumentError('--offset must be a non-negative safe integer.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ArgumentError('--limit must be an integer between 1 and 500.');
    return { groupBy, sort, offset, limit };
}

/** Metadata aggregation only: neither request nor response bodies are inspected. */
export function summarizeNetwork(entries: readonly CachedNetworkEntry[], options: NetworkSummaryOptions = {}): NetworkSummaryReport {
    const { groupBy, sort, offset, limit } = resolveNetworkSummaryOptions(options);
    const total = accumulator();
    const groups = new Map<string, Group>();
    const diagnostics = { invalid_urls: 0, unknown_methods: 0 };
    for (const entry of entries) {
        let url: URL | null = null;
        try {
            const parsed = new URL(entry.url);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed;
        } catch { /* Keep unparseable traffic in an unknown-origin group without exposing the raw URL. */ }
        if (!url) diagnostics.invalid_urls++;
        const method = typeof entry.method === 'string' && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(entry.method)
            ? entry.method.toUpperCase() : null;
        if (method === null) diagnostics.unknown_methods++;
        const origin = url?.origin ?? null;
        const pathname = groupBy === 'endpoint' ? url?.pathname ?? null : null;
        const identity = JSON.stringify([origin, groupBy === 'endpoint' ? method : null, pathname]);
        let group = groups.get(identity);
        if (!group) {
            group = {
                origin, method: groupBy === 'endpoint' ? method : null, pathname,
                metrics: accumulator(), methods: new Map(), contentTypes: new Map(), keys: new Set(),
            };
            groups.set(identity, group);
        }
        accumulate(total, entry);
        accumulate(group.metrics, entry);
        if (method) increment(group.methods, method);
        const ct = typeof entry.ct === 'string' ? entry.ct.split(';', 1)[0].trim().toLowerCase() : '';
        if (ct) increment(group.contentTypes, ct);
        if (url && method && group.keys.size < 3 && typeof entry.key === 'string') {
            // Only retain keys produced by assignKeys, never arbitrary cache strings.
            // Invalid URLs can contain query credentials in their fallback key.
            const base = deriveKey({ url: url.href, method });
            const suffix = entry.key.slice(base.length);
            if (entry.key === base || (entry.key.startsWith(base) && /^#[2-9]\d*$|^#1\d+$/.test(suffix))) group.keys.add(entry.key);
        }
    }
    const rows = [...groups].map(([identity, group]) => ({
        identity,
        row: {
            origin: group.origin, method: group.method, pathname: group.pathname,
            ...metrics(group.metrics), methods: counts(group.methods), content_types: counts(group.contentTypes),
            example_keys: [...group.keys],
        },
    }));
    rows.sort((a, b) => {
        const value = (row: NetworkSummaryGroup): number | null => sort === 'failures' ? row.failed
            : sort === 'size' ? row.response_size.total
                : sort === 'recent' ? (row.observed.last === null ? null : Date.parse(row.observed.last)) : row.requests;
        const av = value(a.row);
        const bv = value(b.row);
        if (av !== bv) return av === null ? 1 : bv === null ? -1 : bv - av;
        return a.identity.localeCompare(b.identity);
    });
    const page = rows.slice(offset, offset + limit).map(({ row }) => row);
    return {
        schema_version: 1, group_by: groupBy, sort, totals: metrics(total), diagnostics,
        pagination: { total_groups: rows.length, offset, limit, next_offset: offset + page.length < rows.length ? offset + page.length : null },
        groups: page,
    };
}
