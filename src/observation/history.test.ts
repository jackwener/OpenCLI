import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportObservationSession } from './artifact.js';
import { ObservationSession } from './session.js';
import type { ObservationEventInput, ObservationExportStatus } from './events.js';
import { listTraceHistory, showTraceHistory } from './history.js';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');

describe('offline trace history', () => {
  let baseDir: string;
  beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'opencli-history-')); });
  afterEach(() => { rmSync(baseDir, { recursive: true, force: true }); });

  function fixture(id: string, options: {
    context?: string; createdAt?: string; status?: ObservationExportStatus; events?: ObservationEventInput[];
  } = {}) {
    const session = new ObservationSession({
      id, now: () => NOW,
      scope: { contextId: options.context ?? 'work', session: 'site:demo', site: 'demo', command: 'demo/search' },
    });
    for (const event of options.events ?? [{ stream: 'action', name: 'command', phase: 'start' }]) session.record(event);
    const exported = exportObservationSession(session, { baseDir, status: options.status ?? 'success' });
    const receipt = { ...exported.receipt, createdAt: options.createdAt ?? new Date(NOW).toISOString() };
    writeFileSync(exported.receiptPath, JSON.stringify(receipt));
    return exported;
  }

  it('returns empty pages for a missing store without creating directories', async () => {
    const missing = join(baseDir, 'missing');
    expect(await listTraceHistory({ baseDir: missing })).toMatchObject({ traces: [], total: 0, nextOffset: null, diagnostics: { scanned: 0, skipped: 0 } });
    expect(existsSync(missing)).toBe(false);
  });

  it('lists exported receipts across profiles in a stable order and paginates after filtering', async () => {
    fixture('a', { createdAt: '2026-11-04T10:00:00Z' });
    fixture('b', { context: 'home', status: 'failure' });
    fixture('c', { status: 'failure' });
    const first = await listTraceHistory({ baseDir, limit: 1 });
    expect(first.traces.map(row => row.traceId)).toEqual(['b']);
    expect(first).toMatchObject({ total: 3, offset: 0, limit: 1, nextOffset: 1 });
    expect((await listTraceHistory({ baseDir, offset: 1, limit: 1 })).traces[0].traceId).toBe('c');
    expect((await listTraceHistory({ baseDir, offset: 30 })).nextOffset).toBeNull();
    expect((await listTraceHistory({ baseDir, status: 'failure', limit: 1 })).total).toBe(2);
    expect((await listTraceHistory({ baseDir, contextId: 'work' })).traces.map(row => row.traceId)).toEqual(['c', 'a']);
  });

  it('filters exact command, site, and session metadata and validates recency', async () => {
    fixture('old', { createdAt: '2026-10-01T00:00:00Z' });
    fixture('new');
    const filtered = await listTraceHistory({ baseDir, now: NOW, since: '24h', site: 'demo', command: 'demo/search', session: 'site:demo' });
    expect(filtered.traces.map(row => row.traceId)).toEqual(['new']);
    expect((await listTraceHistory({ baseDir, now: NOW, since: '30s' })).total).toBe(1);
    expect((await listTraceHistory({ baseDir, command: 'search' })).total).toBe(0);
    expect((await listTraceHistory({ baseDir, site: 'other' })).total).toBe(0);
    expect((await listTraceHistory({ baseDir, session: 'other' })).total).toBe(0);
    for (const since of ['yesterday', '2026-11-05', 'NaN', '7d', '2.5d', '999999999999999999999h']) {
      await expect(listTraceHistory({ baseDir, since })).rejects.toMatchObject({ code: 'ARGUMENT', exitCode: 2 });
    }
  });

  it('reads older receipts without optional fields and keeps expiry advisory', async () => {
    const exported = fixture('old');
    writeFileSync(exported.receiptPath, JSON.stringify({ schemaVersion: 1, traceId: 'old', status: 'success', createdAt: '2020-01-01', expiresAt: '2020-01-08' }));
    const report = await listTraceHistory({ baseDir, now: NOW });
    expect(report.traces[0]).toMatchObject({ expired: true, site: null, command: null, error: null, opencliVersion: null });
    expect(existsSync(exported.dir)).toBe(true);
    writeFileSync(exported.receiptPath, JSON.stringify({ schemaVersion: 1, traceId: 'old', status: 'success', createdAt: '2020-01-01' }));
    expect((await listTraceHistory({ baseDir, now: NOW })).traces[0].expired).toBeNull();
  });

  it('reports incomplete, invalid, oversized and unsupported receipts as skipped', async () => {
    fixture('valid');
    for (const [id, content] of [
      ['invalid', '{'], ['unsupported', JSON.stringify({ schemaVersion: 2 })],
      ['large', ' '.repeat(1024 * 1024 + 1)], ['bad-time', JSON.stringify({ schemaVersion: 1, traceId: 'bad-time', status: 'success', createdAt: 'bad' })],
    ]) {
      const dir = join(baseDir, 'profiles', 'work', 'traces', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'receipt.json'), content);
    }
    mkdirSync(join(baseDir, 'profiles', 'work', 'traces', 'partial'));
    const report = await listTraceHistory({ baseDir });
    expect(report.traces.map(row => row.traceId)).toEqual(['valid']);
    expect(report.diagnostics).toEqual({ scanned: 6, skipped: 5 });
  });

  it('prefers exact IDs over prefixes and fails for ambiguity across profiles', async () => {
    fixture('trace');
    fixture('trace-long');
    expect((await showTraceHistory('trace', { baseDir })).trace.traceId).toBe('trace');
    expect((await showTraceHistory('trace-l', { baseDir })).trace.traceId).toBe('trace-long');
    await expect(showTraceHistory('tr', { baseDir })).rejects.toMatchObject({ exitCode: 2 });
    fixture('trace', { context: 'home' });
    await expect(showTraceHistory('trace', { baseDir })).rejects.toMatchObject({ exitCode: 2 });
    expect((await showTraceHistory('trace', { baseDir, contextId: 'home' })).trace.contextId).toBe('home');
    await expect(showTraceHistory('missing', { baseDir })).rejects.toMatchObject({ code: 'TRACE_NOT_FOUND', exitCode: 66 });
  });

  it('normalizes stored context names the same way as the exporter', async () => {
    fixture('context', { context: 'work:profile/one' });
    expect((await listTraceHistory({ baseDir, contextId: 'work:profile/one' })).traces[0].contextId).toBe('work_profile_one');
  });

  it('shows all exported streams and counts issues before stream filtering and pagination', async () => {
    const exported = fixture('events', { status: 'failure', events: [
      { stream: 'action', name: 'command', phase: 'start', ts: NOW - 5000 },
      { stream: 'network', url: 'https://example.com/data', status: 200 },
      { stream: 'network', url: 'https://example.com/failed', status: 503 },
      { stream: 'console', level: 'warning', text: 'retrying' },
      { stream: 'state', snapshot: { text: 'state body' } },
      { stream: 'screenshot', format: 'png', data: Buffer.from('image body').toString('base64') },
      { stream: 'error', code: 'TEST', message: 'failure' },
      { stream: 'action', name: 'command', phase: 'error' },
    ] });
    const before = readFileSync(join(exported.dir, 'trace.jsonl'), 'utf-8');
    const report = await showTraceHistory('events', { baseDir, stream: 'network', limit: 1 });
    expect(report.summary).toMatchObject({ events: 8, issues: 4, streams: { action: 2, network: 2, console: 1, screenshot: 1, state: 1, error: 1 }, firstEventAt: new Date(NOW - 5000).toISOString() });
    expect(report.selection).toMatchObject({ total: 2, nextOffset: 1 });
    expect(report.events[0].summary.status).toBe(200);
    const failed = await showTraceHistory('events', { baseDir, stream: 'network', issues: true });
    expect(failed.events).toHaveLength(1);
    expect(failed.events[0].summary.status).toBe(503);
    expect(failed.summary.events).toBe(8);
    const all = await showTraceHistory('events', { baseDir });
    expect(all.events.find(event => event.stream === 'state')?.summary.snapshotPath).toBe('state/0001.json');
    expect(all.events.find(event => event.stream === 'screenshot')?.summary.path).toBe('screenshots/0001.png');
    expect(JSON.stringify(all)).not.toMatch(/image body|state body/);
    expect(readFileSync(join(exported.dir, 'trace.jsonl'), 'utf-8')).toBe(before);
  });

  it('redacts legacy event payloads on read and includes data only on explicit request', async () => {
    const exported = fixture('redacted');
    writeFileSync(join(exported.dir, 'trace.jsonl'), JSON.stringify({
      id: 'network', ts: NOW, stream: 'network', url: 'https://example.com?token=URL_SECRET', status: 500,
      requestHeaders: { authorization: 'Bearer HEADER_SECRET', accept: 'application/json' },
      requestBody: { password: 'BODY_SECRET', query: 'visible' }, responseBody: { token: 'RESPONSE_SECRET' },
    }) + '\n');
    const brief = await showTraceHistory('redacted', { baseDir });
    expect(brief.events[0].data).toBeUndefined();
    expect(JSON.stringify(brief)).not.toMatch(/URL_SECRET|HEADER_SECRET|BODY_SECRET|RESPONSE_SECRET/);
    const detailed = await showTraceHistory('redacted', { baseDir, includeData: true });
    expect(detailed.events[0].data).toMatchObject({ requestHeaders: { authorization: '[REDACTED]' }, requestBody: { password: '[REDACTED]', query: 'visible' } });
    expect(JSON.stringify(detailed)).not.toMatch(/URL_SECRET|HEADER_SECRET|BODY_SECRET|RESPONSE_SECRET/);
  });

  it('classifies issue events using explicit status and severity', async () => {
    const exported = fixture('issues', { events: [
      { stream: 'network', url: 'https://example.com/a', status: 0 },
      { stream: 'network', url: 'https://example.com/b' },
      { stream: 'network', url: 'https://example.com/c', status: 200, responseBody: 'error' },
      { stream: 'console', level: 'log', text: 'error is quoted text' },
      { stream: 'console', level: 'ASSERT', text: 'failed' },
    ] });
    const report = await showTraceHistory('issues', { baseDir, issues: true });
    expect(report.events.map(event => event.stream)).toEqual(['network', 'network', 'console']);
    expect(report.summary.issues).toBe(3);
    const markdown = readFileSync(exported.summaryPath, 'utf-8');
    expect(markdown).toContain('https://example.com/a');
    expect(markdown).toContain('https://example.com/b');
    expect(markdown).not.toContain('https://example.com/c');
  });

  it('retains line numbers and diagnostic counts for damaged or future records', async () => {
    const exported = fixture('damaged', { events: [] });
    writeFileSync(join(exported.dir, 'trace.jsonl'), [
      '{broken', '', JSON.stringify({ id: 'a', ts: NOW, stream: 'future' }),
      JSON.stringify({ id: 'b', ts: 'bad', stream: 'action', name: 'run' }),
      JSON.stringify({ id: 'c', ts: NOW, stream: 'console', level: 'info', text: 'x'.repeat(1024 * 1024) }),
      JSON.stringify({ id: 'd', ts: NOW, stream: 'error', message: 'visible' }), '{"partial":',
    ].join('\n'));
    const report = await showTraceHistory('damaged', { baseDir });
    expect(report.diagnostics).toEqual({ malformedRecords: 2, unsupportedEvents: 2, oversizedRecords: 1 });
    expect(report.events).toHaveLength(1);
    expect(report.events[0].line).toBe(6);
  });

  it('reports an empty export and rejects missing or oversized event files', async () => {
    const exported = fixture('empty', { events: [] });
    const file = join(exported.dir, 'trace.jsonl');
    expect((await showTraceHistory('empty', { baseDir })).summary.events).toBe(0);
    truncateSync(file, 64 * 1024 * 1024 + 1);
    await expect(showTraceHistory('empty', { baseDir })).rejects.toMatchObject({ code: 'TRACE_TOO_LARGE' });
    unlinkSync(file);
    await expect(showTraceHistory('empty', { baseDir })).rejects.toMatchObject({ code: 'TRACE_READ' });
  });

  it('ignores receipt-supplied absolute paths and rejects escaping artifact references', async () => {
    const exported = fixture('paths');
    writeFileSync(exported.receiptPath, JSON.stringify({ ...exported.receipt, traceDir: '/outside', summaryPath: '/outside', receiptPath: '/outside' }));
    writeFileSync(join(exported.dir, 'trace.jsonl'), [
      { id: '1', ts: NOW, stream: 'state', snapshotPath: 'state/../../outside' },
      { id: '2', ts: NOW, stream: 'screenshot', path: '/outside', data: 'PRIVATE_INLINE_IMAGE' },
      { id: '3', ts: NOW, stream: 'screenshot', path: 'screenshots/..\\outside' },
    ].map(event => JSON.stringify(event)).join('\n'));
    const report = await showTraceHistory('paths', { baseDir, includeData: true });
    expect(report.events[0].summary.snapshotPath).toBeNull();
    expect(report.events.slice(1).map(event => event.summary.path)).toEqual([null, null]);
    expect(JSON.stringify(report)).not.toMatch(/outside|PRIVATE_INLINE_IMAGE/);
  });

  it.skipIf(process.platform === 'win32')('skips symlinked histories and receipts and refuses event-file symlinks', async () => {
    const exported = fixture('links');
    const traces = join(baseDir, 'profiles', 'work', 'traces');
    symlinkSync(exported.dir, join(traces, 'linked-dir'));
    symlinkSync(join(baseDir, 'profiles', 'work'), join(baseDir, 'profiles', 'linked-profile'));
    mkdirSync(join(traces, 'linked-receipt'));
    symlinkSync(exported.receiptPath, join(traces, 'linked-receipt', 'receipt.json'));
    const list = await listTraceHistory({ baseDir });
    expect(list.total).toBe(1);
    expect(list.diagnostics.skipped).toBe(1);
    unlinkSync(join(exported.dir, 'trace.jsonl'));
    symlinkSync(exported.receiptPath, join(exported.dir, 'trace.jsonl'));
    await expect(showTraceHistory('links', { baseDir })).rejects.toMatchObject({ code: 'TRACE_READ' });
  });

  it('counts the entire trace while retaining only the requested event page', async () => {
    const exported = fixture('paged', { events: [] });
    const records = Array.from({ length: 1200 }, (_, i) => JSON.stringify({ id: String(i), ts: NOW + i, stream: 'action', name: 'run' }));
    appendFileSync(join(exported.dir, 'trace.jsonl'), records.join('\n'));
    const report = await showTraceHistory('paged', { baseDir, offset: 1100, limit: 10 });
    expect(report.summary.events).toBe(1200);
    expect(report.events).toHaveLength(10);
    expect(report.events[0].id).toBe('1100');
    expect(report.selection.nextOffset).toBe(1110);
  });

  it.each([{ limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { offset: -1 }, { offset: Infinity }])('rejects invalid pagination %j', async options => {
    await expect(listTraceHistory({ baseDir, ...options })).rejects.toMatchObject({ exitCode: 2 });
    await expect(showTraceHistory('missing', { baseDir, ...options })).rejects.toMatchObject({ exitCode: 2 });
  });
});
