import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './update.js';

describe('douyin update registration', () => {
  it('registers the update command', () => {
    const registry = getRegistry();
    const values = [...registry.values()];
    const cmd = values.find(c => c.site === 'douyin' && c.name === 'update');
    expect(cmd).toBeDefined();
  });
});
