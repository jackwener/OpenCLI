import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTraceCli } from './trace.js';
import { isTraceInvocation } from '../cli-argv-preprocess.js';
import { exportObservationSession } from '../observation/artifact.js';
import { ObservationSession } from '../observation/session.js';

describe('trace command routing', () => {
  it.each([
    [['trace', 'list'], true], [['--profile', 'work', 'trace', 'show', 'id'], true],
    [['--profile=work', 'trace', '--help'], true], [['--profile=a', '--profile', 'b', 'trace'], true],
    [['browser', 'trace'], false], [['--profile', 'trace', 'list'], false],
    [['--help', 'trace'], false], [['--profile'], false], [[], false],
  ] as Array<[string[], boolean]>)('selects the offline route for %j', (args, expected) => {
    expect(isTraceInvocation(args)).toBe(expected);
  });
});

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
    await runTraceCli(args);
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
    ['show', 'id', '--format=csv'], ['list', '--profile='], ['list', '--site='], ['unknown'],
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

  it('renders plain output with control characters removed and diagnostics visible', async () => {
    const exported = fixture('work', 'trace\nforged\u001b[31m');
    writeFileSync(join(exported.dir, 'trace.jsonl'), '{broken\n');
    await runTraceCli(['trace', 'list', '-f', 'plain']);
    expect(stdout.mock.calls[0][0]).toContain('Traces (1 shown of 1)');
    expect(stdout.mock.calls[0][0]).not.toMatch(/\nforged|\u001b/);
    stdout.mockClear();
    await runTraceCli(['trace', 'show', 'trace', '-f', 'plain']);
    expect(stdout.mock.calls[0][0]).toContain('Read gaps: malformed=1');
    expect(stdout.mock.calls[0][0]).not.toMatch(/\nforged|\u001b/);
  });
});
