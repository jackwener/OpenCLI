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

  it('classifies CDP -32000 execution-context errors with 200ms delay', () => {
    const advice = classifyBrowserError(
      new Error('{"code":-32000,"message":"Cannot find default execution context"}'),
    );
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

  it('classifies chrome_call_timeout as non-retryable from code and from message', () => {
    const coded = classifyBrowserError(Object.assign(new Error('chrome.tabs.create did not return within 30s'), { code: 'chrome_call_timeout' }));
    expect(coded.kind).toBe('non-retryable');
    expect(coded.retryable).toBe(false);

    // Pre-error-code extensions only send the message; a re-run could leave a
    // duplicate window/tab, so it must stay terminal there too.
    const legacy = classifyBrowserError(new Error(
      'chrome.tabs.create did not return within 30s - Chrome never answered the call (in-place browser update, or a wedged renderer). The target may or may not exist; restart Chrome, then retry.',
    ));
    expect(legacy.kind).toBe('non-retryable');
    expect(legacy.retryable).toBe(false);
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
