import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { ArgumentError, CliError, EXIT_CODES } from '../errors.js';
import type { ObservationExportStatus, ObservationStream } from './events.js';
import { redactText, redactUrl, redactValue } from './redaction.js';

export const TRACE_STREAMS: ObservationStream[] = ['action', 'network', 'console', 'screenshot', 'state', 'error'];
const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_TRACE_BYTES = 64 * 1024 * 1024;
const MAX_EVENT_BYTES = 1024 * 1024;

interface HistoryOptions {
  baseDir?: string;
  contextId?: string;
  limit?: number;
  offset?: number;
  now?: number;
}

export interface TraceListOptions extends HistoryOptions {
  status?: ObservationExportStatus;
  site?: string;
  command?: string;
  session?: string;
  since?: string;
}

export interface TraceShowOptions extends HistoryOptions {
  stream?: ObservationStream;
  issues?: boolean;
  includeData?: boolean;
}

export interface TraceHistoryEntry {
  traceId: string;
  contextId: string;
  status: ObservationExportStatus;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean | null;
  opencliVersion: string | null;
  site: string | null;
  command: string | null;
  session: string | null;
  error: { code: string | null; message: string } | null;
}

interface TraceCandidate {
  dir: string;
  entry: TraceHistoryEntry;
}

interface HistoryDiagnostics {
  scanned: number;
  skipped: number;
}

export interface TraceListReport {
  schemaVersion: 1;
  traces: TraceHistoryEntry[];
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  diagnostics: HistoryDiagnostics;
}

export interface TraceHistoryEvent {
  line: number;
  id: string;
  ts: number;
  stream: ObservationStream;
  issue: boolean;
  summary: Record<string, unknown>;
  data?: unknown;
}

export interface TraceShowReport {
  schemaVersion: 1;
  trace: TraceHistoryEntry;
  summary: {
    events: number;
    issues: number;
    streams: Record<ObservationStream, number>;
    firstEventAt: string | null;
    lastEventAt: string | null;
  };
  events: TraceHistoryEvent[];
  selection: { stream: ObservationStream | null; issues: boolean; includeData: boolean; total: number; offset: number; limit: number; nextOffset: number | null };
  diagnostics: { malformedRecords: number; unsupportedEvents: number; oversizedRecords: number };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function safeText(value: unknown): string | null {
  const text = string(value);
  return text === null ? null : redactText(text, { maxStringLength: 2000 });
}

function timestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function pagination(options: HistoryOptions, defaultLimit: number): { limit: number; offset: number } {
  const limit = options.limit ?? defaultLimit;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ArgumentError('--limit must be an integer between 1 and 1000.');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ArgumentError('--offset must be a non-negative safe integer.');
  return { limit, offset };
}

function cutoff(value: string | undefined, now: number): number | null {
  if (value === undefined) return null;
  const duration = /^(\d+)([mhdw])$/.exec(value);
  if (duration) {
    const units: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
    const ms = Number(duration[1]) * units[duration[2]];
    if (Number.isSafeInteger(ms) && Math.abs(now - ms) <= 8.64e15) return now - ms;
  } else if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value))) {
    return Date.parse(value);
  }
  throw new ArgumentError('--since must be a duration such as 24h or 7d, or an ISO date.');
}

