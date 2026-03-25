import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './draft.js';

describe('douyin draft registration', () => {
  it('registers the draft command', () => {
    const registry = getRegistry();
    const values = [...registry.values()];
    const cmd = values.find(c => c.site === 'douyin' && c.name === 'draft');
    expect(cmd).toBeDefined();
  });
});
