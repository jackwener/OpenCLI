import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './location.js';

describe('douyin location registration', () => {
  it('registers the location command', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'location');
    expect(cmd).toBeDefined();
    expect(cmd?.args.some(a => a.name === 'query')).toBe(true);
  });

  it('has all expected args', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'location');
    const argNames = cmd?.args.map(a => a.name) ?? [];
    expect(argNames).toContain('query');
    expect(argNames).toContain('limit');
  });

  it('uses COOKIE strategy', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'location');
    expect(cmd?.strategy).toBe('cookie');
  });
});
