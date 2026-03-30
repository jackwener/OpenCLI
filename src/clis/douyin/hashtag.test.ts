import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserFetchMock } = vi.hoisted(() => ({
  browserFetchMock: vi.fn(),
}));

vi.mock('./_shared/browser-fetch.js', () => ({
  browserFetch: browserFetchMock,
}));

import { getRegistry } from '../../registry.js';
import './hashtag.js';

describe('douyin hashtag', () => {
  beforeEach(() => {
    browserFetchMock.mockReset();
  });

  it('registers the hashtag command', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'hashtag');
    expect(cmd).toBeDefined();
    expect(cmd?.args.some(a => a.name === 'action')).toBe(true);
  });

  it('has all expected args', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'hashtag');
    const argNames = cmd?.args.map(a => a.name) ?? [];
    expect(argNames).toContain('action');
    expect(argNames).toContain('keyword');
    expect(argNames).toContain('cover');
    expect(argNames).toContain('limit');
  });

  it('uses COOKIE strategy', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'hashtag');
    expect(cmd?.strategy).toBe('cookie');
  });

  it('parses the current hotspot recommendation shape', async () => {
    const registry = getRegistry();
    const command = [...registry.values()].find((cmd) => cmd.site === 'douyin' && cmd.name === 'hashtag');
    expect(command?.func).toBeDefined();
    if (!command?.func) throw new Error('douyin hashtag command not registered');

    browserFetchMock.mockResolvedValueOnce({
      all_sentences: [
        {
          word: '在公园花海里大晒一场',
          hot_value: 12141172,
          sentence_id: '2448416',
        },
      ],
    });

    const rows = await command.func({} as any, { action: 'hot', keyword: '', limit: 5 });

    expect(rows).toEqual([
      {
        name: '在公园花海里大晒一场',
        id: '2448416',
        view_count: 12141172,
      },
    ]);
  });
});
