/**
 * Structured diagnostic output for AI-driven adapter repair.
 *
 * When OPENCLI_DIAGNOSTIC=1, failed commands emit a JSON RepairContext to stderr
 * containing the error, adapter source, and browser state (DOM snapshot, network
 * requests, console errors). AI Agents consume this to diagnose and fix adapters.
 *
 * Safety boundaries:
 * - Sensitive headers/cookies are redacted before emission
 * - Individual fields are capped to prevent unbounded output
 * - Network response bodies from authenticated requests are stripped
 * - Total output is capped to MAX_DIAGNOSTIC_BYTES
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IPage } from './types.js';
import { CliError, getErrorMessage } from './errors.js';
import type { InternalCliCommand } from './registry.js';
import { fullName } from './registry.js';
import type { ObservationExportResult } from './observation/index.js';
import {
  redactHeaders as redactObservationHeaders,
  redactText as redactObservationText,
  redactUrl as redactObservationUrl,
  redactValue as redactObservationValue,
} from './observation/redaction.js';

// ── Size budgets ─────────────────────────────────────────────────────────────

/** Maximum bytes for the entire diagnostic JSON output. */
export const MAX_DIAGNOSTIC_BYTES = 256 * 1024; // 256 KB
/** Maximum characters for any single diagnostic text field. */
const MAX_DIAGNOSTIC_FIELD_CHARS = 50_000;
/** Maximum entries to keep from diagnostic collections. */
const MAX_DIAGNOSTIC_COLLECTION_ITEMS = 50;

// ── Types ────────────────────────────────────────────────────────────────────

export interface RepairContext {
  error: {
    code: string;
    message: string;
    hint?: string;
    stack?: string;
  };
  adapter: {
    site: string;
    command: string;
    sourcePath?: string;
    source?: string;
  };
  page?: {
    url: string;
    snapshot: string;
    networkRequests: unknown[];
    capturedPayloads?: unknown[];
    consoleErrors: unknown[];
  };
  trace?: {
    traceId: string;
    dir: string;
    summaryPath: string;
  };
  timestamp: string;
}

// ── Redaction helpers ────────────────────────────────────────────────────────

/** Truncate a string to maxLen, appending a truncation marker. */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `\n...[truncated, ${str.length - maxLen} chars omitted]`;
}

/** Redact sensitive query parameters from a URL. */
export function redactUrl(url: string): string {
  return redactObservationUrl(url);
}

/** Redact inline secrets from free-text strings (error messages, stack traces, console output, DOM). */
export function redactText(text: string): string {
  return redactObservationText(text, { maxStringLength: MAX_DIAGNOSTIC_FIELD_CHARS });
}

/** Redact sensitive headers from a headers object. */
function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return headers;
  return redactObservationHeaders(headers, {
    maxStringLength: MAX_DIAGNOSTIC_FIELD_CHARS,
    maxArrayItems: MAX_DIAGNOSTIC_COLLECTION_ITEMS,
    maxObjectFields: MAX_DIAGNOSTIC_COLLECTION_ITEMS,
  }) as Record<string, string>;
}

/** Recursively sanitize arbitrary captured response content for diagnostic output. */
function sanitizeCapturedValue(value: unknown): unknown {
  return redactObservationValue(value, {
    maxStringLength: MAX_DIAGNOSTIC_FIELD_CHARS,
    maxArrayItems: MAX_DIAGNOSTIC_COLLECTION_ITEMS,
    maxObjectFields: MAX_DIAGNOSTIC_COLLECTION_ITEMS,
    maxDepth: 4,
  });
}

/** Redact sensitive data from a single network request entry. */
function redactNetworkRequest(req: unknown): unknown {
  if (!req || typeof req !== 'object') return req;
  const r = req as Record<string, unknown>;
  const redacted: Record<string, unknown> = { ...r };

  // Redact URL
  if (typeof redacted.url === 'string') {
    redacted.url = redactUrl(redacted.url);
  }

  // Redact headers
  if (redacted.headers && typeof redacted.headers === 'object') {
    redacted.headers = redactHeaders(redacted.headers as Record<string, string>);
  }
  if (redacted.requestHeaders && typeof redacted.requestHeaders === 'object') {
    redacted.requestHeaders = redactHeaders(redacted.requestHeaders as Record<string, string>);
  }
  if (redacted.responseHeaders && typeof redacted.responseHeaders === 'object') {
    redacted.responseHeaders = redactHeaders(redacted.responseHeaders as Record<string, string>);
  }

  // Redact and truncate response body
  if (typeof redacted.body === 'string') {
    redacted.body = redactText(truncate(redacted.body, MAX_DIAGNOSTIC_FIELD_CHARS));
  }
  if ('responseBody' in redacted) {
    redacted.responseBody = sanitizeCapturedValue(redacted.responseBody);
  }
  if ('responsePreview' in redacted) {
    redacted.responsePreview = sanitizeCapturedValue(redacted.responsePreview);
  }

  return redacted;
}

// ── Timeout helper ───────────────────────────────────────────────────────────

/** Timeout for page state collection (prevents hang when CDP connection is stuck). */
const PAGE_STATE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ── Source path resolution ───────────────────────────────────────────────────

/**
 * Resolve the editable source file path for an adapter.
 *
 * Priority:
 * 1. cmd.source (set for FS-scanned JS and manifest lazy-loaded JS)
 * 2. cmd._modulePath (set for manifest lazy-loaded JS)
 *
 * Skip manifest: prefixed pseudo-paths (YAML commands inlined in manifest).
 */
