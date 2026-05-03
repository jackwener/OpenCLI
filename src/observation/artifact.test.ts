import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exportObservationSession, getTraceDirectory } from './artifact.js';
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
      scope: { contextId: 'work', workspace: 'site:demo', site: 'demo', command: 'demo/run' },
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
    expect(fs.readFileSync(path.join(result.dir, 'screenshots', '0001.png'), 'utf-8')).toBe('png-bytes');

    const trace = fs.readFileSync(path.join(result.dir, 'trace.jsonl'), 'utf-8');
    expect(trace).toContain('token=[REDACTED]');
    expect(trace).toContain('"authorization":"[REDACTED]"');
    expect(trace).not.toContain('supersecret');

    const summary = fs.readFileSync(result.summaryPath, 'utf-8');
    expect(summary).toContain('contextId: work');
    expect(summary).toContain('network: 1');
  });
});
