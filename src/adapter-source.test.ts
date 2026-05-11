import { describe, expect, it } from 'vitest';
import type { InternalCliCommand } from './registry.js';
import { resolveAdapterSourcePath } from './adapter-source.js';

function makeCmd(overrides: Partial<InternalCliCommand> = {}): InternalCliCommand {
  return {
    site: 'test-site',
    name: 'test-cmd', access: 'read',
    description: 'test',
    args: [],
    ...overrides,
  } as InternalCliCommand;
}

describe('resolveAdapterSourcePath', () => {
  it('returns source when it is a real file path (not manifest:)', () => {
    const cmd = makeCmd({ source: '/home/user/.opencli/clis/arxiv/search.js' });
    expect(resolveAdapterSourcePath(cmd)).toBe('/home/user/.opencli/clis/arxiv/search.js');
  });

  it('skips manifest: pseudo-paths and falls back to _modulePath', () => {
    const cmd = makeCmd({ source: 'manifest:arxiv/search', _modulePath: '/pkg/clis/arxiv/search.js' });
    expect(resolveAdapterSourcePath(cmd)).toBe('/pkg/clis/arxiv/search.js');
  });

  it('returns undefined when only manifest: pseudo-path and no _modulePath', () => {
    const cmd = makeCmd({ source: 'manifest:test/cmd' });
    expect(resolveAdapterSourcePath(cmd)).toBeUndefined();
  });

  it('returns _modulePath when it is the only path available', () => {
    const cmd = makeCmd({ _modulePath: '/project/clis/site/cmd.js' });
    expect(resolveAdapterSourcePath(cmd)).toBe('/project/clis/site/cmd.js');
  });
});
