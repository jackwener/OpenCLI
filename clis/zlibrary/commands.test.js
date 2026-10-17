import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';

import {
  buildSearchUrl,
  normalizeZlibraryBookUrl,
} from './utils.js';

describe('zlibrary commands', () => {

  it('normalizes search query and rejects empty searches', () => {
    expect(buildSearchUrl('  test book  ')).toBe('https://z-library.im/s/test%20book');
    expect(() => buildSearchUrl('   ')).toThrow(ArgumentError);
  });

  it('restricts info URLs to the configured zlibrary host', () => {
    expect(normalizeZlibraryBookUrl('https://z-library.im/book/demo')).toBe('https://z-library.im/book/demo');
    expect(normalizeZlibraryBookUrl('https://www.z-library.im/book/demo')).toBe('https://www.z-library.im/book/demo');
    expect(() => normalizeZlibraryBookUrl('https://example.com/book/demo')).toThrow(ArgumentError);
  });

});
