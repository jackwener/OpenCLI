import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../cli.js';
import { load as loadYaml } from 'js-yaml';
import { exportObservationSession } from '../observation/artifact.js';
import { ObservationSession } from '../observation/session.js';

async function invoke(args: string[]): Promise<void> {
  const originalArgv = process.argv;
  process.argv = ['node', 'opencli', ...args];
  try { await runCli('', ''); }
  finally { process.argv = originalArgv; }
}

describe('trace commands', () => {
  let baseDir: string;
  let stdout: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'opencli-trace-cli-'));
    vi.stubEnv('OPENCLI_CONFIG_DIR', baseDir);
    vi.stubEnv('OPENCLI_PROFILE', '');
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    rmSync(baseDir, { recursive: true, force: true });
  });

  function fixture(contextId = 'work', id = 'trace-one') {
    const session = new ObservationSession({ id, scope: { contextId, session: 'test', site: 'demo', command: 'demo/search' } });
    session.record({ stream: 'console', level: 'warn', text: 'test warning' });
    return exportObservationSession(session, { baseDir });
  }

  async function run(args: string[]) {
    stdout.mockClear();
    process.exitCode = undefined;
    await invoke(args);
    expect(stdout).toHaveBeenCalledTimes(1);
    return JSON.parse(stdout.mock.calls[0][0]);
  }

  it('returns one normal JSON envelope with list metadata and event pagination', async () => {
    fixture();
    expect(await run(['trace', 'list'])).toMatchObject({ ok: true, data: { total: 1, nextOffset: null, traces: [{ traceId: 'trace-one' }] } });
    expect(await run(['trace', 'show', 'trace-', '--issues', '--stream', 'console'])).toMatchObject({
      ok: true, data: { summary: { events: 1, issues: 1 }, selection: { stream: 'console', issues: true }, events: [{ stream: 'console' }] },
    });
  });

  it('resolves aliases from local configuration at every supported flag position', async () => {
    fixture('work');
    fixture('home');
    writeFileSync(join(baseDir, 'browser-profiles.json'), JSON.stringify({ version: 1, aliases: { office: 'work' }, defaultContextId: 'home' }));
    expect((await run(['trace', 'list'])).data.total).toBe(2);
    vi.stubEnv('OPENCLI_PROFILE', '   ');
    expect((await run(['trace', 'list'])).data.total).toBe(2);
    for (const args of [
      ['--profile', 'office', 'trace', 'list'], ['--profile=office', 'trace', 'list'],
      ['trace', '--profile', 'office', 'list'], ['trace', 'list', '--profile', 'office'],
    ]) {
      const result = await run(args);
      expect(result.data.traces.map((row: { contextId: string }) => row.contextId)).toEqual(['work']);
    }
    vi.stubEnv('OPENCLI_PROFILE', 'office');
    expect((await run(['trace', 'show', 'trace-one'])).data.trace.contextId).toBe('work');
    expect((await run(['trace', 'list', '--profile=home'])).data.traces[0].contextId).toBe('home');
  });

  it('reports ambiguous and absent traces using typed envelopes', async () => {
    fixture();
    fixture('home');
    expect(await run(['trace', 'show', 'trace-one'])).toMatchObject({ ok: false, error: { exitCode: 2 } });
    expect(process.exitCode).toBe(2);
    expect(await run(['trace', 'show', 'absent'])).toMatchObject({ ok: false, error: { code: 'TRACE_NOT_FOUND', exitCode: 66 } });
    expect(process.exitCode).toBe(66);
  });

  it.each([
    ['list', '--limit=0'], ['list', '--limit=2oops'], ['list', '--limit=1001'], ['list', '--offset=-1'],
    ['list', '--since=tomorrow'], ['list', '--status=pending'], ['show'], ['show', 'id', '--stream=unknown'],
    ['show', 'id', '--format=unsupported'], ['list', '--profile='], ['list', '--site='], ['unknown'],
  ])('rejects invalid command arguments %j', async (...args) => {
    expect(await run(['trace', ...args])).toMatchObject({ ok: false, error: { exitCode: 2 } });
    expect(process.exitCode).toBe(2);
  });

  it('keeps trace files and configuration unchanged', async () => {
    const exported = fixture();
    const before = readFileSync(join(exported.dir, 'trace.jsonl'), 'utf-8');
    const files = readdirSync(baseDir, { recursive: true });
    await run(['trace', 'list']);
    await run(['trace', 'show', 'trace-one', '--include-data']);
    expect(readFileSync(join(exported.dir, 'trace.jsonl'), 'utf-8')).toBe(before);
    expect(readdirSync(baseDir, { recursive: true })).toEqual(files);
  });

  it('keeps optional event payloads in CSV when the first event has no data', async () => {
    const session = new ObservationSession({ id: 'payloads', scope: { contextId: 'work', session: 'test' } });
    session.record({ stream: 'network', url: 'https://example.com/a', status: 0 });
    session.record({ stream: 'network', url: 'https://example.com/b', status: 500, responseBody: { message: 'visible payload' } });
    exportObservationSession(session, { baseDir });
    await invoke(['trace', 'show', 'payloads', '--include-data', '-f', 'csv']);
    const output = stdout.mock.calls.map((call: unknown[]) => call[0]).join('\n');
    expect(output).toContain('line,time,stream,issue,summary,data');
    expect(output).toContain('visible payload');
  });

  it('uses shared plain, CSV and YAML formats while keeping terminal labels safe', async () => {
    fixture('work', 'trace\nforged\u001b[31m');
    await invoke(['trace', 'list', '-f', 'plain']);
    const plain = stdout.mock.calls.map((call: unknown[]) => call[0]).join('\n');
    expect(plain).toContain('traceId: trace forged');
    expect(plain).not.toMatch(/\nforged|\u001b/);
    stdout.mockClear();
    await invoke(['trace', 'show', 'trace', '-f', 'csv']);
    expect(stdout.mock.calls.map((call: unknown[]) => call[0]).join('\n')).toContain('line,time,stream,issue,summary');
    stdout.mockClear();
    await invoke(['trace', 'show', 'trace', '-f', 'yml']);
    expect(loadYaml(stdout.mock.calls[0][0])).toMatchObject({ trace: { traceId: 'trace\nforged\u001b[31m' }, summary: { events: 1, issues: 1 } });
  });
});
