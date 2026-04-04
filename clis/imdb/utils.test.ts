import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../src/types.js';
import {
  extractJsonLd,
  forceEnglishUrl,
  formatDuration,
  getCurrentImdbId,
  isChallengePage,
  normalizeImdbTitleType,
  normalizeImdbId,
  waitForImdbPath,
  waitForImdbReviewsReady,
  waitForImdbSearchReady,
} from './utils.js';

describe('normalizeImdbId', () => {
  it('passes through bare ids', () => {
    expect(normalizeImdbId('tt1375666', 'tt')).toBe('tt1375666');
    expect(normalizeImdbId('nm0634240', 'nm')).toBe('nm0634240');
  });

  it('extracts ids from supported urls', () => {
    expect(normalizeImdbId('https://www.imdb.com/title/tt1375666/', 'tt')).toBe('tt1375666');
    expect(normalizeImdbId('https://m.imdb.com/title/tt1375666/', 'tt')).toBe('tt1375666');
    expect(normalizeImdbId('https://www.imdb.com/de/title/tt1375666/?ref_=nv_sr_srsg_0', 'tt')).toBe('tt1375666');
    expect(normalizeImdbId('https://www.imdb.com/name/nm0634240/', 'nm')).toBe('nm0634240');
  });

  it('throws on invalid or mismatched ids', () => {
    expect(() => normalizeImdbId('invalid', 'tt')).toThrow('Invalid IMDb ID');
    expect(() => normalizeImdbId('tt1', 'tt')).toThrow('Invalid IMDb ID');
    expect(() => normalizeImdbId('nm0634240', 'tt')).toThrow('Invalid IMDb ID');
  });
});

describe('formatDuration', () => {
  it('converts ISO-8601 durations to a short human format', () => {
    expect(formatDuration('PT2H28M')).toBe('2h 28m');
    expect(formatDuration('PT1H')).toBe('1h');
    expect(formatDuration('PT45M')).toBe('45m');
    expect(formatDuration('PT2H')).toBe('2h');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatDuration('')).toBe('');
    expect(formatDuration('invalid')).toBe('');
  });
});

describe('forceEnglishUrl', () => {
  it('adds the English language parameter', () => {
    expect(forceEnglishUrl('https://www.imdb.com/title/tt1375666/')).toContain('language=en-US');
  });

  it('preserves existing query parameters', () => {
    const result = forceEnglishUrl('https://www.imdb.com/title/tt1375666/?ref_=nv');
    expect(result).toContain('language=en-US');
    expect(result).toContain('ref_=nv');
  });
});

describe('normalizeImdbTitleType', () => {
  it('maps internal imdb ids to readable labels', () => {
    expect(normalizeImdbTitleType({ id: 'movie', text: '' })).toBe('Movie');
    expect(normalizeImdbTitleType({ id: 'tvSeries', text: '' })).toBe('TV Series');
    expect(normalizeImdbTitleType('short')).toBe('Short');
  });

  it('preserves explicit text labels', () => {
    expect(normalizeImdbTitleType({ id: 'movie', text: 'Feature Film' })).toBe('Feature Film');
  });
});

describe('extractJsonLd', () => {
  it('returns the evaluated JSON-LD payload', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({ '@type': 'Movie', name: 'Inception' }),
    } as unknown as IPage;

    await expect(extractJsonLd(page, 'Movie')).resolves.toEqual({ '@type': 'Movie', name: 'Inception' });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('"Movie"'));
  });
});

describe('isChallengePage', () => {
  it('returns true when the page evaluation matches a challenge', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue(true),
    } as unknown as IPage;

    await expect(isChallengePage(page)).resolves.toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('imdb browser helpers', () => {
  it('reads the current imdb id from page metadata', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue('nm0634240'),
    } as unknown as IPage;

    await expect(getCurrentImdbId(page, 'nm')).resolves.toBe('nm0634240');
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('wait helpers resolve mocked readiness booleans', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue(true),
    } as unknown as IPage;

    await expect(waitForImdbPath(page, '^/find/?$')).resolves.toBe(true);
    await expect(waitForImdbSearchReady(page)).resolves.toBe(true);
    await expect(waitForImdbReviewsReady(page)).resolves.toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });
});
