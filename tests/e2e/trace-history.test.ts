import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './helpers.js';

describe('offline trace CLI contract', () => {
  let baseDir: string;
  beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'opencli-trace-e2e-')); });
  afterEach(() => { rmSync(baseDir, { recursive: true, force: true }); });

  function fixture() {
    const dir = join(baseDir, 'profiles', 'work', 'traces', 'trace-123');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify({
      schemaVersion: 1, traceId: 'trace-123', status: 'failure', createdAt: '2026-11-05T10:00:00Z',
      scope: { site: 'demo', command: 'demo/search', session: 'test' },
    }));
    writeFileSync(join(dir, 'trace.jsonl'), JSON.stringify({ id: '1', ts: 1793872800000, stream: 'error', message: 'password=PRIVATE_VALUE' }) + '\n');
    return dir;
  }

  function run(args: string[]) {
    return runCli(args, { env: {
      OPENCLI_CONFIG_DIR: baseDir, OPENCLI_PROFILE: '', OPENCLI_DAEMON_PORT: '',
    } });
  }

  it('reads history through normal startup without connecting to a browser', async () => {
    const dir = fixture();
    const before = readFileSync(join(dir, 'trace.jsonl'), 'utf-8');
    const files = readdirSync(baseDir, { recursive: true });
    const list = await run(['trace', 'list']);
    expect(list.code).toBe(0);
    expect(JSON.parse(list.stdout)).toMatchObject({ ok: true, data: { total: 1 } });
    const show = await run(['--profile=work', 'trace', 'show', 'trace-', '--issues']);
    expect(show.code).toBe(0);
    expect(JSON.parse(show.stdout)).toMatchObject({ ok: true, data: { summary: { events: 1, issues: 1 }, events: [{ stream: 'error' }] } });
    expect(show.stdout).not.toContain('PRIVATE_VALUE');
    expect(show.stderr).not.toContain('PRIVATE_VALUE');
    expect(readFileSync(join(dir, 'trace.jsonl'), 'utf-8')).toBe(before);
    expect(readdirSync(baseDir, { recursive: true })).toEqual(files);
  });

  it('provides machine-readable nested help and stable failures', async () => {
    const help = await run(['trace', 'show', '--help', '-f', 'json']);
    expect(help.code).toBe(0);
    expect(JSON.parse(help.stdout)).toMatchObject({ namespace: 'trace', command: 'opencli trace show' });
    expect(help.stdout).toContain('include-data');
    const missing = await run(['trace', 'show', 'missing']);
    expect(missing.code).toBe(66);
    expect(JSON.parse(missing.stdout)).toMatchObject({ ok: false, error: { code: 'TRACE_NOT_FOUND' } });
    const invalid = await run(['trace', 'list', '--limit=2oops']);
    expect(invalid.code).toBe(2);
    expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false, error: { exitCode: 2 } });
    expect(readdirSync(baseDir)).toEqual([]);
  });

  it('uses normal startup configuration checks for trace commands', async () => {
    const result = await runCli(['trace', 'list'], { env: {
      OPENCLI_CONFIG_DIR: baseDir, OPENCLI_DAEMON_PORT: 'invalid-offline-port',
    } });
    expect(result.code).toBe(78);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'CONFIG' } });
  });

  it('flushes a large event page as one complete JSON result', async () => {
    const dir = fixture();
    const events = Array.from({ length: 1000 }, (_, index) => JSON.stringify({
      id: String(index), ts: 1793872800000 + index, stream: 'console', level: 'info', text: 'message '.repeat(50),
    }));
    writeFileSync(join(dir, 'trace.jsonl'), events.join('\n'));
    const result = await run(['trace', 'show', 'trace-123', '--limit=1000']);
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(65536);
    expect(JSON.parse(result.stdout).data.events).toHaveLength(1000);
  });
});
