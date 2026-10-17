import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitFailure, emitResult } from './command-output.js';
import { CliError } from './errors.js';
let output: ReturnType<typeof vi.spyOn>;
beforeEach(() => { output = vi.spyOn(console, 'log').mockImplementation(() => {}); process.exitCode = undefined; });
afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; });
const result = () => JSON.parse(output.mock.calls.at(-1)![0]);
describe('CLI result contract', () => {
  it.each([null, undefined, [], { nested: { ok: false } }, 'text'])('wraps success without interpreting business data: %s', data => {
    emitResult(data); expect(result()).toEqual({ ok: true, data: data ?? null });
    expect(output).toHaveBeenCalledTimes(1);
  });
  it('preserves recovery fields on target and network errors', () => {
    emitFailure({ code: 'option_not_found', message: 'Choose an option', available: ['A'], available_keys: ['key'], candidates: ['#a'], matches_n: 2 });
    expect(result()).toMatchObject({ ok: false, error: { code: 'option_not_found', available: ['A'], available_keys: ['key'], candidates: ['#a'], matches_n: 2 } });
    expect(process.exitCode).toBe(1);
  });
  it('preserves typed exit codes and emits hint once', () => {
    emitFailure(new CliError('ARGUMENT', 'Invalid argument', 'Read help', 2));
    expect(result().error).toMatchObject({ code: 'ARGUMENT', hint: 'Read help', exitCode: 2 });
    expect(result().error).not.toHaveProperty('help');
    expect(process.exitCode).toBe(2);
  });
  it('preserves trace locations when forwarding a child CLI failure', () => {
    const trace = { traceId: 'test', dir: '/tmp/test', summaryPath: '/tmp/test/summary.md', receiptPath: '/tmp/test/receipt.json', status: 'failed' };
    emitFailure({ ok: false, error: { code: 'ARGUMENT', message: 'Invalid input', hint: 'Use --help', exitCode: 2 }, trace });
    expect(result()).toMatchObject({ ok: false, error: { code: 'ARGUMENT', hint: 'Use --help', exitCode: 2 }, trace });
  });
  it('keeps malformed error codes from breaking serialization', () => {
    emitFailure({ code: 42, message: 'External adapter failure' });
    expect(result().error).toMatchObject({ code: 'UNKNOWN', message: 'External adapter failure' });
  });
  it('matches explicitly selected exit codes in the envelope', () => {
    emitFailure('Missing value', 2);
    expect(result().error).toMatchObject({ code: 'usage_error', exitCode: 2 });
    expect(process.exitCode).toBe(2);
  });
  it.each(['command_result_unknown', 'command_lost', 'result_evicted', 'outcome_unknown', 'detached_mid_command', 'cdp_timeout'])('marks unknown write outcomes: %s', code => {
    emitFailure({ code, message: 'Inspect state before retrying' });
    expect(result().error.outcome).toBe('unknown');
  });
});
