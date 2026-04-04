import { describe, expect, it, vi } from 'vitest';

const { mockGetRegistry } = vi.hoisted(() => ({
  mockGetRegistry: vi.fn(() => new Map([
    ['github/issues', { site: 'github', name: 'issues' }],
  ])),
}));

vi.mock('./registry.js', () => ({
  getRegistry: mockGetRegistry,
}));

import { getCompletions } from './completion.js';

describe('getCompletions', () => {
  it('includes top-level built-ins that are registered outside the site registry', () => {
    const completions = getCompletions([], 1);

    expect(completions).toContain('plugin');
    expect(completions).toContain('install');
    expect(completions).toContain('register');
    expect(completions).not.toContain('setup');
  });

  it('still includes discovered site names', () => {
    const completions = getCompletions([], 1);

    expect(completions).toContain('github');
  });
});
