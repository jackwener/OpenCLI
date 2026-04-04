import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDuration, formatDate, fetchPageProps } from './utils.js';

describe('formatDuration', () => {
  it('formats typical duration', () => {
    expect(formatDuration(3890)).toBe('64:50');
  });

  it('formats zero seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('pads single-digit seconds', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(3600)).toBe('60:00');
  });

  it('rounds floating-point seconds', () => {
    expect(formatDuration(3890.7)).toBe('64:51');
  });

  it('returns dash for NaN', () => {
    expect(formatDuration(NaN)).toBe('-');
  });

  it('returns dash for negative', () => {
    expect(formatDuration(-1)).toBe('-');
  });
});

describe('formatDate', () => {
  it('extracts YYYY-MM-DD from ISO string', () => {
    expect(formatDate('2026-03-13T11:00:06.686Z')).toBe('2026-03-13');
  });

  it('handles date-only string', () => {
    expect(formatDate('2025-01-01')).toBe('2025-01-01');
  });

  it('returns dash for undefined/empty', () => {
    expect(formatDate('')).toBe('-');
    expect(formatDate(undefined as any)).toBe('-');
  });
});

describe('fetchPageProps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts pageProps from valid HTML', async () => {
    const mockHtml = `<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"podcast":{"title":"Test"}}}}</script></html>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    }));

    const result = await fetchPageProps('/podcast/abc123');
    expect(result).toEqual({ podcast: { title: 'Test' } });
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    }));

    await expect(fetchPageProps('/podcast/invalid')).rejects.toThrow('HTTP 404');
  });

  it('throws when __NEXT_DATA__ is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body>No data here</body></html>'),
    }));

    await expect(fetchPageProps('/podcast/abc')).rejects.toThrow('Failed to extract');
  });

  it('throws when pageProps is empty', async () => {
    const mockHtml = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    }));

    await expect(fetchPageProps('/podcast/abc')).rejects.toThrow('Resource not found');
  });

  it('throws on malformed JSON in __NEXT_DATA__', async () => {
    const mockHtml = `<script id="__NEXT_DATA__" type="application/json">{broken json</script>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    }));

    await expect(fetchPageProps('/podcast/abc')).rejects.toThrow('Malformed __NEXT_DATA__');
  });

  it('handles multiline JSON in __NEXT_DATA__', async () => {
    const mockHtml = `<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "episode": {"title": "Multiline Test"}
    }
  }
}
</script>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    }));

    const result = await fetchPageProps('/episode/abc');
    expect(result).toEqual({ episode: { title: 'Multiline Test' } });
  });
});
