import { describe, it, expect } from 'vitest';

const { __test__ } = await import('./suggest.js');
const command = __test__.command;

describe('duckduckgo suggest', () => {
  it('should register as a valid command', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('duckduckgo');
    expect(command.name).toBe('suggest');
    expect(command.access).toBe('read');
    expect(command.browser).toBe(false);
    expect(command.strategy).toBe('public');
  });

  it('should define keyword positional arg', () => {
    const kwArg = command.args.find(a => a.name === 'keyword');
    expect(kwArg).toBeDefined();
    expect(kwArg.positional).toBe(true);
    expect(kwArg.required).toBe(true);
  });

  it('should define limit arg with default 8', () => {
    const limitArg = command.args.find(a => a.name === 'limit');
    expect(limitArg).toBeDefined();
    expect(limitArg.default).toBe(8);
  });

  it('should define phrase column', () => {
    expect(command.columns).toEqual(['phrase']);
  });
});
