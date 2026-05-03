import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildTraceReceipt, exportObservationSession, getTraceDirectory } from './artifact.js';
import { ObservationSession } from './session.js';

describe('observation artifact', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-trace-'));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('writes artifacts under profile-scoped trace directory', () => {
    const session = new ObservationSession({
      id: 'trace-1',
      scope: {
        contextId: 'work',
        workspace: 'site:demo',
        site: 'demo',
        command: 'demo/run',
        adapterSourcePath: '/tmp/clis/demo/run.js',
      },
      now: () => 1_700_000_000_000,
    });
    session.record({ stream: 'action', name: 'command', phase: 'start' });
    session.record({ stream: 'screenshot', format: 'png', data: Buffer.from('png-bytes').toString('base64'), label: 'final' });
    session.record({
      stream: 'network',
      url: 'https://api.test/data?token=secret',
      method: 'GET',
      status: 500,
      requestHeaders: { authorization: 'Bearer secret' },
      responseBody: { ok: false },
    });
    session.record({ stream: 'console', level: 'error', text: 'boom password=supersecret' });

    const result = exportObservationSession(session, { baseDir, error: new Error('failed') });
    expect(result.dir).toBe(getTraceDirectory('work', 'trace-1', baseDir));
    expect(fs.existsSync(path.join(result.dir, 'trace.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'network.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'console.jsonl'))).toBe(true);
    expect(fs.existsSync(result.receiptPath)).toBe(true);
    expect(fs.readFileSync(path.join(result.dir, 'screenshots', '0001.png'), 'utf-8')).toBe('png-bytes');

    const trace = fs.readFileSync(path.join(result.dir, 'trace.jsonl'), 'utf-8');
    expect(trace).toContain('token=[REDACTED]');
    expect(trace).toContain('"authorization":"[REDACTED]"');
    expect(trace).not.toContain('supersecret');

    const summary = fs.readFileSync(result.summaryPath, 'utf-8');
    expect(summary).toContain('schemaVersion: 1');
    expect(summary).toContain('opencliVersion:');
    expect(summary).toContain('expiresAt:');
    expect(summary).toContain('status: failure');
    expect(summary).toContain('contextId: "work"');
    expect(summary).toContain('adapterSourcePath: "/tmp/clis/demo/run.js"');
    expect(summary).toContain('adapterSourcePathExists: false');
    expect(summary).toContain('## Failed Network');
    expect(summary).toContain('500 GET https://api.test/data?token=[REDACTED]');
    expect(summary).toContain('network: 1');

    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, 'utf-8'));
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      opencliVersion: expect.any(String),
      traceId: 'trace-1',
      traceDir: result.dir,
      summaryPath: result.summaryPath,
      receiptPath: result.receiptPath,
      status: 'failure',
      expiresAt: expect.any(String),
      scope: {
        contextId: 'work',
        workspace: 'site:demo',
        site: 'demo',
        command: 'demo/run',
        adapterSourcePath: '/tmp/clis/demo/run.js',
      },
      error: { message: 'failed' },
    });
  });

  it('builds a compact trace receipt', () => {
    const receipt = buildTraceReceipt({
      traceId: 'trace-1',
      dir: '/tmp/opencli/profiles/work/traces/trace-1',
      summaryPath: '/tmp/opencli/profiles/work/traces/trace-1/summary.md',
      receiptPath: '/tmp/opencli/profiles/work/traces/trace-1/receipt.json',
    }, 'failure', new Error('failed with token=secret'), {
      createdAt: '2026-05-03T00:00:00.000Z',
      retentionPolicy: { maxAgeDays: 7 },
    });

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      opencliVersion: expect.any(String),
      traceId: 'trace-1',
      traceDir: '/tmp/opencli/profiles/work/traces/trace-1',
      receiptPath: '/tmp/opencli/profiles/work/traces/trace-1/receipt.json',
      status: 'failure',
      expiresAt: '2026-05-10T00:00:00.000Z',
    });
    expect(receipt.error?.message).toContain('token=[REDACTED]');
  });

  it('prunes older traces after export while protecting the exported trace', () => {
    const oldTraceDir = getTraceDirectory('work', 'old-trace', baseDir);
    fs.mkdirSync(oldTraceDir, { recursive: true });
    fs.writeFileSync(path.join(oldTraceDir, 'receipt.json'), JSON.stringify({
      createdAt: '2026-04-01T00:00:00.000Z',
    }), 'utf-8');
    fs.writeFileSync(path.join(oldTraceDir, 'trace.jsonl'), '{}\n', 'utf-8');

    const session = new ObservationSession({
      id: 'new-trace',
      scope: { contextId: 'work', workspace: 'site:demo' },
      now: () => Date.parse('2026-05-03T00:00:00.000Z'),
    });
    session.record({ stream: 'action', name: 'command', phase: 'start' });

    const result = exportObservationSession(session, {
      baseDir,
      retentionPolicy: { maxAgeDays: 365, maxCountPerProfile: 1, maxBytesPerProfile: '500MB' },
    });

    expect(fs.existsSync(oldTraceDir)).toBe(false);
    expect(fs.existsSync(result.dir)).toBe(true);
  });
});
