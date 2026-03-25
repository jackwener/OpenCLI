import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './stats.js';

describe('douyin stats registration', () => {
  it('registers the stats command', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'stats');
    expect(cmd).toBeDefined();
    expect(cmd?.args.some(a => a.name === 'aweme_id')).toBe(true);
  });

  it('has expected columns', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'stats');
    expect(cmd?.columns).toContain('metric');
    expect(cmd?.columns).toContain('value');
  });

  it('uses COOKIE strategy', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'stats');
    expect(cmd?.strategy).toBe('cookie');
  });
});
