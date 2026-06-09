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

  it('escapes pipes and newlines in markdown cells so columns stay aligned', () => {
    render([{ name: 'a|b', note: 'line1\nline2' }], { fmt: 'md', columns: ['name', 'note'] });
    const lines = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Header, separator, one data row.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('| name | note |');
    expect(lines[1]).toBe('| --- | --- |');
    // '|' is escaped to '\|' and the newline becomes '<br>'.
    expect(lines[2]).toBe('| a\\|b | line1<br>line2 |');
    // Every row keeps exactly the column count: 3 pipes for 2 columns.
    for (const line of lines) {
      expect((line.match(/(?<!\\)\|/g) ?? []).length).toBe(3);
    }
  });

  it('keeps columns aligned when a cell value is only a pipe', () => {
    // Realistic reachable path: e.g. `weread book-search ... --raw -f md` renders
    // book snippets/titles verbatim, and a snippet can be a literal '|'.
    render([{ rank: '1', snippet: '|' }], { fmt: 'md', columns: ['rank', 'snippet'] });
    const lines = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('| 1 | \\| |');
    // 2 columns => exactly 3 unescaped delimiters per row; the cell '|' must not add a fourth.
    for (const line of lines) {
      expect((line.match(/(?<!\\)\|/g) ?? []).length).toBe(3);
    }
  });
});
