import { describe, it, expect } from 'vitest';

const { __test__ } = await import('./note.js');
const command = __test__.command;

describe('youdao note', () => {
  it('should register as a valid command', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('youdao');
    expect(command.name).toBe('note');
    expect(command.access).toBe('read');
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('public');
    expect(command.domain).toBe('share.note.youdao.com');
  });

  it('should define url positional arg', () => {
    const urlArg = command.args.find(a => a.name === 'url');
    expect(urlArg).toBeDefined();
    expect(urlArg.positional).toBe(true);
    expect(urlArg.required).toBe(true);
  });

  it('should define output columns', () => {
    expect(command.columns).toContain('title');
    expect(command.columns).toContain('content');
    expect(command.columns).toContain('keywords');
  });
});
