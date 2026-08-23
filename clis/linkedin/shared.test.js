import { describe, expect, it } from 'vitest';
import { decodeLinkedInSafetyUrl, unwrapEvaluateResult } from './shared.js';

describe('linkedin shared helpers', () => {
  it('unwraps complete browser evaluate envelopes', () => {
    const data = { ok: true, rows: [1, 2] };
    expect(unwrapEvaluateResult({ session: 'site:linkedin:1', data })).toBe(data);
  });

  it('preserves non-envelope payload identity', () => {
    const raw = { data: { ok: true } };
    const sessionOnly = { session: 'site:linkedin:1' };
    expect(unwrapEvaluateResult(raw)).toBe(raw);
    expect(unwrapEvaluateResult(sessionOnly)).toBe(sessionOnly);
  });

  it('returns null and scalar evaluate payloads unchanged', () => {
    expect(unwrapEvaluateResult(null)).toBe(null);
    expect(unwrapEvaluateResult('text')).toBe('text');
    expect(unwrapEvaluateResult(42)).toBe(42);
  });

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
