import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './profile.js';

describe('douyin profile registration', () => {
  it('registers the profile command', () => {
    const registry = getRegistry();
    const values = [...registry.values()];
    const cmd = values.find(c => c.site === 'douyin' && c.name === 'profile');
    expect(cmd).toBeDefined();
  });
});
