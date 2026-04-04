import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './search.js';

describe('jd search adapter', () => {
  const command = getRegistry().get('jd/search');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command!.site).toBe('jd');
    expect(command!.name).toBe('search');
    expect(command!.domain).toBe('search.jd.com');
    expect(command!.strategy).toBe('cookie');
    expect(typeof command!.func).toBe('function');
  });

  it('has query positional with default 显卡 A100', () => {
    const q = command!.args.find((a) => a.name === 'query');
    expect(q).toBeDefined();
    expect(q!.positional).toBe(true);
    expect(q!.default).toBe('显卡 A100');
  });

  it('has limit arg with default 30', () => {
    const limitArg = command!.args.find((a) => a.name === 'limit');
    expect(limitArg).toBeDefined();
    expect(limitArg!.default).toBe(30);
  });

  it('includes expected columns', () => {
    expect(command!.columns).toEqual(['rank', 'title', 'price', 'sku', 'url']);
  });
});
