import { getRegistry } from '@jackwener/opencli/registry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executePipeline } from '@jackwener/opencli/pipeline';

// Import all binance adapters to register them
import './top.js';
import './gainers.js';
import './pairs.js';

function loadPipeline(name) {
  const cmd = getRegistry().get(`binance/${name}`);
  if (!cmd?.pipeline) throw new Error(`Command binance/${name} not found or has no pipeline`);
  return cmd.pipeline;
}

function mockJsonOnce(payload) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(payload),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('binance adapters', () => {
  it('sorts top pairs by numeric quote volume', async () => {
    mockJsonOnce([
      { symbol: 'SMALL', lastPrice: '1', priceChangePercent: '1.2', highPrice: '1', lowPrice: '1', quoteVolume: '9.9' },
      { symbol: 'LARGE', lastPrice: '2', priceChangePercent: '2.3', highPrice: '2', lowPrice: '2', quoteVolume: '100.0' },
      { symbol: 'MID', lastPrice: '3', priceChangePercent: '3.4', highPrice: '3', lowPrice: '3', quoteVolume: '11.0' },
    ]);

    const result = await executePipeline(null, loadPipeline('top'), { args: { limit: 3 } });

    expect(result.map((item) => item.symbol)).toEqual(['LARGE', 'MID', 'SMALL']);
    expect(result.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it('sorts gainers by numeric percent change', async () => {
    mockJsonOnce([
      { symbol: 'TEN', lastPrice: '1', priceChangePercent: '10.0', quoteVolume: '100' },
      { symbol: 'NINE', lastPrice: '1', priceChangePercent: '9.5', quoteVolume: '100' },
      { symbol: 'HUNDRED', lastPrice: '1', priceChangePercent: '100.0', quoteVolume: '100' },
    ]);

    const result = await executePipeline(null, loadPipeline('gainers'), { args: { limit: 3 } });

    expect(result.map((item) => item.symbol)).toEqual(['HUNDRED', 'TEN', 'NINE']);
  });

  it('keeps only TRADING pairs', async () => {
    mockJsonOnce({
      symbols: [
        { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'OLDPAIR', baseAsset: 'OLD', quoteAsset: 'USDT', status: 'BREAK' },
      ],
    });

    const result = await executePipeline(null, loadPipeline('pairs'), { args: { limit: 10 } });

    expect(result).toEqual([
      { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', status: 'TRADING' },
    ]);
  });
});
