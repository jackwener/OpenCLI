import { afterEach, describe, expect, it } from 'vitest';
import { cli, getRegistry } from './registry.js';
import { getCompletions } from './completion.js';

describe('nested completion paths', () => {
  const keys: string[] = [];

  afterEach(() => {
    for (const key of keys.splice(0)) getRegistry().delete(key);
  });

  it('completes nested command groups and keeps flat commands available', async () => {
    cli({
      site: 'notebooklm-tree',
      name: 'source/list',
      aliases: ['source-list'],
      description: 'List sources',
    });
    cli({
      site: 'notebooklm-tree',
      name: 'status',
      description: 'Status',
    });

    keys.push('notebooklm-tree/source/list', 'notebooklm-tree/status');

    await expect(getCompletions(['notebooklm-tree'], 2)).resolves.toEqual(['source', 'source-list', 'status']);
    await expect(getCompletions(['notebooklm-tree', 'source'], 3)).resolves.toEqual(['list']);
  });

  it('completes dynamic artifact-id values for nested and flat notebooklm download commands', async () => {
    cli({
      site: 'notebooklm-tree',
      name: 'download/report',
      aliases: ['download-report'],
      description: 'Download report',
      args: [
        { name: 'output_path', positional: true, required: true },
        {
          name: 'artifact-id',
          completion: async () => ['report-1', 'report-2'],
        },
      ],
    });
    cli({
      site: 'notebooklm-tree',
      name: 'download/audio',
      aliases: ['download-audio'],
      description: 'Download audio',
      args: [
        { name: 'output_path', positional: true, required: true },
        {
          name: 'artifact-id',
          completion: async () => ['audio-1'],
        },
      ],
    });

    keys.push(
      'notebooklm-tree/download/report',
      'notebooklm-tree/download/audio',
    );

    await expect(
      getCompletions(['notebooklm-tree', 'download', 'report', 'out.md', '--artifact-id'], 6),
    ).resolves.toEqual(['report-1', 'report-2']);

    await expect(
      getCompletions(['notebooklm-tree', 'download-report', 'out.md', '--artifact-id'], 5),
    ).resolves.toEqual(['report-1', 'report-2']);

    await expect(
      getCompletions(['notebooklm-tree', 'download', 'audio', 'out.m4a', '--artifact-id'], 6),
    ).resolves.toEqual(['audio-1']);

    await expect(
      getCompletions(['notebooklm-tree', 'download', 'report', 'out.md'], 5),
    ).resolves.toEqual([]);
  });
});
