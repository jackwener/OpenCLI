/** CLI wire format. Human-readable exports remain available through --format. */
import { toEnvelope, type ErrorEnvelope } from './errors.js';

export function emitResult(data: unknown): void {
  console.log(JSON.stringify({ ok: true, data: data ?? null }));
}

export function emitFailure(error: unknown, exitCode?: number): void {
  // Child CLI failures already carry a wire envelope, including trace locations.
  const wire = error as Partial<ErrorEnvelope> | null;
  const previous = wire?.ok === false && wire.error && typeof wire.error === 'object' ? wire : undefined;
  if (previous) error = previous.error;
  const envelope = toEnvelope(error);
  if (previous?.trace) envelope.trace = previous.trace;
  // Browser and target errors also carry actionable fields without extending CliError.
  if (error && typeof error === 'object') {
    const details = error as Record<string, unknown>;
    for (const key of ['code', 'message', 'hint', 'candidates', 'matches_n', 'details', 'expected', 'actual', 'available', 'available_keys', 'download']) {
      if (['code', 'message', 'hint'].includes(key) && typeof details[key] !== 'string') continue;
      if (details[key] !== undefined) (envelope.error as unknown as Record<string, unknown>)[key] = details[key];
    }
  }
  if (['command_result_unknown', 'command_lost', 'result_evicted', 'outcome_unknown', 'detached_mid_command', 'cdp_timeout'].includes(envelope.error.code)) {
    (envelope.error as unknown as Record<string, unknown>).outcome = 'unknown';
  }
  const details = envelope.error as unknown as Record<string, unknown>;
  if (envelope.error.help) { details.hint ??= envelope.error.help; delete envelope.error.help; }
  if (envelope.error.code === 'usage_error' || envelope.error.code.startsWith('commander.')) envelope.error.exitCode = 2;
  if (exitCode !== undefined) envelope.error.exitCode = exitCode;
  if (envelope.error.code === 'UNKNOWN' && envelope.error.exitCode === 2) envelope.error.code = 'usage_error';
  console.log(JSON.stringify(envelope));
  process.exitCode = envelope.error.exitCode || 1;
}
