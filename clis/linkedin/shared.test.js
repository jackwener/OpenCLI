import { describe, expect, it } from 'vitest';
import { decodeLinkedInSafetyUrl } from './shared.js';

describe('linkedin shared helpers', () => {
  it('normalizes empty and direct HTTP URLs', () => {
    expect(decodeLinkedInSafetyUrl('')).toBe('');
    expect(decodeLinkedInSafetyUrl(null)).toBe('');
    expect(decodeLinkedInSafetyUrl(' https://example.com/demo ')).toBe('https://example.com/demo');
  });

  it('decodes LinkedIn safety redirect URLs', () => {
    expect(decodeLinkedInSafetyUrl('https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fgithub.com%2Fjackwener%2FOpenCLI&urlhash=x'))
      .toBe('https://github.com/jackwener/OpenCLI');
  });

  it('rejects unsafe safety redirect targets', () => {
    expect(decodeLinkedInSafetyUrl('https://www.linkedin.com/safety/go/?url=javascript%3Aalert(1)&urlhash=x'))
      .toBe('');
    expect(decodeLinkedInSafetyUrl('javascript:alert(1)')).toBe('');
    expect(decodeLinkedInSafetyUrl('https://user:pass@example.com/demo')).toBe('');
  });
});
