import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import './creator-stats.js';

describe('bilibili creator-stats', () => {
  const command = getRegistry().get('bilibili/creator-stats');
  let page;

  beforeEach(() => {
    page = { fetchJson: vi.fn() };
  });

  it('registers as a browser-cookie read command with raw metric columns', () => {
    expect(command).toMatchObject({
      strategy: Strategy.COOKIE,
      browser: true,
      access: 'read',
      navigateBefore: 'https://member.bilibili.com/platform/home',
      columns: ['source', 'metric', 'value', 'unit'],
    });
  });

  it('fetches creator endpoints and preserves metric paths on the platform raw scale', async () => {
    page.fetchJson
      .mockResolvedValueOnce({ code: 0, data: { pages: [{ cid: 12345 }] } })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          list: [{
            bvid: 'BV1xx411c7mD',
            stat: { play: 1200, full_play_ratio: 2345 },
            hour_stat: { play: 600 },
          }],
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: { arc_audience: { play_fan_rate: 2500 }, available: true },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          duration_info: { avg_play_time: '-' },
          viewer_quit: [{ duration_key: 30, num: 1000 }],
        },
      });

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD' });

    expect(page.fetchJson).toHaveBeenCalledTimes(4);
    expect(page.fetchJson).toHaveBeenNthCalledWith(
      1,
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD',
    );
    expect(page.fetchJson).toHaveBeenNthCalledWith(
      2,
      'https://member.bilibili.com/x/web/data/archive_diagnose/compare?bvid=BV1xx411c7mD&size=100&tmid=',
    );
    expect(page.fetchJson).toHaveBeenNthCalledWith(
      3,
      'https://member.bilibili.com/x/web/data/archive_diagnose/play_analyze?bvid=BV1xx411c7mD&tmid=',
    );
    expect(page.fetchJson).toHaveBeenNthCalledWith(
      4,
      'https://member.bilibili.com/x/web/data/v2/archive/analyze/graph?cid=12345&tmid=',
    );
    expect(rows).toContainEqual({
      source: 'compare.stat',
      metric: 'full_play_ratio',
      value: 2345,
      unit: 'platform_raw',
    });
    expect(rows).toContainEqual({
      source: 'retention_graph',
      metric: 'viewer_quit[0].duration_key',
      value: 30,
      unit: 'platform_raw',
    });
    expect(rows).toContainEqual({
      source: 'retention_graph',
      metric: 'duration_info.avg_play_time',
      value: null,
      unit: 'platform_raw',
    });
    expect(rows).toContainEqual({
      source: 'play_analyze',
      metric: 'available',
      value: true,
      unit: 'platform_raw',
    });
  });

  it('rejects malformed BVIDs before any browser request', async () => {
    await expect(command.func(page, { bvid: 'not-a-bvid' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.fetchJson).not.toHaveBeenCalled();
  });

  it('maps login and permission API failures to AuthRequiredError', async () => {
    page.fetchJson
      .mockResolvedValueOnce({ code: 0, data: { pages: [{ cid: 12345 }] } })
      .mockResolvedValueOnce({ code: -101, message: '账号未登录', data: null });

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' }))
      .rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('fails with AuthRequiredError when the logged-in account does not own the BVID', async () => {
    page.fetchJson
      .mockResolvedValueOnce({ code: 0, data: { pages: [{ cid: 12345 }] } })
      .mockResolvedValueOnce({
        code: 0,
        data: { list: [{ bvid: 'BV1yy411c7mD', stat: {}, hour_stat: {} }] },
      });

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' }))
      .rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps a missing public video to EmptyResultError', async () => {
    page.fetchJson.mockResolvedValueOnce({ code: -404, message: '啥都木有', data: null });

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' }))
      .rejects.toBeInstanceOf(EmptyResultError);
  });

  it('fails closed on malformed response shapes', async () => {
    page.fetchJson
      .mockResolvedValueOnce({ code: 0, data: { pages: [{ cid: 12345 }] } })
      .mockResolvedValueOnce({ code: 0, data: { items: [] } });

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('wraps fetchJson transport errors as CommandExecutionError', async () => {
    page.fetchJson.mockRejectedValueOnce(new Error('browser fetch failed'));

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('uses EmptyResultError when all creator metric objects are empty', async () => {
    page.fetchJson
      .mockResolvedValueOnce({ code: 0, data: { pages: [{ cid: 12345 }] } })
      .mockResolvedValueOnce({
        code: 0,
        data: { list: [{ bvid: 'BV1xx411c7mD', stat: {}, hour_stat: {} }] },
      })
      .mockResolvedValueOnce({ code: 0, data: {} })
      .mockResolvedValueOnce({ code: 0, data: {} });

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' }))
      .rejects.toBeInstanceOf(EmptyResultError);
  });
});
