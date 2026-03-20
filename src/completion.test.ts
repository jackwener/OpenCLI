import { describe, expect, it } from 'vitest';
import { getCompletions } from './completion.js';

describe('completion', () => {
  it('includes browser in top-level completions', () => {
    const completions = getCompletions([], 1);

    expect(completions).toContain('browser');
  });

  it('returns browser subcommands on second token', () => {
    expect(getCompletions(['browser'], 2)).toEqual(['doctor', 'list', 'launch', 'stop', 'profiles', 'run']);
  });

  it('returns browser profiles subcommands on third token', () => {
    expect(getCompletions(['browser', 'profiles'], 3)).toEqual(['rm', 'prune']);
  });
});