async function directories(dir: string): Promise<string[]> {
  try {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return [];
    return (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new CliError('TRACE_READ', `Cannot read trace history directory ${dir}.`, 'Check the directory permissions.');
  }
}

async function openArtifact(file: string, maxBytes: number) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new CliError('TRACE_READ', 'Trace artifacts must be regular files.');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new CliError('TRACE_READ', 'Trace artifacts must be regular files.');
    if (info.size > maxBytes) throw new CliError('TRACE_TOO_LARGE', `Trace artifact exceeds the ${maxBytes} byte inspection limit.`);
    return { handle, size: info.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readReceipt(dir: string, contextId: string, now: number): Promise<TraceHistoryEntry | null> {
  const { handle, size } = await openArtifact(path.join(dir, 'receipt.json'), MAX_RECEIPT_BYTES);
  try {
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const receipt = object(JSON.parse(buffer.subarray(0, offset).toString('utf-8')));
    const traceId = string(receipt?.traceId);
    const createdAt = timestamp(receipt?.createdAt);
    if (receipt?.schemaVersion !== 1 || !traceId || !createdAt || !['success', 'failure'].includes(String(receipt.status))) return null;
    const scope = object(receipt.scope);
    const error = object(receipt.error);
    const expiresAt = timestamp(receipt.expiresAt);
    return {
      traceId, contextId, status: receipt.status as ObservationExportStatus, createdAt, expiresAt,
      expired: expiresAt === null ? null : Date.parse(expiresAt) <= now,
      opencliVersion: safeText(receipt.opencliVersion), site: safeText(scope?.site),
      command: safeText(scope?.command), session: safeText(scope?.session),
      error: error ? { code: safeText(error.code), message: safeText(error.message) ?? '' } : null,
    };
  } finally {
    await handle.close();
  }
}

async function discoverTraces(options: HistoryOptions): Promise<{ candidates: TraceCandidate[]; diagnostics: HistoryDiagnostics }> {
  const base = options.baseDir ?? (process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli'));
  const profiles = path.join(base, 'profiles');
  const context = options.contextId?.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const candidates: TraceCandidate[] = [];
  const diagnostics = { scanned: 0, skipped: 0 };
  for (const profile of await directories(profiles)) {
    if (context !== undefined && profile !== context) continue;
    const traces = path.join(profiles, profile, 'traces');
    for (const name of await directories(traces)) {
      diagnostics.scanned++;
      const dir = path.join(traces, name);
      // Retention may remove a directory between discovery and opening its receipt.
      let entry: TraceHistoryEntry | null = null;
      try { entry = await readReceipt(dir, profile, options.now ?? Date.now()); } catch { /* Count unreadable or incomplete receipts below. */ }
      if (entry) candidates.push({ dir, entry });
      else diagnostics.skipped++;
    }
  }
  return { candidates, diagnostics };
}

export async function listTraceHistory(options: TraceListOptions = {}): Promise<TraceListReport> {
  const { limit, offset } = pagination(options, 20);
  if (options.status !== undefined && options.status !== 'success' && options.status !== 'failure') throw new ArgumentError('--status must be success or failure.');
  const since = cutoff(options.since, options.now ?? Date.now());
  const { candidates, diagnostics } = await discoverTraces(options);
  const matches = candidates.map(candidate => candidate.entry).filter(entry =>
    (options.status === undefined || entry.status === options.status)
    && (options.site === undefined || entry.site === options.site)
    && (options.command === undefined || entry.command === options.command)
    && (options.session === undefined || entry.session === options.session)
    && (since === null || Date.parse(entry.createdAt) >= since));
  matches.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    || a.traceId.localeCompare(b.traceId) || a.contextId.localeCompare(b.contextId));
  const traces = matches.slice(offset, offset + limit);
  return { schemaVersion: 1, traces, total: matches.length, offset, limit, nextOffset: offset + traces.length < matches.length ? offset + traces.length : null, diagnostics };
}

function artifactReference(value: unknown, prefix: string): string | null {
  if (typeof value !== 'string' || !value.startsWith(`${prefix}/`) || /[\\\u0000-\u001f]/.test(value)) return null;
  return value.split('/').some(segment => segment === '..' || segment === '.') ? null : value;
}

function projectEvent(record: Record<string, unknown>, line: number, includeData: boolean): TraceHistoryEvent | null {
  if (!TRACE_STREAMS.includes(record.stream as ObservationStream) || !string(record.id)
    || typeof record.ts !== 'number' || !Number.isFinite(record.ts) || Math.abs(record.ts) > 8.64e15) return null;
  const stream = record.stream as ObservationStream;
  let summary: Record<string, unknown>;
  let issue = false;
  switch (stream) {
    case 'action':
      if (!string(record.name)) return null;
      summary = { name: safeText(record.name), phase: safeText(record.phase) };
      issue = record.phase === 'error';
      break;
    case 'network':
      if (!string(record.url)) return null;
      summary = {
        url: redactUrl(record.url as string), method: safeText(record.method),
        status: typeof record.status === 'number' && Number.isInteger(record.status) && record.status >= 0 && record.status <= 599 ? record.status : null,
        contentType: safeText(record.contentType),
        size: typeof record.size === 'number' && Number.isSafeInteger(record.size) && record.size >= 0 ? record.size : null,
      };
      issue = summary.status === 0 || (typeof summary.status === 'number' && summary.status >= 400);
      break;
    case 'console':
      if (typeof record.text !== 'string') return null;
      summary = { level: safeText(record.level), text: safeText(record.text) ?? '' };
      issue = /^(error|warning|warn|assert)$/i.test(String(record.level));
      break;
    case 'error':
      if (typeof record.message !== 'string') return null;
      summary = { code: safeText(record.code), message: safeText(record.message) ?? '', hint: safeText(record.hint) };
      issue = true;
      break;
    case 'screenshot':
      summary = { format: safeText(record.format), label: safeText(record.label), path: artifactReference(record.path, 'screenshots') };
      break;
    case 'state':
      summary = { url: typeof record.url === 'string' ? redactUrl(record.url) : null, label: safeText(record.label), snapshotPath: artifactReference(record.snapshotPath, 'state') };
      break;
  }
  const event: TraceHistoryEvent = { line, id: safeText(record.id)!, ts: record.ts, stream, issue, summary };
  if (includeData) {
    const fields = ['data', 'requestHeaders', 'responseHeaders', 'requestBody', 'responseBody', 'snapshot', 'stack'];
    const data = Object.fromEntries(fields.filter(key => Object.hasOwn(record, key) && stream !== 'screenshot').map(key => [key, record[key]]));
    if (Object.keys(data).length) event.data = redactValue(data);
  }
  return event;
}

export async function showTraceHistory(selector: string, options: TraceShowOptions = {}): Promise<TraceShowReport> {
  const { limit, offset } = pagination(options, 100);
  if (!selector.trim()) throw new ArgumentError('A trace id or unique prefix is required.');
  if (options.stream !== undefined && !TRACE_STREAMS.includes(options.stream)) throw new ArgumentError(`--stream must be one of ${TRACE_STREAMS.join(', ')}.`);
  const { candidates } = await discoverTraces(options);
  const exact = candidates.filter(candidate => candidate.entry.traceId === selector);
  const matches = exact.length ? exact : candidates.filter(candidate => candidate.entry.traceId.startsWith(selector));
  if (!matches.length) throw new CliError('TRACE_NOT_FOUND', `No local trace matches ${selector}.`, 'Run opencli trace list to inspect available traces and skipped receipts.', EXIT_CODES.EMPTY_RESULT);
  if (matches.length > 1) throw new ArgumentError(`Multiple traces match ${selector}.`, 'Use a complete trace id and --profile to select one stored profile.');
  const selected = matches[0];
  const report: TraceShowReport = {
    schemaVersion: 1, trace: selected.entry,
    summary: { events: 0, issues: 0, streams: { action: 0, network: 0, console: 0, screenshot: 0, state: 0, error: 0 }, firstEventAt: null, lastEventAt: null },
    events: [],
    selection: { stream: options.stream ?? null, issues: options.issues ?? false, includeData: options.includeData ?? false, total: 0, offset, limit, nextOffset: null },
    diagnostics: { malformedRecords: 0, unsupportedEvents: 0, oversizedRecords: 0 },
  };
  let file: Awaited<ReturnType<typeof openArtifact>>;
  try { file = await openArtifact(path.join(selected.dir, 'trace.jsonl'), MAX_TRACE_BYTES); }
  catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('TRACE_READ', 'Cannot open the selected trace events.', 'The export may be incomplete or removed by retention. Run opencli trace list again.');
  }
  try {
    if (file.size === 0) return report;
    const input = file.handle.createReadStream({ encoding: 'utf-8', end: file.size - 1, autoClose: false });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const line of lines) {
        lineNumber++;
        if (!line.trim()) continue;
        if (Buffer.byteLength(line, 'utf-8') > MAX_EVENT_BYTES) { report.diagnostics.oversizedRecords++; continue; }
        let record: Record<string, unknown> | null = null;
        try { record = object(JSON.parse(line)); } catch { /* Account for partially written or malformed JSONL below. */ }
        if (!record) { report.diagnostics.malformedRecords++; continue; }
        const event = projectEvent(record, lineNumber, options.includeData ?? false);
        if (!event) { report.diagnostics.unsupportedEvents++; continue; }
        report.summary.events++;
        report.summary.streams[event.stream]++;
        if (event.issue) report.summary.issues++;
        const at = new Date(event.ts).toISOString();
        if (report.summary.firstEventAt === null || event.ts < Date.parse(report.summary.firstEventAt)) report.summary.firstEventAt = at;
        if (report.summary.lastEventAt === null || event.ts > Date.parse(report.summary.lastEventAt)) report.summary.lastEventAt = at;
        if (options.stream !== undefined && event.stream !== options.stream) continue;
        if (options.issues && !event.issue) continue;
        if (report.selection.total >= offset && report.events.length < limit) report.events.push(event);
        report.selection.total++;
      }
    } finally {
      lines.close();
      input.destroy();
    }
  } finally {
    await file.handle.close();
  }
  if (offset + report.events.length < report.selection.total) report.selection.nextOffset = offset + report.events.length;
  return report;
}
