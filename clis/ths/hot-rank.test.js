import { describe, expect, it, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './hot-rank.js';

const THS_HOT_API =
  'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour&list_type=normal';

/** Build a single stock_list item the way the upstream API does. */
function item(order, overrides = {}) {
  return {
    market: 17,
    code: String(600000 + order),
    rate: String(1000000 - order * 1000) + '.0',
    rise_and_fall: -(order % 5) - 0.5,
    name: `stock${order}`,
    hot_rank_chg: 0,
    topic: null,
    tag: {
      concept_tag: [`concept${order}a`, `concept${order}b`],
      popularity_tag: order % 2 === 0 ? '持续上榜' : '首次上榜',
    },
    order,
    ...overrides,
  };
}

function okResponse(list) {
  return new Response(
    JSON.stringify({ status_code: 0, status_msg: '', data: { stock_list: list } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('ths hot-rank command', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers the command with correct metadata', () => {
    const command = getRegistry().get('ths/hot-rank');
    expect(command).toBeDefined();
    expect(command).toMatchObject({
      site: 'ths',
      name: 'hot-rank',
      description: expect.stringContaining('同花顺'),
      strategy: 'public',
      browser: false,
    });
    expect(command.columns).toEqual(['rank', 'symbol', 'name', 'changePercent', 'heat', 'tags']);
  });

  it('hits the public hot_list API and maps fields with the authoritative rank', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      okResponse([item(1, { name: '美诺华', rate: '1750902.0', rise_and_fall: -1.6667, tag: { concept_tag: ['减肥药', 'CRO概念'], popularity_tag: '2天1板' } })]),
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await command.func({ limit: 20 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(THS_HOT_API);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      rank: 1,
      symbol: '600001',
      name: '美诺华',
      changePercent: '-1.67%',
      heat: '175.1万热度',
      tags: '2天1板,减肥药,CRO概念',
    });
  });

  it('returns the full 100 ranks (1..100, dense) when limit=100', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const full = Array.from({ length: 100 }, (_, i) => item(i + 1));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okResponse(full))));

    const result = await command.func({ limit: 100 });

    expect(result).toHaveLength(100);
    expect(result.map((r) => r.rank)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('clamps limit into [1, 100] and slices accordingly', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const full = Array.from({ length: 100 }, (_, i) => item(i + 1));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okResponse(full))));

    const result = await command.func({ limit: 150 });
    expect(result).toHaveLength(100);
  });

  it('sends an authoritative rank even when upstream order is not pre-sorted', async () => {
    const command = getRegistry().get('ths/hot-rank');
    // API lists rank 3 before rank 1; we keep upstream `order` as the source of truth.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(okResponse([item(3), item(1), item(2)])),
    ));

    const result = await command.func({ limit: 10 });
    expect(result.map((r) => r.rank)).toEqual([3, 1, 2]);
  });

  it('throws CommandExecutionError on non-OK HTTP', async () => {
    const command = getRegistry().get('ths/hot-rank');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 503 }))));

    await expect(command.func({ limit: 5 })).rejects.toThrow(CommandExecutionError);
  });

  it('throws CommandExecutionError on malformed JSON', async () => {
    const command = getRegistry().get('ths/hot-rank');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('not-json{{{', { status: 200 }))));

    await expect(command.func({ limit: 5 })).rejects.toThrow(CommandExecutionError);
  });

  it('throws CommandExecutionError on in-band error status_code', async () => {
    const command = getRegistry().get('ths/hot-rank');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ status_code: 500, status_msg: 'internal error' }), { status: 200 })),
    ));

    await expect(command.func({ limit: 5 })).rejects.toThrow(CommandExecutionError);
  });

  it('throws EmptyResultError when stock_list is empty', async () => {
    const command = getRegistry().get('ths/hot-rank');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okResponse([]))));

    await expect(command.func({ limit: 20 })).rejects.toThrow(EmptyResultError);
  });
});
