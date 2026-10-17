import { describe, it, expect } from 'vitest';
import { formatRootAdapterHelpText } from './help.js';

describe('formatRootAdapterHelpText', () => {
  it('omits empty sections instead of rendering a (0) header', () => {
    const text = formatRootAdapterHelpText({
      sites: ['bilibili'],
    });
    expect(text).not.toContain('App adapters');
    expect(text).toContain('Site adapters (1):');
  });

  it('returns empty string when all groups are empty', () => {
    expect(formatRootAdapterHelpText({ sites: [] })).toBe('');
  });

  it('always renders the agent discovery hint when any section is populated', () => {
    const text = formatRootAdapterHelpText({
      sites: ['bilibili'],
    });
    expect(text).toContain("'opencli <site> --help -f json'");
  });
});
