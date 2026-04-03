import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from './output.js';

describe('output TTY detection', () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalEnv = process.env.OUTPUT;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    if (originalEnv === undefined) delete process.env.OUTPUT;
    else process.env.OUTPUT = originalEnv;
    logSpy.mockRestore();
  });

  it('outputs YAML in non-TTY when format is not specified', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    render([{ name: 'alice', score: 10 }], { columns: ['name', 'score'] });
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('name: alice');
    expect(out).toContain('score: 10');
    expect(out).not.toContain('\x1b[');
  });

  it('outputs table in TTY when format is not specified', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    render([{ name: 'alice', score: 10 }], { columns: ['name', 'score'] });
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('alice');
  });

  it('respects explicit -f json even in TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    render([{ name: 'alice' }], { fmt: 'json' });
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(JSON.parse(out)).toEqual([{ name: 'alice' }]);
  });

  it('OUTPUT env var overrides TTY auto-detection', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    process.env.OUTPUT = 'json';
    render([{ name: 'alice' }], {});
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(JSON.parse(out)).toEqual([{ name: 'alice' }]);
  });
});
