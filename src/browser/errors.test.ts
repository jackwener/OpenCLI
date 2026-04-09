import { describe, expect, it } from 'vitest';

import { isTransientBrowserError } from './errors.js';

describe('isTransientBrowserError', () => {
  it('treats "No window with id" as transient', () => {
    expect(isTransientBrowserError(new Error('No window with id: 123'))).toBe(true);
  });

  it('does not classify unrelated browser errors as transient', () => {
    expect(isTransientBrowserError(new Error('Permission denied'))).toBe(false);
  });
});
