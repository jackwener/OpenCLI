import { describe, expect, it } from 'vitest';
import { getCompletions } from './completion.js';
import { registerCommand } from './registry.js';
import { buildExternalCliCommand } from './external.js';

describe('completion external CLI support', () => {
  it('offers ext and top-level aliases on the first argument', () => {
    registerCommand(buildExternalCliCommand({
      name: 'gh',
      binary: 'gh',
      description: 'GitHub CLI',
    }));

    const completions = getCompletions([], 1);
    expect(completions).toContain('ext');
    expect(completions).toContain('gh');
  });

  it('offers external tools as subcommands under ext', () => {
    const completions = getCompletions(['ext'], 2);
    expect(completions).toContain('gh');
  });

  it('stops completion after a top-level external alias', () => {
    expect(getCompletions(['gh'], 2)).toEqual([]);
  });
});
