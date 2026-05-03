import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ObservationEvent, ObservationExportResult } from './events.js';
import { ObservationSession } from './session.js';
import { redactValue } from './redaction.js';

export interface ExportObservationOptions {
  baseDir?: string;
  error?: unknown;
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
  fs.writeFileSync(summaryPath, renderSummary(session, sanitizedEvents, opts.error), 'utf-8');
  return { traceId: session.id, dir, summaryPath };
}

function redactObservationEvent(event: ObservationEvent): ObservationEvent {
  return redactValue(event) as ObservationEvent;
}

function renderSummary(session: ObservationSession, events: ObservationEvent[], error: unknown): string {
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.stream] = (acc[event.stream] ?? 0) + 1;
    return acc;
  }, {});
  const errorMessage = error instanceof Error ? error.message : (error === undefined ? undefined : String(error));
  const lines = [
    '# OpenCLI Trace',
    '',
    `- traceId: ${session.id}`,
    `- contextId: ${session.scope.contextId ?? 'default'}`,
    `- workspace: ${session.scope.workspace}`,
    ...(session.scope.target ? [`- target: ${session.scope.target}`] : []),
    ...(session.scope.site ? [`- site: ${session.scope.site}`] : []),
    ...(session.scope.command ? [`- command: ${session.scope.command}`] : []),
    `- startedAt: ${new Date(session.startedAt).toISOString()}`,
    `- exportedAt: ${new Date().toISOString()}`,
    ...(errorMessage ? [`- error: ${String(redactValue(errorMessage))}`] : []),
    '',
    '## Event Counts',
    '',
    ...Object.entries(counts).map(([stream, count]) => `- ${stream}: ${count}`),
    '',
  ];
  return lines.join('\n');
}
