import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { cnkiSearchUrl, normalizeCnkiUrl } from './shared.js';
import './detail.js';
import './search.js';

describe('cnki search command', () => {
  const command = getRegistry().get('cnki/search');

  it('registers the search command with advanced search options', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('cnki');
    expect(command.name).toBe('search');
    expect(command.domain).toBe('kns.cnki.net');
    expect(command.args.map(arg => arg.name)).toEqual([
      'query',
      'limit',
      'with-abstract',
      'expr',
      'field',
      'from',
      'to',
      'types',
    ]);
    expect(command.columns).toContain('abstract');
    expect(command.columns).toContain('doi');
  });

  it('rejects empty queries before browser navigation', async () => {
    const page = { goto: vi.fn() };
    await expect(command.func(page, { query: '   ' })).rejects.toMatchObject({
      name: 'ArgumentError',
      code: 'ARGUMENT',
    });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('rejects invalid fields and dates before browser navigation', async () => {
    const page = { goto: vi.fn() };

    await expect(command.func(page, { query: 'asphalt', field: 'bad' })).rejects.toMatchObject({
      name: 'ArgumentError',
      code: 'ARGUMENT',
    });
    await expect(command.func(page, { query: 'asphalt', from: '2025' })).rejects.toMatchObject({
      name: 'ArgumentError',
      code: 'ARGUMENT',
    });
    expect(page.goto).not.toHaveBeenCalled();
  });
});

describe('cnki detail command', () => {
  const command = getRegistry().get('cnki/detail');

  it('registers the detail command', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('cnki');
    expect(command.name).toBe('detail');
    expect(command.columns).toContain('keywords');
    expect(command.columns).toContain('abstract');
  });

  it('normalizes detail URLs and joins keywords', async () => {
    const page = {
      goto: vi.fn(),
      wait: vi.fn(),
      evaluate: vi.fn(async () => ({
        title: 'Paper title',
        authors: 'A; B',
        journal: 'Journal',
        abstract: 'Abstract text',
        keywords: ['rutting', 'asphalt'],
        url: 'https://kns.cnki.net/kcms/detail/detail.aspx?filename=ABC',
      })),
    };

    const result = await command.func(page, { url: '/kcms/detail/detail.aspx?filename=ABC' });

    expect(page.goto).toHaveBeenCalledWith('https://kns.cnki.net/kcms/detail/detail.aspx?filename=ABC', {
      waitUntil: 'none',
      settleMs: 1200,
    });
    expect(result.keywords).toBe('rutting, asphalt');
    expect(result.abstract).toBe('Abstract text');
  });

  it('rejects missing detail URLs before browser navigation', async () => {
    const page = { goto: vi.fn() };

    await expect(command.func(page, { url: '   ' })).rejects.toMatchObject({
      name: 'ArgumentError',
      code: 'ARGUMENT',
    });
    expect(page.goto).not.toHaveBeenCalled();
  });
});

describe('cnki shared helpers', () => {
  it('normalizes CNKI URLs', () => {
    expect(normalizeCnkiUrl('/kcms/detail/detail.aspx?filename=ABC')).toBe(
      'https://kns.cnki.net/kcms/detail/detail.aspx?filename=ABC',
    );
    expect(normalizeCnkiUrl('//kns.cnki.net/kcms/detail/detail.aspx?filename=ABC')).toBe(
      'https://kns.cnki.net/kcms/detail/detail.aspx?filename=ABC',
    );
    expect(normalizeCnkiUrl('kcms/detail/detail.aspx?filename=ABC')).toBe(
      'https://kns.cnki.net/kcms/detail/detail.aspx?filename=ABC',
    );
  });

  it('builds the fallback CNKI search URL', () => {
    const url = new URL(cnkiSearchUrl('road rutting'));

    expect(url.origin).toBe('https://kns.cnki.net');
    expect(url.pathname).toBe('/starter');
    expect(url.searchParams.get('kw')).toBe('road rutting');
    expect(url.searchParams.get('rt')).toBe('journal');
  });
});
