import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../errors.js';
import type { CachedNetworkEntry } from './network-cache.js';
import { assignKeys } from './network-key.js';
import { resolveNetworkSummaryOptions, summarizeNetwork, type NetworkSummaryOptions } from './network-summary.js';

const NOW = Date.parse('2026-11-03T10:00:00Z');
function entry(overrides: Partial<CachedNetworkEntry> = {}): CachedNetworkEntry {
    return {
        key: 'GET api.example.test/items', url: 'https://api.example.test/items?page=1',
        method: 'GET', status: 200, size: 100, ct: 'application/json', timestamp: NOW,
        body: { private: 'PRIVATE_RESPONSE' }, request: { body: { private: 'PRIVATE_REQUEST' } },
        ...overrides,
    };
}

describe('summarizeNetwork', () => {
    it('groups query variants without collapsing methods, schemes, ports, or paths', () => {
        const entries = assignKeys([
            entry(), entry({ url: 'https://api.example.test/items?page=2', method: 'get', status: 429, size: 200, timestamp: NOW + 1000 }),
            entry({ method: 'POST' }), entry({ url: 'http://api.example.test/items' }),
            entry({ url: 'https://api.example.test:8443/items' }), entry({ url: 'https://api.example.test/items/42' }),
        ]);
        const report = summarizeNetwork(entries);
        expect(report.pagination.total_groups).toBe(5);
        expect(report.totals.requests).toBe(6);
        expect(report.groups[0]).toMatchObject({
            method: 'GET', origin: 'https://api.example.test', pathname: '/items', requests: 2, failed: 1, failure_rate: 0.5,
            response_size: { total: 300, min: 100, max: 200, mean: 150, unit: 'characters' },
            observed: { first: new Date(NOW).toISOString(), last: new Date(NOW + 1000).toISOString(), span_ms: 1000 },
            example_keys: ['GET api.example.test/items', 'GET api.example.test/items#2'],
        });
    });

    it('supports origin grouping with per-method and normalized content-type counts', () => {
        const report = summarizeNetwork([
            entry(), entry({ method: 'POST', url: 'https://api.example.test/login', ct: 'Application/JSON; charset=utf-8' }),
            entry({ url: 'https://api.example.test/about', ct: 'text/plain; charset=UTF-8' }),
            entry({ url: 'https://other.test/' }),
        ], { groupBy: 'origin' });
        expect(report.groups).toHaveLength(2);
        expect(report.groups[0]).toMatchObject({
            origin: 'https://api.example.test', method: null, pathname: null, requests: 3,
            methods: [{ value: 'GET', count: 2 }, { value: 'POST', count: 1 }],
            content_types: [{ value: 'application/json', count: 2 }, { value: 'text/plain', count: 1 }],
        });
    });

    it('separates status zero from HTTP errors and excludes unknown statuses from the failure rate', () => {
        const report = summarizeNetwork([0, 101, 200, 204, 302, 404, 429, 500, 503, -1, 600, 200.5, NaN]
            .map((status) => entry({ status })));
        expect(report.totals.statuses).toEqual({
            informational: 1, success: 2, redirect: 1, client_error: 2, server_error: 2, no_response: 1, unknown: 4,
        });
        expect(report.totals.failed).toBe(5);
        expect(report.totals.failure_rate).toBe(5 / 9);
        expect(report.totals.status_codes).toEqual([0, 101, 200, 204, 302, 404, 429, 500, 503].map((status) => ({ status, count: 1 })));
        expect(summarizeNetwork([entry({ status: NaN })]).totals.failure_rate).toBeNull();
    });

    it('preserves measured zeros, unknown sizes, and full-size truncation metadata', () => {
        const report = summarizeNetwork([
            entry({ size: 0 }), entry({ size: 50, body_truncated: true, body_full_size: 1000 }),
            entry({ size: NaN }), entry({ size: -1 }), entry({ size: Infinity }), entry({ size: 1.5 }),
        ]);
        expect(report.totals.response_size).toEqual({
            unit: 'characters', known_requests: 2, unknown_requests: 4,
            total: 1000, min: 0, max: 1000, mean: 500, overflow: false,
        });
        expect(report.totals.truncated_bodies).toBe(1);
        expect(summarizeNetwork([entry({ size: NaN })]).totals.response_size.total).toBeNull();
        expect(summarizeNetwork([entry({ size: 0 })]).totals.response_size.total).toBe(0);
    });

    it('reports integer overflow without returning an imprecise total', () => {
        const report = summarizeNetwork([entry({ size: Number.MAX_SAFE_INTEGER }), entry({ size: 1 })]);
        expect(report.totals.response_size).toMatchObject({ total: null, mean: null, overflow: true, known_requests: 2 });
        expect(report.groups[0].response_size.overflow).toBe(true);
        expect(report.totals.response_size.max).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('computes observation spans independently of input order and handles invalid timestamps', () => {
        const report = summarizeNetwork([NOW + 2000, NOW, NOW + 1000, undefined, NaN, Infinity, 0, -1, 8.64e15 + 1]
            .map((timestamp) => entry({ timestamp })));
        expect(report.totals.observed).toEqual({
            first: new Date(NOW).toISOString(), last: new Date(NOW + 2000).toISOString(), span_ms: 2000,
            known_requests: 3, unknown_requests: 6,
        });
        expect(summarizeNetwork([entry({ timestamp: undefined })]).totals.observed).toMatchObject({ first: null, last: null, span_ms: null });
    });

    it('emits no request/response values, query values, fragments, or URL credentials', () => {
        const row = entry({ url: 'https://user:PRIVATE_PASSWORD@api.example.test/items?q=PRIVATE_QUERY#PRIVATE_FRAGMENT' });
        Object.defineProperty(row, 'body', { get: () => { throw new Error('must not inspect response'); } });
        Object.defineProperty(row, 'request', { get: () => { throw new Error('must not inspect request'); } });
        const report = summarizeNetwork([row]);
        expect(report.groups[0].origin).toBe('https://api.example.test');
        expect(report.groups[0].pathname).toBe('/items');
        expect(JSON.stringify(report)).not.toMatch(/PRIVATE_|password|\?q=|"body"|"request"/);
    });

    it('retains malformed and non-HTTP URLs as unknown groups without leaking fallback keys', () => {
        const report = summarizeNetwork([
            entry({ url: 'invalid?token=PRIVATE_QUERY', key: 'GET invalid?token=PRIVATE_QUERY' }),
            entry({ url: 'data:text/plain,PRIVATE_BODY', key: 'GET PRIVATE_BODY' }),
            entry({ url: 'file:///PRIVATE_PATH' }), entry({ method: 'GET\nPRIVATE_HEADER' }),
        ]);
        expect(report.diagnostics).toEqual({ invalid_urls: 3, unknown_methods: 1 });
        expect(report.totals.requests).toBe(4);
        expect(report.groups.find((group) => group.origin === null)).toMatchObject({ requests: 3, example_keys: [] });
        expect(JSON.stringify(report)).not.toMatch(/PRIVATE_/);
    });

    it('keeps at most three real cache keys per group, including collision suffixes', () => {
        const entries = assignKeys(Array.from({ length: 15 }, () => entry()));
        const report = summarizeNetwork(entries.slice(9));
        expect(report.groups[0].example_keys).toEqual([
            'GET api.example.test/items#10', 'GET api.example.test/items#11', 'GET api.example.test/items#12',
        ]);
        const untrusted = summarizeNetwork([
            entry({ key: 'GET api.example.test/items?secret=PRIVATE_VALUE' }),
            entry({ key: 'GET api.example.test/items#01' }), entry({ key: 'GET api.example.test/items#1' }),
            entry({ key: 'unrelated' }), entry(),
        ]);
        expect(untrusted.groups[0].example_keys).toEqual(['GET api.example.test/items']);
    });

    it('uses actual GraphQL keys while keeping operations and hosts in separate groups', () => {
        const entries = assignKeys([
            entry({ url: 'https://x.test/i/api/graphql/query-id/UserTweets?v=1' }),
            entry({ url: 'https://x.test/i/api/graphql/query-id/UserTweets?v=2' }),
            entry({ url: 'https://x.test/i/api/graphql/query-id/UserProfile' }),
            entry({ url: 'https://other.test/graphql/UserTweets' }),
        ]);
        const report = summarizeNetwork(entries);
        expect(report.groups).toHaveLength(3);
        expect(report.groups[0].example_keys).toEqual(['UserTweets', 'UserTweets#2']);
        expect(report.groups.find((group) => group.origin === 'https://other.test')?.example_keys).toEqual(['UserTweets#3']);
    });

    it.each([
        ['requests', ['/many', '/failed', '/large', '/recent']],
        ['failures', ['/failed', '/large', '/many', '/recent']],
        ['size', ['/large', '/many', '/failed', '/recent']],
        ['recent', ['/recent', '/failed', '/large', '/many']],
    ] as const)('sorts by %s with deterministic identity ties', (sort, paths) => {
        const report = summarizeNetwork([
            entry({ url: 'https://a.test/many' }), entry({ url: 'https://a.test/many' }),
            entry({ url: 'https://a.test/failed', status: 500 }),
            entry({ url: 'https://a.test/large', size: 500 }),
            entry({ url: 'https://a.test/recent', timestamp: NOW + 1000, size: NaN }),
        ], { sort });
        expect(report.groups.map((group) => group.pathname)).toEqual(paths);
    });

    it('sorts missing times and sizes after known zero measurements', () => {
        const rows = [entry({ url: 'https://a.test/unknown', size: NaN, timestamp: undefined }), entry({ url: 'https://z.test/known', size: 0 })];
        for (const sort of ['size', 'recent'] as const) expect(summarizeNetwork(rows, { sort }).groups[0].origin).toBe('https://z.test');
    });

    it('paginates groups without changing totals and reports the exact next offset', () => {
        const entries = Array.from({ length: 5 }, (_, i) => entry({ url: `https://a.test/${i}`, status: 500 }));
        const page = summarizeNetwork(entries, { limit: 2, offset: 1 });
        expect(page.totals.requests).toBe(5);
        expect(page.totals.failed).toBe(5);
        expect(page.groups.map((group) => group.pathname)).toEqual(['/1', '/2']);
        expect(page.pagination).toEqual({ total_groups: 5, offset: 1, limit: 2, next_offset: 3 });
        expect(summarizeNetwork(entries, { limit: 2, offset: 3 }).pagination.next_offset).toBeNull();
        const empty = summarizeNetwork(entries, { offset: 10 });
        expect(empty.groups).toEqual([]);
        expect(empty.pagination.next_offset).toBeNull();
        expect(empty.totals.requests).toBe(5);
    });

    it('handles an empty capture without invented zeros for absent measurements', () => {
        const report = summarizeNetwork([]);
        expect(report.groups).toEqual([]);
        expect(report.totals.requests).toBe(0);
        expect(report.totals.failure_rate).toBeNull();
        expect(report.totals.response_size.total).toBeNull();
        expect(report.totals.observed.span_ms).toBeNull();
        expect(report.pagination.next_offset).toBeNull();
    });

    it('does not mutate entries or prototype state', () => {
        const entries = [Object.freeze(entry({ ct: '__proto__', method: '__proto__' }))];
        const before = JSON.stringify(entries);
        const report = summarizeNetwork(Object.freeze(entries));
        expect(JSON.stringify(entries)).toBe(before);
        expect(report.groups[0].methods).toEqual([{ value: '__PROTO__', count: 1 }]);
        expect(report.groups[0].content_types).toEqual([{ value: '__proto__', count: 1 }]);
        expect({}).not.toHaveProperty('count');
    });
});

describe('resolveNetworkSummaryOptions', () => {
    it('supplies stable defaults and accepts boundary values', () => {
        expect(resolveNetworkSummaryOptions()).toEqual({ groupBy: 'endpoint', sort: 'requests', offset: 0, limit: 20 });
        expect(resolveNetworkSummaryOptions({ groupBy: 'origin', sort: 'size', offset: Number.MAX_SAFE_INTEGER, limit: 500 }).limit).toBe(500);
    });
    it.each([
        { groupBy: 'path' }, { sort: 'status' }, { offset: -1 }, { offset: 1.5 }, { offset: Infinity },
        { offset: Number.MAX_SAFE_INTEGER + 1 }, { limit: 0 }, { limit: 501 }, { limit: 1.5 }, { limit: NaN },
    ])('rejects invalid options %j', (options) => {
        expect(() => summarizeNetwork([], options as NetworkSummaryOptions)).toThrow(ArgumentError);
    });
});
