import { describe, expect, it } from 'vitest';
import {
  canonicalizeLinkedInThreadUrl,
  decodeLinkedInSafetyUrl,
  looksLinkedInAuthWall,
  normalizeWhitespace,
  unwrapEvaluateResult,
} from './shared.js';

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

  it('normalizes LinkedIn messaging whitespace', () => {
    expect(normalizeWhitespace('  Lokesh\n\tRamesh  ')).toBe('Lokesh Ramesh');
    expect(normalizeWhitespace('A\u00a0\u202fB')).toBe('A B');
  });

  it('canonicalizes LinkedIn messaging thread URLs', () => {
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/abc/?foo=1#bar'))
      .toBe('https://www.linkedin.com/messaging/thread/abc/');
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/2-abc==/?mini=true#x'))
      .toBe('https://www.linkedin.com/messaging/thread/2-abc==/');
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/abc/extra')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('https://evil-linkedin.com/messaging/thread/abc/')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('http://www.linkedin.com/messaging/thread/abc/')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('https://user:pass@www.linkedin.com/messaging/thread/abc/')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com:444/messaging/thread/abc/')).toBe('');
  });

  it('detects LinkedIn auth-wall URLs and text branches', () => {
    expect(looksLinkedInAuthWall('https://www.linkedin.com/authwall Sign in to continue')).toBe(true);
    expect(looksLinkedInAuthWall('https://www.linkedin.com/checkpoint/challenge security verification required')).toBe(true);
    expect(looksLinkedInAuthWall('https://www.linkedin.com/feed/')).toBe(false);
    expect(looksLinkedInAuthWall('https://www.linkedin.com/login')).toBe(true);
    expect(looksLinkedInAuthWall('Please sign in to continue')).toBe(true);
    expect(looksLinkedInAuthWall('请登录后继续')).toBe(true);
  });
});
