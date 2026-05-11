import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import {
  buildSearchUrl,
  normalizeZlibraryBookUrl,
} from './utils.js';
import './search.js';
import './info.js';
import { createPageMock } from '../test-utils.js';


describe('zlibrary commands', () => {
  it('registers search and info commands', () => {
    expect(getRegistry().get('zlibrary/search')).toBeDefined();
    expect(getRegistry().get('zlibrary/info')).toBeDefined();
  });

  it('normalizes search query and rejects empty searches', () => {
    expect(buildSearchUrl('  test book  ')).toBe('https://z-library.im/s/test%20book');
    expect(() => buildSearchUrl('   ')).toThrow(ArgumentError);
  });

  it('restricts info URLs to the configured zlibrary host', () => {
    expect(normalizeZlibraryBookUrl('https://z-library.im/book/demo')).toBe('https://z-library.im/book/demo');
    expect(normalizeZlibraryBookUrl('https://www.z-library.im/book/demo')).toBe('https://www.z-library.im/book/demo');
    expect(() => normalizeZlibraryBookUrl('https://example.com/book/demo')).toThrow(ArgumentError);
  });

  it('search fails fast on empty extraction results', async () => {
    const command = getRegistry().get('zlibrary/search');
    const page = createPageMock(['[]']);

    await expect(command.func(page, { query: 'missing', limit: 10 })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('info waits seconds, not milliseconds-as-seconds, before extracting formats', async () => {
    const command = getRegistry().get('zlibrary/info');
    const page = createPageMock([
      'Demo Book',
      undefined,
      JSON.stringify({ pdf: 'https://z-library.im/dl/pdf', epub: '' }),
    ]);

    await expect(command.func(page, { url: 'https://z-library.im/book/demo' })).resolves.toEqual([{
      title: 'Demo Book',
      pdf: 'https://z-library.im/dl/pdf',
      epub: '',
      url: 'https://z-library.im/book/demo',
    }]);
    expect(page.wait).toHaveBeenCalledWith({ time: 5 });
    expect(page.wait).toHaveBeenCalledWith({ time: 3 });
  });

  it('info fails fast when formats are missing', async () => {
    const command = getRegistry().get('zlibrary/info');
    const page = createPageMock([
      'Login Required',
      undefined,
      JSON.stringify({ pdf: '', epub: '' }),
    ]);

    await expect(command.func(page, { url: 'https://z-library.im/book/demo' })).rejects.toBeInstanceOf(EmptyResultError);
  });
});
