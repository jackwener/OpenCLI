import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from './output.js';

function stripAnsi(str: string): string {
  return str.replace(/\u001B\[[0-9;]*m/g, '');
}

describe('output TTY detection', () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalColumns = process.stdout.columns;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    Object.defineProperty(process.stdout, 'columns', { value: originalColumns, writable: true });
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

  it('renders single-row table output as key/value pairs', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    render(
      [{ name: 'alice', score: 10, description: 'single row detail' }],
      { fmt: 'table', columns: ['name', 'score', 'description'], title: 'Sample' },
    );
    const out = stripAnsi(logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n'));
    expect(out).toContain('Sample');
    expect(out).toContain('  Name         alice');
    expect(out).toContain('  Score        10');
    expect(out).toContain('  Description  single row detail');
    expect(out).toContain('1 items');
  });

  it('caps wide table columns to terminal width and truncates long values', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process.stdout, 'columns', { value: 40, writable: true });
    render(
      [
        {
          name: 'alpha',
          status: 'ok',
          description: 'This is a very long description that should wrap cleanly in a narrow terminal width.',
        },
        {
          name: 'beta',
          status: 'warn',
          description: 'Another long description that should also wrap instead of making the table extremely wide.',
        },
      ],
      { fmt: 'table', columns: ['name', 'status', 'description'] },
    );
    const out = stripAnsi(logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n'));
    expect(out).toContain('This is a very l...');
    expect(out).toContain('Another long des...');
    expect(out).not.toContain('terminal width.');

    const maxLineLength = out.split('\n').reduce((max: number, line: string) => Math.max(max, line.length), 0);
    expect(maxLineLength).toBeLessThanOrEqual(40);
  });
});
