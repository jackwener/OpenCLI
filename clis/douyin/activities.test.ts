import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserFetchMock } = vi.hoisted(() => ({
  browserFetchMock: vi.fn(),
}));

vi.mock('./_shared/browser-fetch.js', () => ({
  browserFetch: browserFetchMock,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './activities.js';

describe('douyin activities registration', () => {
  beforeEach(() => {
    browserFetchMock.mockReset();
  });

  it('registers the activities command', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'activities');
    expect(cmd).toBeDefined();
  });

  it('has expected columns', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'activities');
    expect(cmd?.columns).toContain('activity_id');
    expect(cmd?.columns).toContain('title');
    expect(cmd?.columns).toContain('end_time');
  });

  it('uses COOKIE strategy', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'activities');
    expect(cmd?.strategy).toBe('cookie');
  });

  it('maps the current activity payload shape returned by creator center', async () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'activities');
    expect(cmd?.func).toBeDefined();
    if (!cmd?.func) throw new Error('douyin activities command not registered');

    browserFetchMock.mockResolvedValueOnce({
      activity_list: [
        {
          activity_id: '200',
          activity_name: '超会玩派对',
          show_end_time: '2026.05.31',
        },
      ],
    });

    const rows = await cmd.func({} as never, {});

    expect(rows).toEqual([
      {
        activity_id: '200',
        title: '超会玩派对',
        end_time: '2026.05.31',
      },
    ]);
  });
});
