import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './videos.js';

describe('douyin videos registration', () => {
  it('registers the videos command', () => {
    const registry = getRegistry();
    const values = [...registry.values()];
    const cmd = values.find(c => c.site === 'douyin' && c.name === 'videos');
    expect(cmd).toBeDefined();
  });
});
