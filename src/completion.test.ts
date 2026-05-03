import { describe, expect, it, vi } from 'vitest';

const { mockGetRegistry } = vi.hoisted(() => ({
  mockGetRegistry: vi.fn(() => new Map([
    ['github/issues', { site: 'github', name: 'issues' }],
    ['demo/status', { site: 'demo', name: 'status', aliases: ['stat'] }],
  ])),
}));

vi.mock('./registry.js', () => ({
  getRegistry: mockGetRegistry,
}));

import { getCompletions } from './completion.js';

describe('getCompletions', () => {
  it('includes current top-level built-ins and external CLI names', () => {
    const completions = getCompletions([], 1);

    expect(completions).toContain('adapter');
    expect(completions).toContain('daemon');
    expect(completions).toContain('profile');
    expect(completions).toContain('external');
    expect(completions).toContain('install');
    expect(completions).toContain('register');
    expect(completions).toContain('docker');
    expect(completions).not.toContain('tab');
  });

  it('includes discovered site names', () => {
    const completions = getCompletions([], 1);

    expect(completions).toContain('github');
    expect(completions).toContain('demo');
  });

  it('completes built-in browser subcommands', () => {
    const completions = getCompletions(['browser'], 2);

    expect(completions).toEqual(expect.arrayContaining(['open', 'analyze', 'tab', 'verify']));
  });

  it('completes nested built-in browser tab subcommands', () => {
    const completions = getCompletions(['browser', 'tab'], 3);

    expect(completions).toEqual(expect.arrayContaining(['list', 'new', 'select', 'close']));
  });

  it('completes shells for the completion command', () => {
    expect(getCompletions(['completion'], 2)).toEqual(['bash', 'fish', 'zsh']);
  });

  it('completes external CLI names for install flows', () => {
    expect(getCompletions(['install'], 2)).toEqual(expect.arrayContaining(['docker', 'gh']));
    expect(getCompletions(['external', 'install'], 3)).toEqual(expect.arrayContaining(['docker', 'gh']));
  });

  it('completes adapter subcommands and aliases under a site', () => {
    const completions = getCompletions(['demo'], 2);

    expect(completions).toEqual(['stat', 'status']);
  });
});
