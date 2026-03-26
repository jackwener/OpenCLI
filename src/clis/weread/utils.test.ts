import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDate, fetchWebApi } from './utils.js';

describe('formatDate', () => {
  it('formats a typical Unix timestamp in UTC+8', () => {
    // 1705276800 = 2024-01-15 00:00:00 UTC = 2024-01-15 08:00:00 Beijing
    expect(formatDate(1705276800)).toBe('2024-01-15');
  });

  it('handles UTC midnight edge case with UTC+8 offset', () => {
    // 1705190399 = 2024-01-13 23:59:59 UTC = 2024-01-14 07:59:59 Beijing
    expect(formatDate(1705190399)).toBe('2024-01-14');
  });

  it('returns dash for zero', () => {
    expect(formatDate(0)).toBe('-');
  });

  it('returns dash for negative', () => {
    expect(formatDate(-1)).toBe('-');
  });

  it('returns dash for NaN', () => {
    expect(formatDate(NaN)).toBe('-');
  });

  it('returns dash for Infinity', () => {
    expect(formatDate(Infinity)).toBe('-');
  });

  it('returns dash for undefined', () => {
    expect(formatDate(undefined)).toBe('-');
  });

  it('returns dash for null', () => {
    expect(formatDate(null)).toBe('-');
  });
});

describe('fetchWebApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON for successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ books: [{ title: 'Test' }] }),
    }));

    const result = await fetchWebApi('/search/global', { keyword: 'test' });
    expect(result).toEqual({ books: [{ title: 'Test' }] });
  });

  it('throws CliError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({}),
    }));

    await expect(fetchWebApi('/search/global')).rejects.toThrow('HTTP 403');
  });

  it('throws PARSE_ERROR on non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    }));

    await expect(fetchWebApi('/search/global')).rejects.toThrow('Invalid JSON');
  });
});
