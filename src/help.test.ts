import { describe, it, expect } from 'vitest';
import { classifyAdapter, formatRootAdapterHelpText } from './help.js';

describe('classifyAdapter', () => {
  it('classifies DNS-style domains as site', () => {
    expect(classifyAdapter('www.bilibili.com')).toBe('site');
    expect(classifyAdapter('chatgpt.com')).toBe('site');
    expect(classifyAdapter('claude.ai')).toBe('site');
    expect(classifyAdapter('grok.com')).toBe('site');
  });

  it('classifies localhost as app (Electron / osascript desktop integrations)', () => {
    expect(classifyAdapter('localhost')).toBe('app');
  });

  it('classifies non-DNS domain strings as app (e.g. literal "doubao-app")', () => {
    expect(classifyAdapter('doubao-app')).toBe('app');
  });

  it('defaults missing domain to site (most adapters without explicit domain are public web scrapers)', () => {
    expect(classifyAdapter(undefined)).toBe('site');
  });
});

describe('formatRootAdapterHelpText', () => {
  it('renders App / Site sections in order when populated', () => {
    const text = formatRootAdapterHelpText({
      apps: ['chatwise', 'codex'],
      sites: ['bilibili'],
    });
    expect(text).toContain('App adapters (2):');
    expect(text).toContain('Site adapters (1):');
    expect(text.indexOf('App adapters')).toBeLessThan(text.indexOf('Site adapters'));
  });

  it('omits empty sections instead of rendering a (0) header', () => {
    const text = formatRootAdapterHelpText({
      apps: [],
      sites: ['bilibili'],
    });
    expect(text).not.toContain('App adapters');
    expect(text).toContain('Site adapters (1):');
  });

  it('returns empty string when all groups are empty', () => {
    expect(formatRootAdapterHelpText({ apps: [], sites: [] })).toBe('');
  });

  it('always renders the agent discovery hint when any section is populated', () => {
    const text = formatRootAdapterHelpText({
      apps: [],
      sites: ['bilibili'],
    });
    expect(text).toContain("'opencli <site> --help -f yaml'");
  });
});
