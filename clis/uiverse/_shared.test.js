import { describe, expect, it } from 'vitest';
import {
  UIVERSE_BASE_URL,
  parseComponentInput,
  parseHtmlRootSignature,
  getPreviewFallbackTags,
  inferLanguage,
  getCodeLength,
} from './_shared.js';

describe('uiverse shared helpers', () => {
  it('parses full URLs and author/slug identifiers', () => {
    expect(parseComponentInput('Galahhad/strong-squid-82')).toEqual({
      raw: 'Galahhad/strong-squid-82',
      username: 'Galahhad',
      slug: 'strong-squid-82',
      url: `${UIVERSE_BASE_URL}/Galahhad/strong-squid-82`,
    });

    expect(parseComponentInput('https://uiverse.io/Galahhad/strong-squid-82')).toEqual({
      raw: 'https://uiverse.io/Galahhad/strong-squid-82',
      username: 'Galahhad',
      slug: 'strong-squid-82',
      url: `${UIVERSE_BASE_URL}/Galahhad/strong-squid-82`,
    });
  });

  it('rejects unsupported hosts and malformed identifiers', () => {
    expect(() => parseComponentInput('https://example.com/foo/bar')).toThrow('Unsupported non-Uiverse URL');
    expect(() => parseComponentInput('only-author')).toThrow('Could not parse author/slug');
    expect(() => parseComponentInput('a/b/c')).toThrow('Could not parse author/slug');
  });

  it('parses the HTML root signature', () => {
    expect(parseHtmlRootSignature('<label id="x" class="theme-switch primary"></label>')).toEqual({
      tag: 'label',
      id: 'x',
      classes: ['theme-switch', 'primary'],
    });
    expect(parseHtmlRootSignature('')).toEqual({ tag: null, id: null, classes: [] });
  });

  it('uses broader preview fallback tags for input roots', () => {
    expect(getPreviewFallbackTags({ tag: 'input' })).toEqual(['input', 'label', 'button', 'a', 'div']);
    expect(getPreviewFallbackTags({ tag: 'label' })).toEqual(['label']);
    expect(getPreviewFallbackTags({ tag: null })).toEqual(['label', 'button', 'a', 'div']);
  });

  it('infers the language from target and metadata', () => {
    expect(inferLanguage('react', {})).toBe('tsx');
    expect(inferLanguage('vue', {})).toBe('vue');
    expect(inferLanguage('html', { isTailwind: true })).toBe('html+tailwind');
    expect(inferLanguage('css', {})).toBe('css');
    expect(inferLanguage('unknown', {})).toBe('text');
  });

  it('returns the code length safely', () => {
    expect(getCodeLength('abc')).toBe(3);
    expect(getCodeLength('')).toBe(0);
    expect(getCodeLength(null)).toBe(0);
  });
});
