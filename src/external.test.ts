import { describe, expect, it } from 'vitest';
import { resolveExternalCli, type ExternalCliConfig } from './external.js';

describe('resolveExternalCli', () => {
  const configs: ExternalCliConfig[] = [
    {
      name: 'gh',
      binary: 'gh',
      aliases: ['github'],
      description: 'GitHub CLI',
    },
  ];

  it('matches canonical command names', () => {
    const resolved = resolveExternalCli(configs, 'gh');
    expect(resolved).not.toBeNull();
    expect(resolved?.cli.name).toBe('gh');
  });

  it('matches alias command names', () => {
    const resolved = resolveExternalCli(configs, 'github');
    expect(resolved).not.toBeNull();
    expect(resolved?.cli.name).toBe('gh');
    expect(resolved?.matchedName).toBe('github');
  });

  it('returns null for unknown names', () => {
    expect(resolveExternalCli(configs, 'gitlab')).toBeNull();
  });
});
