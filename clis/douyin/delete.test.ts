import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './delete.js';

describe('douyin delete registration', () => {
  it('registers the delete command', () => {
    const registry = getRegistry();
    const values = [...registry.values()];
    const cmd = values.find(c => c.site === 'douyin' && c.name === 'delete');
    expect(cmd).toBeDefined();
  });
});
