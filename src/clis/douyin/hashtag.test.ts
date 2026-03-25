import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './hashtag.js';

describe('douyin hashtag registration', () => {
  it('registers the hashtag command', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'hashtag');
    expect(cmd).toBeDefined();
    expect(cmd?.args.some(a => a.name === 'action')).toBe(true);
  });

  it('has all expected args', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'hashtag');
    const argNames = cmd?.args.map(a => a.name) ?? [];
    expect(argNames).toContain('action');
    expect(argNames).toContain('keyword');
    expect(argNames).toContain('cover');
    expect(argNames).toContain('limit');
  });

  it('uses COOKIE strategy', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'hashtag');
    expect(cmd?.strategy).toBe('cookie');
  });
});
