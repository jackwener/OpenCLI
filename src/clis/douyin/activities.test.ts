import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './activities.js';

describe('douyin activities registration', () => {
  it('registers the activities command', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'activities');
    expect(cmd).toBeDefined();
  });

  it('has expected columns', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'activities');
    expect(cmd?.columns).toContain('activity_id');
    expect(cmd?.columns).toContain('title');
    expect(cmd?.columns).toContain('end_time');
  });

  it('uses COOKIE strategy', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'activities');
    expect(cmd?.strategy).toBe('cookie');
  });
});
