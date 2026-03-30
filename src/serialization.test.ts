import { describe, expect, it } from 'vitest';
import type { CliCommand } from './registry.js';
import { Strategy } from './registry.js';
import { formatRegistryHelpText, serializeCommand } from './serialization.js';

describe('formatRegistryHelpText', () => {
  it('summarizes long choices lists so help text stays readable', () => {
    const cmd: CliCommand = {
      site: 'demo',
      name: 'dynamic',
      description: 'Demo command',
      strategy: Strategy.PUBLIC,
      browser: false,
      args: [
        {
          name: 'field',
          help: 'Field to use',
          choices: ['all-fields', 'topic', 'title', 'author', 'publication-titles', 'year-published', 'doi'],
        },
      ],
      columns: ['field'],
    };

    expect(formatRegistryHelpText(cmd)).toContain('--field: all-fields, topic, title, author, ... (+3 more)');
  });

  it('includes execution metadata for external passthrough commands', () => {
    const cmd: CliCommand = {
      site: 'ext',
      name: 'gh',
      description: 'GitHub CLI',
      strategy: Strategy.PUBLIC,
      browser: false,
      args: [{ name: 'args', positional: true, variadic: true }],
      execution: 'external-binary',
      passthrough: true,
      aliases: ['gh'],
      externalCli: {
        name: 'gh',
        binary: 'gh',
        description: 'GitHub CLI',
        homepage: 'https://cli.github.com',
        tags: ['github'],
      },
    };

    const serialized = serializeCommand(cmd);
    expect(serialized.execution).toBe('external-binary');
    expect(serialized.passthrough).toBe(true);
    expect(serialized.aliases).toEqual(['gh']);
    expect(serialized.binary).toBe('gh');
    expect(formatRegistryHelpText(cmd)).toContain('Execution: external-binary');
    expect(formatRegistryHelpText(cmd)).toContain('Passthrough: yes');
  });
});
