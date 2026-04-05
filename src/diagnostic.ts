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

// ── Size budgets ─────────────────────────────────────────────────────────────

/** Maximum bytes for the entire diagnostic JSON output. */
export const MAX_DIAGNOSTIC_BYTES = 256 * 1024; // 256 KB
/** Maximum characters for DOM snapshot. */
const MAX_SNAPSHOT_CHARS = 100_000;
/** Maximum characters for adapter source. */
const MAX_SOURCE_CHARS = 50_000;
/** Maximum number of network requests to include. */
const MAX_NETWORK_REQUESTS = 50;
/** Maximum characters for a single network request body. */
const MAX_REQUEST_BODY_CHARS = 4_000;
/** Maximum characters for error stack trace. */
const MAX_STACK_CHARS = 5_000;

// ── Sensitive data patterns ──────────────────────────────────────────────────

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-xsrf-token',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
]);

const SENSITIVE_URL_PARAMS = /([?&])(token|key|secret|password|auth|access_token|api_key|session_id|csrf)=[^&]*/gi;

/** Patterns that match inline secrets in free-text strings (error messages, stack traces, console output, DOM). */
const SENSITIVE_TEXT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]' },
  // Generic "token=...", "key=...", etc. in non-URL text
  { pattern: /(token|secret|password|api_key|apikey|access_token|session_id)[=:]\s*['"]?[A-Za-z0-9\-._~+/]{8,}['"]?/gi, replacement: '$1=[REDACTED]' },
  // Cookie header values (key=value pairs)
  { pattern: /(cookie[=:]\s*)[^\n;]{10,}/gi, replacement: '$1[REDACTED]' },
  // JWT-like tokens (three base64 segments separated by dots)
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED_JWT]' },
];

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
    consoleErrors: unknown[];
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
  return url.replace(SENSITIVE_URL_PARAMS, '$1$2=[REDACTED]');
}

/** Redact inline secrets from free-text strings (error messages, stack traces, console output, DOM). */
export function redactText(text: string): string {
  let result = text;
  for (const { pattern, replacement } of SENSITIVE_TEXT_PATTERNS) {
    // Reset lastIndex for global regexps
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Redact sensitive headers from a headers object. */
function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return headers;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return result;
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

  // Truncate response body
  if (typeof redacted.body === 'string') {
    redacted.body = truncate(redacted.body, MAX_REQUEST_BODY_CHARS);
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
 * 1. cmd.source (set for FS-scanned YAML/TS and manifest lazy-loaded TS)
 * 2. cmd._modulePath (set for manifest lazy-loaded TS, points to dist/)
 *
 * For dist/ paths, attempt to map back to the original .ts source file.
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
    // Try to map dist/ compiled JS back to source .ts
    const sourceTs = mapDistToSource(candidate);
    if (sourceTs && fs.existsSync(sourceTs)) return sourceTs;

    // Try the candidate directly (YAML files, user clis, etc.)
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0]; // Return best guess even if file doesn't exist
}

/** Map a dist/clis/xxx.js path back to clis/xxx.ts source. */
function mapDistToSource(filePath: string): string | null {
  // dist/clis/site/command.js → clis/site/command.ts
  const normalized = filePath.replace(/\\/g, '/');
  const distClisMatch = normalized.match(/^(.*)\/dist\/clis\/(.+)\.js$/);
  if (distClisMatch) {
    return path.join(distClisMatch[1], 'clis', distClisMatch[2] + '.ts');
  }
  return null;
}

// ── Diagnostic collection ────────────────────────────────────────────────────

/** Whether diagnostic mode is enabled. */
export function isDiagnosticEnabled(): boolean {
  return process.env.OPENCLI_DIAGNOSTIC === '1';
}

/** Safely collect page diagnostic state with redaction, size caps, and timeout. */
async function collectPageState(page: IPage): Promise<RepairContext['page'] | undefined> {
  const collect = async (): Promise<RepairContext['page'] | undefined> => {
    try {
      const [url, snapshot, networkRequests, consoleErrors] = await Promise.all([
        page.getCurrentUrl?.().catch(() => null) ?? Promise.resolve(null),
        page.snapshot().catch(() => '(snapshot unavailable)'),
        page.networkRequests().catch(() => []),
        page.consoleMessages('error').catch(() => []),
      ]);

      const rawUrl = url ?? 'unknown';
      return {
        url: redactUrl(rawUrl),
        snapshot: redactText(truncate(snapshot, MAX_SNAPSHOT_CHARS)),
        networkRequests: (networkRequests as unknown[])
          .slice(0, MAX_NETWORK_REQUESTS)
          .map(redactNetworkRequest),
        consoleErrors: (consoleErrors as unknown[])
          .slice(0, 50)
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
    return truncate(content, MAX_SOURCE_CHARS);
  } catch {
    return undefined;
  }
}

/** Build a RepairContext from an error, command metadata, and optional page state. */
export function buildRepairContext(
  err: unknown,
  cmd: InternalCliCommand,
  pageState?: RepairContext['page'],
): RepairContext {
  const isCliError = err instanceof CliError;
  const sourcePath = resolveAdapterSourcePath(cmd);
  return {
    error: {
      code: isCliError ? err.code : 'UNKNOWN',
      message: redactText(getErrorMessage(err)),
      hint: isCliError && err.hint ? redactText(err.hint) : undefined,
      stack: err instanceof Error ? redactText(truncate(err.stack ?? '', MAX_STACK_CHARS)) : undefined,
    },
    adapter: {
      site: cmd.site,
      command: fullName(cmd),
      sourcePath,
      source: readAdapterSource(sourcePath),
    },
    page: pageState,
    timestamp: new Date().toISOString(),
  };
}

/** Collect full diagnostic context including page state (with timeout). */
export async function collectDiagnostic(
  err: unknown,
  cmd: InternalCliCommand,
  page: IPage | null,
): Promise<RepairContext> {
  const pageState = page ? await collectPageState(page) : undefined;
  return buildRepairContext(err, cmd, pageState);
}

/** Emit diagnostic JSON to stderr, enforcing total size cap. */
export function emitDiagnostic(ctx: RepairContext): void {
  const marker = '___OPENCLI_DIAGNOSTIC___';
  let json = JSON.stringify(ctx);

  // Enforce total output budget — drop page state (largest section) first if over budget
  if (json.length > MAX_DIAGNOSTIC_BYTES && ctx.page) {
    const trimmed = { ...ctx, page: { ...ctx.page, snapshot: '[omitted: over size budget]', networkRequests: [] } };
    json = JSON.stringify(trimmed);
  }
  // If still over budget, drop page entirely
  if (json.length > MAX_DIAGNOSTIC_BYTES) {
    const minimal = { ...ctx, page: undefined };
    json = JSON.stringify(minimal);
  }

  process.stderr.write(`\n${marker}\n${json}\n${marker}\n`);
}