export function resolveAdapterSourcePath(cmd: InternalCliCommand): string | undefined {
  const candidates: string[] = [];

  // cmd.source may be a real file path or 'manifest:site/name'
  if (cmd.source && !cmd.source.startsWith('manifest:')) {
    candidates.push(cmd.source);
  }
  if (cmd._modulePath) {
    candidates.push(cmd._modulePath);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0]; // Return best guess even if file doesn't exist
}

// ── Diagnostic collection ────────────────────────────────────────────────────

/** Whether diagnostic mode is enabled. */
export function isDiagnosticEnabled(): boolean {
  return process.env.OPENCLI_DIAGNOSTIC === '1';
}

function normalizeInterceptedRequests(interceptedRequests: unknown[]): unknown[] {
  return interceptedRequests.slice(0, MAX_DIAGNOSTIC_COLLECTION_ITEMS).map(responseBody => ({
    source: 'interceptor',
    responseBody: sanitizeCapturedValue(responseBody),
  }));
}

/** Safely collect page diagnostic state with redaction, size caps, and timeout. */
async function collectPageState(page: IPage): Promise<RepairContext['page'] | undefined> {
  const collect = async (): Promise<RepairContext['page'] | undefined> => {
    try {
      const [url, snapshot, networkRequests, interceptedRequests, consoleErrors] = await Promise.all([
        page.getCurrentUrl?.().catch(() => null) ?? Promise.resolve(null),
        page.snapshot().catch(() => '(snapshot unavailable)'),
        page.networkRequests().catch(() => []),
        page.getInterceptedRequests().catch(() => []),
        page.consoleMessages('error').catch(() => []),
      ]);

      const rawUrl = url ?? 'unknown';
      const capturedResponses = normalizeInterceptedRequests(interceptedRequests as unknown[]);
      return {
        url: redactUrl(rawUrl),
        snapshot: redactText(truncate(snapshot, MAX_DIAGNOSTIC_FIELD_CHARS)),
        networkRequests: (networkRequests as unknown[])
          .slice(0, MAX_DIAGNOSTIC_COLLECTION_ITEMS)
          .map(redactNetworkRequest),
        capturedPayloads: capturedResponses,
        consoleErrors: (consoleErrors as unknown[])
          .slice(0, MAX_DIAGNOSTIC_COLLECTION_ITEMS)
          .map(e => typeof e === 'string' ? redactText(e) : e),
      };
    } catch {
      return undefined;
    }
  };

  return withTimeout(collect(), PAGE_STATE_TIMEOUT_MS, undefined);
}

/** Read adapter source file content with size cap. */
function readAdapterSource(sourcePath: string | undefined): string | undefined {
  if (!sourcePath) return undefined;
  try {
    const content = fs.readFileSync(sourcePath, 'utf-8');
    return truncate(content, MAX_DIAGNOSTIC_FIELD_CHARS);
  } catch {
    return undefined;
  }
}

/** Build a RepairContext from an error, command metadata, and optional page state. */
export function buildRepairContext(
  err: unknown,
  cmd: InternalCliCommand,
  pageState?: RepairContext['page'],
  trace?: ObservationExportResult,
): RepairContext {
  const isCliError = err instanceof CliError;
  const sourcePath = resolveAdapterSourcePath(cmd);
  return {
    error: {
      code: isCliError ? err.code : 'UNKNOWN',
      message: redactText(getErrorMessage(err)),
      hint: isCliError && err.hint ? redactText(err.hint) : undefined,
      stack: err instanceof Error ? redactText(truncate(err.stack ?? '', MAX_DIAGNOSTIC_FIELD_CHARS)) : undefined,
    },
    adapter: {
      site: cmd.site,
      command: fullName(cmd),
      sourcePath,
      source: readAdapterSource(sourcePath),
    },
    page: pageState,
    trace: trace ? {
      traceId: trace.traceId,
      dir: trace.dir,
      summaryPath: trace.summaryPath,
    } : undefined,
    timestamp: new Date().toISOString(),
  };
}

/** Collect full diagnostic context including page state (with timeout). */
export async function collectDiagnostic(
  err: unknown,
  cmd: InternalCliCommand,
  page: IPage | null,
  trace?: ObservationExportResult,
): Promise<RepairContext> {
  const pageState = page ? await collectPageState(page) : undefined;
  return buildRepairContext(err, cmd, pageState, trace);
}

/** Emit diagnostic JSON to stderr, enforcing total size cap. */
export function emitDiagnostic(ctx: RepairContext): void {
  const marker = '___OPENCLI_DIAGNOSTIC___';
  let json = JSON.stringify(ctx);

  // Enforce total output budget — drop page state (largest section) first if over budget
  if (json.length > MAX_DIAGNOSTIC_BYTES && ctx.page) {
    const trimmed = {
      ...ctx,
      page: {
        ...ctx.page,
        snapshot: '[omitted: over size budget]',
        networkRequests: [],
        capturedPayloads: [],
      },
    };
    json = JSON.stringify(trimmed);
  }
  // If still over budget, drop page entirely
  if (json.length > MAX_DIAGNOSTIC_BYTES) {
    const minimal = { ...ctx, page: undefined };
    json = JSON.stringify(minimal);
  }

  process.stderr.write(`\n${marker}\n${json}\n${marker}\n`);
}
