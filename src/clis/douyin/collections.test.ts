import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './collections.js';

describe('douyin collections registration', () => {
  it('registers the collections command', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'collections');
    expect(cmd).toBeDefined();
    expect(cmd?.args.some(a => a.name === 'limit')).toBe(true);
  });

  it('has expected columns', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'collections');
    expect(cmd?.columns).toContain('mix_id');
    expect(cmd?.columns).toContain('name');
    expect(cmd?.columns).toContain('item_count');
  });

  it('uses COOKIE strategy', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'collections');
    expect(cmd?.strategy).toBe('cookie');
  });
});
