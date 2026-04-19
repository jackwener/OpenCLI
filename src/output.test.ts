import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from './output.js';

describe('output TTY detection', () => {
  const originalIsTTY = process.stdout.isTTY;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    logSpy.mockRestore();
  });

  it('outputs YAML in non-TTY when format is default table', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    // commanderAdapter always passes fmt:'table' as default — this must still trigger downgrade
    render([{ name: 'alice', score: 10 }], { fmt: 'table', columns: ['name', 'score'] });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(out).toContain('name: alice');
    expect(out).toContain('score: 10');
  });

  it('outputs table in TTY when format is default table', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    render([{ name: 'alice', score: 10 }], { fmt: 'table', columns: ['name', 'score'] });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(out).toContain('alice');
  });

  it('respects explicit -f json even in non-TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    render([{ name: 'alice' }], { fmt: 'json' });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(JSON.parse(out)).toEqual([{ name: 'alice' }]);
  });

  it('explicit -f table overrides non-TTY auto-downgrade', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    render([{ name: 'alice' }], { fmt: 'table', fmtExplicit: true, columns: ['name'] });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    // Should be table output, not YAML
    expect(out).not.toContain('name: alice');
    expect(out).toContain('alice');
  });
});
