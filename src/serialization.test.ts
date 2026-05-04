import { describe, expect, it } from 'vitest';
import type { CliCommand } from './registry.js';
import { Strategy } from './registry.js';
import { formatCommandExample, formatRegistryHelpText, serializeCommand } from './serialization.js';

describe('formatRegistryHelpText', () => {
  it('summarizes long choices lists so help text stays readable', () => {
    const cmd: CliCommand = {
      site: 'demo',
      name: 'dynamic', access: 'read',
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

  it('includes aliases in structured serialization and help text', () => {
    const cmd: CliCommand = {
      site: 'demo',
      name: 'get',
      access: 'read',
      aliases: ['metadata'],
      description: 'Demo command',
      strategy: Strategy.COOKIE,
      browser: true,
      args: [],
    };

    expect(serializeCommand(cmd)).toMatchObject({
      command: 'demo/get',
      access: 'read',
      aliases: ['metadata'],
    });
    expect(formatRegistryHelpText(cmd)).toContain('Aliases: metadata');
  });

  it('surfaces access and canonical examples instead of strategy as primary help metadata', () => {
    const cmd: CliCommand = {
      site: 'bilibili',
      name: 'hot',
      access: 'read',
      description: 'Bilibili hot videos',
      strategy: Strategy.COOKIE,
      browser: true,
      args: [],
    };

    expect(formatCommandExample(cmd)).toBe('opencli bilibili hot -f yaml');
    expect(serializeCommand(cmd)).toMatchObject({
      command: 'bilibili/hot',
      access: 'read',
      example: 'opencli bilibili hot -f yaml',
    });
    expect(formatRegistryHelpText(cmd)).toContain('Access: read');
    expect(formatRegistryHelpText(cmd)).toContain('Example: opencli bilibili hot -f yaml');
    expect(formatRegistryHelpText(cmd)).not.toContain('Strategy:');
  });
});
