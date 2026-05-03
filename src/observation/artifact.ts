import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ObservationEvent, ObservationExportResult, ObservationExportStatus, ObservationTraceReceipt } from './events.js';
import { ObservationSession } from './session.js';
import { redactValue } from './redaction.js';
import { CliError, getErrorMessage } from '../errors.js';

export interface ExportObservationOptions {
  baseDir?: string;
  error?: unknown;
  status?: ObservationExportStatus;
}

function baseOpenCliDir(): string {
  return process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli');
}

function safeSegment(value: string | undefined): string {
  const safe = (value || 'default').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return safe || 'default';
}

export function getTraceDirectory(contextId: string | undefined, traceId: string, baseDir: string = baseOpenCliDir()): string {
  return path.join(baseDir, 'profiles', safeSegment(contextId), 'traces', safeSegment(traceId));
}

export function exportObservationSession(session: ObservationSession, opts: ExportObservationOptions = {}): ObservationExportResult {
  const dir = getTraceDirectory(session.scope.contextId, session.id, opts.baseDir);
  const status = opts.status ?? (opts.error === undefined ? 'success' : 'failure');
  const createdAt = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });

  const originalEvents = session.events();
  const sanitizedEvents = originalEvents.map((event) => redactObservationEvent(event));
  const traceLines: string[] = [];
  const networkLines: string[] = [];
  const consoleLines: string[] = [];
  let screenshotIndex = 0;
  let stateIndex = 0;

  for (let i = 0; i < sanitizedEvents.length; i++) {
    const originalEvent = originalEvents[i];
    const event = sanitizedEvents[i];
    const serializable = { ...event } as Record<string, unknown>;
    if (event.stream === 'screenshot' && originalEvent.stream === 'screenshot' && typeof originalEvent.data === 'string') {
      const ext = event.format === 'jpeg' ? 'jpg' : 'png';
      const file = `screenshots/${String(++screenshotIndex).padStart(4, '0')}.${ext}`;
      fs.writeFileSync(path.join(dir, file), originalEvent.data, 'base64');
      serializable.path = file;
      delete serializable.data;
    }
    if (event.stream === 'state' && serializable.snapshot !== undefined) {
      const file = `state/${String(++stateIndex).padStart(4, '0')}.json`;
      fs.writeFileSync(path.join(dir, file), JSON.stringify(serializable.snapshot, null, 2), 'utf-8');
      serializable.snapshotPath = file;
      delete serializable.snapshot;
    }
    const line = JSON.stringify(serializable);
    traceLines.push(line);
    if (event.stream === 'network') networkLines.push(line);
    if (event.stream === 'console') consoleLines.push(line);
  }

  fs.writeFileSync(path.join(dir, 'trace.jsonl'), traceLines.join('\n') + (traceLines.length ? '\n' : ''), 'utf-8');
  fs.writeFileSync(path.join(dir, 'network.jsonl'), networkLines.join('\n') + (networkLines.length ? '\n' : ''), 'utf-8');
  fs.writeFileSync(path.join(dir, 'console.jsonl'), consoleLines.join('\n') + (consoleLines.length ? '\n' : ''), 'utf-8');

  const summaryPath = path.join(dir, 'summary.md');
  fs.writeFileSync(summaryPath, renderSummary(session, sanitizedEvents, {
    error: opts.error,
    status,
    dir,
    createdAt,
  }), 'utf-8');
  const receiptPath = path.join(dir, 'receipt.json');
  const resultBase = { traceId: session.id, dir, summaryPath, receiptPath };
  const receipt = buildTraceReceipt(resultBase, status, opts.error, {
    createdAt,
    scope: session.scope,
  });
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf-8');
  return { ...resultBase, receipt };
}

function redactObservationEvent(event: ObservationEvent): ObservationEvent {
  return redactValue(event) as ObservationEvent;
}

export function buildTraceReceipt(
  result: Pick<ObservationExportResult, 'traceId' | 'dir' | 'summaryPath' | 'receiptPath'>,
  status: ObservationExportStatus,
  error?: unknown,
  opts: { createdAt?: string; scope?: ObservationSession['scope'] } = {},
): ObservationTraceReceipt {
  const maybeCliError = error instanceof CliError ? error : undefined;
  return {
    traceId: result.traceId,
    traceDir: result.dir,
    summaryPath: result.summaryPath,
    receiptPath: result.receiptPath,
    status,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(error === undefined ? {} : {
      error: {
        ...(error instanceof Error ? { name: error.name } : {}),
        ...(maybeCliError ? { code: maybeCliError.code, hint: maybeCliError.hint, exitCode: maybeCliError.exitCode } : {}),
        message: String(redactValue(getErrorMessage(error))),
      },
    }),
  };
}

