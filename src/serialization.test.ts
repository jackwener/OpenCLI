import { describe, expect, it } from 'vitest';
import type { CliCommand } from './registry.js';
import { Strategy } from './registry.js';
import { formatRegistryHelpText } from './serialization.js';

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
});
