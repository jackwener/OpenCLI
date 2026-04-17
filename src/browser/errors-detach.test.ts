import { describe, expect, it } from 'vitest';
import { classifyBrowserError } from './errors.js';

describe('classifyBrowserError detach handling', () => {
  it('treats detached-in-command failures as transient extension errors', () => {
    expect(classifyBrowserError(new Error('Detached while handling command'))).toEqual({
      kind: 'extension-transient',
      retryable: true,
      delayMs: 1500,
    });
  });

  it('treats debugger-not-attached failures as transient extension errors', () => {
    expect(classifyBrowserError(new Error('Debugger is not attached to the tab with id: 123.'))).toEqual({
      kind: 'extension-transient',
      retryable: true,
      delayMs: 1500,
    });
  });
});
