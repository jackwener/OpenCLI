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
    render([{ name: 'alice', note: 'line 1\nline 2' }], { fmt: 'json' });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(JSON.parse(out)).toEqual([{ name: 'alice', note: 'line 1\nline 2' }]);
  });

  it('shows elapsed time when elapsed is 0', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    render([{ name: 'alice' }], { fmt: 'table', columns: ['name'], elapsed: 0 });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(out).toContain('0.0s');
  });

  it('explicit -f table overrides non-TTY auto-downgrade', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    render([{ name: 'alice' }], { fmt: 'table', fmtExplicit: true, columns: ['name'] });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    // Should be table output, not YAML
    expect(out).not.toContain('name: alice');
    expect(out).toContain('alice');
  });

  it('prints single markdown payloads without wrapping them in a table', () => {
    render([{ markdown: '# Title\n\nBody' }], { fmt: 'md' });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(out).toBe('# Title\n\nBody');
    expect(out).not.toContain('| markdown |');
  });

  it('keeps markdown records on one physical row across embedded line breaks', () => {
    render([
      { id: 'mixed', cell: 'left|right\r\nmiddle\n\nlast\rtail' },
      { id: 'null', cell: null },
      { id: 'undefined', cell: undefined },
    ], { fmt: 'md', columns: ['id', 'cell'] });

    const lines = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(lines).toEqual([
      '| id | cell |',
      '| --- | --- |',
      '| mixed | left\\|right<br>middle<br><br>last<br>tail |',
      '| null |  |',
      '| undefined |  |',
    ]);
    expect(lines.every((line: string) => !/[\r\n]/.test(line))).toBe(true);
  });

  it('escapes pipe characters in markdown table cells', () => {
    render([{ name: 'a|b', score: 10 }], { fmt: 'md', columns: ['name', 'score'] });
    const out = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');

    expect(out).toContain('| a\\|b | 10 |');
  });
});