function renderSummary(
  session: ObservationSession,
  events: ObservationEvent[],
  opts: { error?: unknown; status: ObservationExportStatus; dir: string; createdAt: string },
): string {
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.stream] = (acc[event.stream] ?? 0) + 1;
    return acc;
  }, {});

  const error = serializeSummaryError(opts.error);
  const errorEvents = events.filter((event) => event.stream === 'error').slice(-20).reverse();
  const failedNetwork = events
    .filter((event): event is Extract<ObservationEvent, { stream: 'network' }> => event.stream === 'network')
    .filter((event) => event.status === undefined || event.status === 0 || event.status >= 400)
    .slice(-20)
    .reverse();
  const suspiciousConsole = events
    .filter((event): event is Extract<ObservationEvent, { stream: 'console' }> => event.stream === 'console')
    .filter((event) => /^(error|warning|warn|assert)$/i.test(event.level))
    .slice(-20)
    .reverse();
  const actions = events
    .filter((event): event is Extract<ObservationEvent, { stream: 'action' }> => event.stream === 'action')
    .slice(-30);

  const lines = [
    '---',
    `traceId: ${yamlScalar(session.id)}`,
    `status: ${opts.status}`,
    `contextId: ${yamlScalar(session.scope.contextId ?? 'default')}`,
    `workspace: ${yamlScalar(session.scope.workspace)}`,
    ...(session.scope.target ? [`target: ${yamlScalar(session.scope.target)}`] : []),
    ...(session.scope.site ? [`site: ${yamlScalar(session.scope.site)}`] : []),
    ...(session.scope.command ? [`command: ${yamlScalar(session.scope.command)}`] : []),
    ...(session.scope.adapterSourcePath ? [`adapterSourcePath: ${yamlScalar(session.scope.adapterSourcePath)}`] : []),
    ...(session.scope.adapterSourcePath ? [`adapterSourcePathExists: ${fs.existsSync(session.scope.adapterSourcePath)}`] : []),
    `traceDir: ${yamlScalar(opts.dir)}`,
    `startedAt: ${yamlScalar(new Date(session.startedAt).toISOString())}`,
    `exportedAt: ${yamlScalar(opts.createdAt)}`,
    ...(error ? [
      `errorCode: ${yamlScalar(error.code ?? 'UNKNOWN')}`,
      `errorMessage: ${yamlScalar(error.message)}`,
    ] : []),
    '---',
    '',
    '# OpenCLI Trace Summary',
    '',
    '## How To Use',
    '',
    '- Start with this summary, then inspect `trace.jsonl` only when the evidence below is insufficient.',
    '- For adapter repair policy and retry limits, use the `opencli-autofix` skill.',
    '- `adapterSourcePathExists: false` means the path is a best-effort hint, not a confirmed editable file.',
    '',
    '## Error',
    '',
    ...renderErrorSection(error, errorEvents),
    '',
    '## Failed Network',
    '',
    ...renderNetworkSection(failedNetwork),
    '',
    '## Suspicious Console',
    '',
    ...renderConsoleSection(suspiciousConsole),
    '',
    '## Action Timeline',
    '',
    ...renderActionSection(actions),
    '',
    '## Event Counts',
    '',
    ...Object.entries(counts).map(([stream, count]) => `- ${stream}: ${count}`),
    '',
    '## Artifact Files',
    '',
    '- `trace.jsonl`: full redacted event timeline',
    '- `network.jsonl`: redacted network events',
    '- `console.jsonl`: redacted console events',
    '- `state/`: final state snapshots when available',
    '- `screenshots/`: final screenshots when available',
    '',
  ];
  return lines.join('\n');
}

function serializeSummaryError(error: unknown): { code?: string; message: string; hint?: string } | undefined {
  if (error === undefined) return undefined;
  if (error instanceof CliError) {
    return {
      code: error.code,
      message: String(redactValue(error.message)),
      ...(error.hint ? { hint: String(redactValue(error.hint)) } : {}),
    };
  }
  return { message: String(redactValue(getErrorMessage(error))) };
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function renderErrorSection(
  error: { code?: string; message: string; hint?: string } | undefined,
  errorEvents: ObservationEvent[],
): string[] {
  const lines: string[] = [];
  if (error) {
    lines.push(`- ${error.code ?? 'UNKNOWN'}: ${error.message}`);
    if (error.hint) lines.push(`- hint: ${error.hint}`);
  }
  for (const event of errorEvents) {
    if (event.stream !== 'error') continue;
    lines.push(`- ${formatTs(event.ts)} ${event.code ?? 'ERROR'}: ${event.message}`);
  }
  return lines.length ? lines : ['- none'];
}

function renderNetworkSection(events: Extract<ObservationEvent, { stream: 'network' }>[]): string[] {
  if (!events.length) return ['- none'];
  return events.map((event) => {
    const status = event.status ?? 'unknown';
    const method = event.method ?? 'GET';
    const contentType = event.contentType ? ` ${event.contentType}` : '';
    return `- ${formatTs(event.ts)} ${status} ${method} ${event.url}${contentType}`;
  });
}

function renderConsoleSection(events: Extract<ObservationEvent, { stream: 'console' }>[]): string[] {
  if (!events.length) return ['- none'];
  return events.map((event) => `- ${formatTs(event.ts)} ${event.level}: ${trimLine(event.text, 240)}`);
}

function renderActionSection(events: Extract<ObservationEvent, { stream: 'action' }>[]): string[] {
  if (!events.length) return ['- none'];
  return events.map((event) => {
    const phase = event.phase ? ` ${event.phase}` : '';
    const data = event.data && Object.keys(event.data).length
      ? ` ${trimLine(JSON.stringify(redactValue(event.data)), 240)}`
      : '';
    return `- ${formatTs(event.ts)} ${event.name}${phase}${data}`;
  });
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString();
}

function trimLine(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}
