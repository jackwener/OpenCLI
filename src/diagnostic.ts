/**
 * Structured diagnostic output for AI-driven adapter repair.
 *
 * When OPENCLI_DIAGNOSTIC=1, failed commands emit a JSON RepairContext to stderr
 * containing the error, adapter source, and browser state (DOM snapshot, network
 * requests, console errors). AI Agents consume this to diagnose and fix adapters.
 */

import * as fs from 'node:fs';
import type { IPage } from './types.js';
import { CliError, getErrorMessage } from './errors.js';
import type { InternalCliCommand } from './registry.js';
import { fullName } from './registry.js';

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

// ── Diagnostic collection ────────────────────────────────────────────────────

/** Whether diagnostic mode is enabled. */
export function isDiagnosticEnabled(): boolean {
  return process.env.OPENCLI_DIAGNOSTIC === '1';
}

function normalizeInterceptedRequests(interceptedRequests: unknown[]): unknown[] {
  return interceptedRequests.map(responseBody => ({
    source: 'interceptor',
    responseBody,
  }));
}

/** Safely collect page diagnostic state. Individual failures are swallowed. */
async function collectPageState(page: IPage): Promise<RepairContext['page'] | undefined> {
  try {
    const [url, snapshot, networkRequests, interceptedRequests, consoleErrors] = await Promise.all([
      page.getCurrentUrl?.().catch(() => null) ?? Promise.resolve(null),
      page.snapshot().catch(() => '(snapshot unavailable)'),
      page.networkRequests().catch(() => []),
      page.getInterceptedRequests().catch(() => []),
      page.consoleMessages('error').catch(() => []),
    ]);
    const capturedResponses = normalizeInterceptedRequests(interceptedRequests);
    return {
      url: url ?? 'unknown',
      snapshot,
      networkRequests: [...capturedResponses, ...networkRequests],
      consoleErrors,
    };
  } catch {
    return undefined;
  }
}

/** Read adapter source file content. */
function readAdapterSource(modulePath: string | undefined): string | undefined {
  if (!modulePath) return undefined;
  try {
    return fs.readFileSync(modulePath, 'utf-8');
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
  return {
    error: {
      code: isCliError ? err.code : 'UNKNOWN',
      message: getErrorMessage(err),
      hint: isCliError ? err.hint : undefined,
      stack: err instanceof Error ? err.stack : undefined,
    },
    adapter: {
      site: cmd.site,
      command: fullName(cmd),
      sourcePath: cmd._modulePath,
      source: readAdapterSource(cmd._modulePath),
    },
    page: pageState,
    timestamp: new Date().toISOString(),
  };
}

/** Collect full diagnostic context including page state. */
export async function collectDiagnostic(
  err: unknown,
  cmd: InternalCliCommand,
  page: IPage | null,
): Promise<RepairContext> {
  const pageState = page ? await collectPageState(page) : undefined;
  return buildRepairContext(err, cmd, pageState);
}

/** Emit diagnostic JSON to stderr. */
export function emitDiagnostic(ctx: RepairContext): void {
  const marker = '___OPENCLI_DIAGNOSTIC___';
  process.stderr.write(`\n${marker}\n${JSON.stringify(ctx)}\n${marker}\n`);
}
