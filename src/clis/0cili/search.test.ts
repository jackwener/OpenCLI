import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './search.js';

describe('0cili search adapter', () => {
  const command = getRegistry().get('0cili/search');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command!.site).toBe('0cili');
    expect(command!.name).toBe('search');
    expect(command!.domain).toBe('0cili.com');
    expect(command!.strategy).toBe('cookie');
    expect(command!.browser).toBe(true);
    expect(typeof command!.func).toBe('function');
  });

  it('has query as a required positional arg', () => {
    const queryArg = command!.args.find((a) => a.name === 'query');
    expect(queryArg).toBeDefined();
    expect(queryArg!.required).toBe(true);
    expect(queryArg!.positional).toBe(true);
  });

  it('has limit arg with default 20', () => {
    const limitArg = command!.args.find((a) => a.name === 'limit');
    expect(limitArg).toBeDefined();
    expect(limitArg!.default).toBe(20);
  });

  it('includes expected columns', () => {
    expect(command!.columns).toEqual(
      expect.arrayContaining(['rank', 'title', 'size', 'files', 'hot', 'magnet']),
    );
  });
});
