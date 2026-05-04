import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseByteSize, pruneTraceArtifacts } from './retention.js';

describe('trace artifact retention', () => {
  let tmpDir: string;
  let tracesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-trace-retention-'));
    tracesDir = path.join(tmpDir, 'profiles', 'default', 'traces');
    fs.mkdirSync(tracesDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses byte budgets with units', () => {
    expect(parseByteSize(128)).toBe(128);
    expect(parseByteSize('128')).toBe(128);
    expect(parseByteSize('2KB')).toBe(2 * 1024);
    expect(parseByteSize('1.5MB')).toBe(Math.floor(1.5 * 1024 * 1024));
    expect(parseByteSize('1 GB')).toBe(1024 ** 3);
    expect(() => parseByteSize('many')).toThrow('Invalid byte size');
  });

  it('prunes traces older than the age budget', () => {
    const now = Date.parse('2026-05-03T00:00:00.000Z');
    const old = createTraceDir('old', '2026-04-24T00:00:00.000Z');
    const recent = createTraceDir('recent', '2026-05-02T00:00:00.000Z');

    const result = pruneTraceArtifacts(tracesDir, {
      now: () => now,
      policy: { maxAgeDays: 7, maxCountPerProfile: 20, maxBytesPerProfile: '500MB' },
      warn: vi.fn(),
    });

    expect(result.deleted).toEqual([old]);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it('prunes oldest traces over the count budget', () => {
    const oldest = createTraceDir('oldest', '2026-05-01T00:00:00.000Z');
    const middle = createTraceDir('middle', '2026-05-02T00:00:00.000Z');
    const newest = createTraceDir('newest', '2026-05-03T00:00:00.000Z');

    const result = pruneTraceArtifacts(tracesDir, {
      now: () => Date.parse('2026-05-03T12:00:00.000Z'),
      policy: { maxAgeDays: 30, maxCountPerProfile: 2, maxBytesPerProfile: '500MB' },
      warn: vi.fn(),
    });

    expect(result.deleted).toEqual([oldest]);
    expect(fs.existsSync(oldest)).toBe(false);
    expect(fs.existsSync(middle)).toBe(true);
    expect(fs.existsSync(newest)).toBe(true);
  });

  it('prunes oldest traces over the byte budget', () => {
    const oldest = createTraceDir('oldest', '2026-05-01T00:00:00.000Z', 512);
    const middle = createTraceDir('middle', '2026-05-02T00:00:00.000Z', 64);
    const newest = createTraceDir('newest', '2026-05-03T00:00:00.000Z', 64);
    const budget = directorySize(middle) + directorySize(newest) + 1;

    const result = pruneTraceArtifacts(tracesDir, {
      now: () => Date.parse('2026-05-03T12:00:00.000Z'),
      policy: { maxAgeDays: 30, maxCountPerProfile: 20, maxBytesPerProfile: budget },
      warn: vi.fn(),
    });

    expect(result.deleted).toEqual([oldest]);
    expect(fs.existsSync(oldest)).toBe(false);
    expect(fs.existsSync(middle)).toBe(true);
    expect(fs.existsSync(newest)).toBe(true);
  });

  it('falls back to directory mtime when receipt is missing', () => {
    const now = Date.parse('2026-05-03T00:00:00.000Z');
    const old = createTraceDir('old-no-receipt', undefined);
    const recent = createTraceDir('recent', '2026-05-02T00:00:00.000Z');
    const oldDate = new Date('2026-04-20T00:00:00.000Z');
    fs.utimesSync(old, oldDate, oldDate);

    const result = pruneTraceArtifacts(tracesDir, {
      now: () => now,
      policy: { maxAgeDays: 7, maxCountPerProfile: 20, maxBytesPerProfile: '500MB' },
      warn: vi.fn(),
    });

    expect(result.deleted).toEqual([old]);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it('does not delete the protected trace exported by the current run', () => {
    const old = createTraceDir('oldest', '2026-05-01T00:00:00.000Z');
    const current = createTraceDir('current', '2026-04-01T00:00:00.000Z', 1024);

    const result = pruneTraceArtifacts(tracesDir, {
      now: () => Date.parse('2026-05-03T12:00:00.000Z'),
      policy: { maxAgeDays: 0, maxCountPerProfile: 0, maxBytesPerProfile: 1 },
      protectedTraceDirs: [current],
      warn: vi.fn(),
    });

    expect(result.deleted).toEqual([old]);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(current)).toBe(true);
  });

  function createTraceDir(name: string, createdAt?: string, payloadBytes = 8): string {
    const dir = path.join(tracesDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'trace.jsonl'), 'x'.repeat(payloadBytes), 'utf-8');
    if (createdAt) {
      fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify({ createdAt }, null, 2), 'utf-8');
      const date = new Date(createdAt);
      fs.utimesSync(dir, date, date);
    }
    return dir;
  }
});

function directorySize(dir: string): number {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const item = path.join(dir, name);
    const stat = fs.lstatSync(item);
    if (stat.isDirectory()) total += directorySize(item);
    else total += stat.size;
  }
  return total;
}
