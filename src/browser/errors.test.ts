import { describe, expect, it } from 'vitest';

import { classifyBrowserError, isTransientBrowserError } from './errors.js';

describe('classifyBrowserError', () => {
  it('classifies extension transient errors with 1500ms delay', () => {
    for (const msg of [
      'Extension disconnected',
      'Extension not connected',
      'attach failed',
      'Detached while handling command',
      'Debugger is not attached to the tab: 123',
      'no longer exists',
      'No tab with id: 456',
      'CDP connection reset',
      'Daemon command failed',
      'No window with id: 123',
    ]) {
      const advice = classifyBrowserError(new Error(msg));
      expect(advice.kind, `expected "${msg}" → extension-transient`).toBe('extension-transient');
      expect(advice.retryable).toBe(true);
      expect(advice.delayMs).toBe(1500);
    }
  });

  it('classifies CDP target navigation errors with 200ms delay', () => {
    const advice = classifyBrowserError(new Error('Inspected target navigated or closed'));
    expect(advice.kind).toBe('target-navigation');
    expect(advice.retryable).toBe(true);
    expect(advice.delayMs).toBe(200);
  });

  it('classifies CDP -32000 target errors with 200ms delay', () => {
    const advice = classifyBrowserError(new Error('{"code":-32000,"message":"Target closed"}'));
    expect(advice.kind).toBe('target-navigation');
    expect(advice.retryable).toBe(true);
    expect(advice.delayMs).toBe(200);
  });

  it('returns non-retryable for unrelated errors', () => {
    for (const msg of ['Permission denied', 'malformed exec payload', 'SyntaxError']) {
      const advice = classifyBrowserError(new Error(msg));
      expect(advice.kind).toBe('non-retryable');
      expect(advice.retryable).toBe(false);
    }
  });

  it('handles non-Error values', () => {
    expect(classifyBrowserError('Extension disconnected').kind).toBe('extension-transient');
    expect(classifyBrowserError(42).kind).toBe('non-retryable');
  });
});

describe('isTransientBrowserError (convenience wrapper)', () => {
  it('returns true for transient errors', () => {
    expect(isTransientBrowserError(new Error('No window with id: 123'))).toBe(true);
  });

  it('returns false for non-transient errors', () => {
    expect(isTransientBrowserError(new Error('Permission denied'))).toBe(false);
  });
});
