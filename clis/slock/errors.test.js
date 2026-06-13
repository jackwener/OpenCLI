import { describe, it, expect } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, ConfigError } from '@jackwener/opencli/errors';
import { dispatchEvaluateResult } from './errors.js';

describe('dispatchEvaluateResult', () => {
  it('returns rows on kind:"ok"', () => {
    const rows = dispatchEvaluateResult({ kind: 'ok', rows: [{ a: 1 }] });
    expect(rows).toEqual([{ a: 1 }]);
  });

  it('throws AuthRequiredError on kind:"auth"', () => {
    expect(() => dispatchEvaluateResult({ kind: 'auth', detail: 'x' })).toThrow(AuthRequiredError);
  });

  it('throws CommandExecutionError on kind:"http" with status + where', () => {
    expect(() => dispatchEvaluateResult({ kind: 'http', status: 500, where: '/messages' }))
      .toThrow(/HTTP 500.*\/messages/);
  });

  it('throws ConfigError on kind:"no-server"', () => {
    expect(() => dispatchEvaluateResult({ kind: 'no-server', detail: 'no slug' }))
      .toThrow(ConfigError);
  });

  it('throws ArgumentError on kind:"unresolvable"', () => {
    expect(() => dispatchEvaluateResult({ kind: 'unresolvable', detail: 'short id had 0 matches' }))
      .toThrow(ArgumentError);
  });
});
