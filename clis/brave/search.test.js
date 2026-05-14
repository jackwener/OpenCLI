import { describe, it, expect } from 'vitest';

const { __test__ } = await import('./search.js');
const command = __test__.command;

describe('brave search', () => {
  it('should register as a valid command', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('brave');
    expect(command.name).toBe('search');
    expect(command.access).toBe('read');
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('public');
    expect(command.domain).toBe('search.brave.com');
  });

  it('should define keyword positional arg', () => {
    const kwArg = command.args.find(a => a.name === 'keyword');
    expect(kwArg).toBeDefined();
    expect(kwArg.positional).toBe(true);
    expect(kwArg.required).toBe(true);
  });

  it('should define limit arg with default 10', () => {
    const limitArg = command.args.find(a => a.name === 'limit');
    expect(limitArg).toBeDefined();
    expect(limitArg.type).toBe('int');
    expect(limitArg.default).toBe(10);
  });

  it('should define output columns', () => {
    expect(command.columns).toContain('title');
    expect(command.columns).toContain('url');
    expect(command.columns).toContain('snippet');
  });
});
