import { describe, it, expect } from 'vitest';
import {
  CliError,
  BrowserConnectError,
  adapterLoadError,
  CommandExecutionError,
  ConfigError,
  AuthRequiredError,
  TimeoutError,
  ArgumentError,
  EmptyResultError,
  selectorError,
  toEnvelope,
} from './errors.js';

describe('Error type hierarchy', () => {
  it('all error types extend CliError', () => {
    const errors = [
      new BrowserConnectError('test'),
      adapterLoadError('test'),
      new CommandExecutionError('test'),
      new ConfigError('test'),
      new AuthRequiredError('example.com'),
      new TimeoutError('test', 30),
      new ArgumentError('test'),
      new EmptyResultError('test/cmd'),
      selectorError('.btn'),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(CliError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('AuthRequiredError has correct code, domain, and auto-generated hint', () => {
    const err = new AuthRequiredError('bilibili.com');
    expect(err.code).toBe('AUTH_REQUIRED');
    expect(err.domain).toBe('bilibili.com');
    expect(err.message).toBe('Not logged in to bilibili.com');
    expect(err.hint).toContain('https://bilibili.com');
  });

  it('AuthRequiredError accepts custom message', () => {
    const err = new AuthRequiredError('x.com', 'No ct0 cookie found');
    expect(err.message).toBe('No ct0 cookie found');
    expect(err.hint).toContain('https://x.com');
  });

  it('TimeoutError has correct code and hint', () => {
    const err = new TimeoutError('bilibili/hot', 60);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toBe('bilibili/hot timed out after 60s');
    expect(err.hint).toContain('timeout');
  });

  it('ArgumentError has correct code', () => {
    const err = new ArgumentError('Argument "limit" must be a valid number');
    expect(err.code).toBe('ARGUMENT');
  });

  it('EmptyResultError has default hint', () => {
    const err = new EmptyResultError('hackernews/top');
    expect(err.code).toBe('EMPTY_RESULT');
    expect(err.message).toBe('hackernews/top returned no data');
    expect(err.hint).toBeTruthy();
  });

  it('selectorError has default hint about page changes', () => {
    const err = selectorError('.submit-btn');
    expect(err.code).toBe('SELECTOR');
    expect(err.message).toContain('.submit-btn');
    expect(err.hint).toContain('report');
  });

  it('BrowserConnectError has correct code', () => {
    const err = new BrowserConnectError('Cannot connect');
    expect(err.code).toBe('BROWSER_CONNECT');
  });
});

describe('toEnvelope', () => {
  it('converts CliError to structured envelope', () => {
    const err = new AuthRequiredError('bilibili.com');
    const envelope = toEnvelope(err);
    expect(envelope).toEqual({
      ok: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Not logged in to bilibili.com',
        help: expect.stringContaining('https://bilibili.com'),
        exitCode: 77,
      },
    });
  });

  it('converts CliError without hint (omits help field)', () => {
    const err = new CommandExecutionError('Something broke');
    const envelope = toEnvelope(err);
    expect(envelope.error.code).toBe('COMMAND_EXEC');
    expect(envelope.error).not.toHaveProperty('help');
  });

  it('converts unknown Error to UNKNOWN envelope', () => {
    const envelope = toEnvelope(new Error('random failure'));
    expect(envelope).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'random failure',
        exitCode: 1,
      },
    });
  });

  it('converts non-Error values to UNKNOWN envelope', () => {
    const envelope = toEnvelope('string error');
    expect(envelope.error.code).toBe('UNKNOWN');
    expect(envelope.error.message).toBe('string error');
  });

  it('serializes deep cause chains without stack overflow', () => {
    // Build a 20-level deep cause chain — should truncate at depth 10
    let deepErr: Error = new Error('root');
    for (let i = 0; i < 20; i++) {
      deepErr = new Error(`level-${i}`, { cause: deepErr });
    }
    const topErr = new CommandExecutionError('top');
    (topErr as { cause?: unknown }).cause = deepErr;
    const envelope = toEnvelope(topErr);
    const causeStr = envelope.error.cause ?? '';
    expect(causeStr).toContain('(cause chain truncated)');
    expect(causeStr).not.toContain('root'); // root is beyond depth 10
  });
});
