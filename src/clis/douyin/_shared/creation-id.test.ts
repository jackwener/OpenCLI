import { describe, expect, it } from 'vitest';
import { generateCreationId } from './creation-id.js';

describe('generateCreationId', () => {
  it('starts with "pin"', () => {
    expect(generateCreationId()).toMatch(/^pin/);
  });

  it('has 4 random lowercase-alphanumeric chars after "pin"', () => {
    expect(generateCreationId()).toMatch(/^pin[a-z0-9]{4}/);
  });

  it('ends with a numeric timestamp (ms)', () => {
    const before = Date.now();
    const id = generateCreationId();
    const after = Date.now();
    const ts = parseInt(id.replace(/^pin[a-z0-9]{4}/, ''), 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, generateCreationId));
    expect(ids.size).toBe(100);
  });
});
