import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDuration, formatDate, itunesFetch } from './utils.js';

describe('formatDuration', () => {
  it('formats typical duration in ms', () => {
    expect(formatDuration(3661000)).toBe('61:01');
  });

  it('pads single-digit seconds', () => {
    expect(formatDuration(65000)).toBe('1:05');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(3600000)).toBe('60:00');
  });

  it('rounds fractional milliseconds', () => {
    expect(formatDuration(3600500)).toBe('60:01');
  });

  it('returns dash for zero', () => {
    expect(formatDuration(0)).toBe('-');
  });

  it('returns dash for NaN', () => {
    expect(formatDuration(NaN)).toBe('-');
  });
});

describe('formatDate', () => {
  it('extracts YYYY-MM-DD from ISO string', () => {
    expect(formatDate('2026-03-19T12:00:00.000Z')).toBe('2026-03-19');
  });

  it('handles date-only string', () => {
    expect(formatDate('2025-01-01')).toBe('2025-01-01');
  });

  it('returns dash for empty string', () => {
    expect(formatDate('')).toBe('-');
  });

  it('returns dash for undefined', () => {
    expect(formatDate(undefined as any)).toBe('-');
  });
});

describe('itunesFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on success', async () => {
    const mockData = { resultCount: 1, results: [{ collectionId: 123 }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }));

    const result = await itunesFetch('/search?term=test&media=podcast&limit=1');
    expect(result).toEqual(mockData);
  });

  it('throws CliError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }));

    await expect(itunesFetch('/search?term=test')).rejects.toThrow('iTunes API HTTP 403');
  });
});
