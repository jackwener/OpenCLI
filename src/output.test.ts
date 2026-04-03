/**
 * Tests for output.ts: render function format coverage.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from './output.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('render', () => {
  it('renders JSON output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render([{ title: 'Hello', rank: 1 }], { fmt: 'json' });
    expect(log).toHaveBeenCalledOnce();
    const output = log.mock.calls[0]?.[0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([{ title: 'Hello', rank: 1 }]);
  });

  it('renders Markdown table output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render([{ name: 'Alice', score: 100 }], { fmt: 'md', columns: ['name', 'score'] });
    const calls = log.mock.calls.map(c => c[0]);
    expect(calls[0]).toContain('| name | score |');
    expect(calls[1]).toContain('| --- | --- |');
    expect(calls[2]).toContain('| Alice | 100 |');
  });

  it('renders CSV output with proper quoting', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render([{ name: 'Alice, Bob', value: 'say "hi"' }], { fmt: 'csv' });
    const calls = log.mock.calls.map(c => c[0]);
    // Header
    expect(calls[0]).toBe('name,value');
    // Values with commas/quotes are quoted
    expect(calls[1]).toContain('"Alice, Bob"');
    expect(calls[1]).toContain('"say ""hi"""');
  });

  it('handles null and undefined data', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render(null, { fmt: 'json' });
    expect(log).toHaveBeenCalledWith(null);
  });

  it('renders single object as single-row table', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render({ title: 'Test' }, { fmt: 'json' });
    const output = log.mock.calls[0]?.[0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ title: 'Test' });
  });

  it('handles empty array gracefully', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render([], { fmt: 'table' });
    // Should show "(no data)" for empty arrays
    expect(log).toHaveBeenCalled();
  });

  it('uses custom columns for CSV', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render([{ a: 1, b: 2, c: 3 }], { fmt: 'csv', columns: ['a', 'c'] });
    const calls = log.mock.calls.map(c => c[0]);
    expect(calls[0]).toBe('a,c');
    expect(calls[1]).toBe('1,3');
  });

  it('renders YAML output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render([{ title: 'Hello', rank: 1 }], { fmt: 'yaml' });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain('- title: Hello');
    expect(log.mock.calls[0]?.[0]).toContain('rank: 1');
  });

  it('renders yml alias as YAML output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render({ title: 'Hello' }, { fmt: 'yml' });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain('title: Hello');
  });

  it('handles null values in CSV cells', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render([{ name: 'test', value: null }], { fmt: 'csv' });
    const calls = log.mock.calls.map(c => c[0]);
    expect(calls[1]).toBe('test,');
  });

  it('renders single-field rows in plain mode as the bare value', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render([{ response: 'Gemini says hi' }], { fmt: 'plain' });
    expect(log).toHaveBeenCalledWith('Gemini says hi');
  });

  it('renders multi-field rows in plain mode as key-value lines', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render([{ status: 'ok', file: '~/tmp/a.png', link: 'https://example.com' }], { fmt: 'plain' });
    const calls = log.mock.calls.map(c => c[0]);
    expect(calls).toEqual([
      'status: ok',
      'file: ~/tmp/a.png',
      'link: https://example.com',
    ]);
  });
});
