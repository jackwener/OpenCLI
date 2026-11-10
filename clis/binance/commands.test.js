import { getRegistry } from '@jackwener/opencli/registry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executePipeline } from '@jackwener/opencli/pipeline';

// Import all binance adapters to register them
import './top.js';
import './ticker.js';
import './gainers.js';
import './losers.js';
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

async function runMarketCommand(name, limit) {
  const cmd = getRegistry().get(`binance/${name}`);
  if (!cmd?.func) throw new Error(`Command binance/${name} not found or has no func`);
  return cmd.func({ limit });
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

    const result = await runMarketCommand('top', 3);

    expect(result.map((item) => item.symbol)).toEqual(['LARGE', 'MID', 'SMALL']);
    expect(result.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(result[0]).toEqual({
      rank: 1, symbol: 'LARGE', price: '2', change_24h: '2.3', high: '2', low: '2', volume: '100.0',
    });
  });

  it('preserves ticker fields while ranking by quote volume', async () => {
    mockJsonOnce([
      { symbol: 'SMALL', lastPrice: '1', priceChangePercent: '1.2', highPrice: '1', lowPrice: '1', volume: '10', quoteVolume: '9.9', count: 20 },
      { symbol: 'LARGE', lastPrice: '2', priceChangePercent: '2.3', highPrice: '2', lowPrice: '2', volume: '20', quoteVolume: '100.0', count: 30 },
    ]);

    const result = await runMarketCommand('ticker', 1);

    expect(result).toEqual([{
      symbol: 'LARGE', price: '2', change_pct: '2.3', high: '2', low: '2', volume: '20', quote_vol: '100.0', trades: 30,
    }]);
  });

  it('ranks the full ticker payload without per-row template evaluation', async () => {
    mockJsonOnce(Array.from({ length: 4000 }, (_, index) => ({
      symbol: `PAIR${index}`,
      lastPrice: String(index),
      priceChangePercent: '1.0',
      highPrice: String(index + 1),
      lowPrice: String(index),
      volume: '10',
      quoteVolume: String(index),
      count: index,
    })));

    const result = await runMarketCommand('top', 3);

    expect(result.map(item => item.symbol)).toEqual(['PAIR3999', 'PAIR3998', 'PAIR3997']);
    expect(result.map(item => item.rank)).toEqual([1, 2, 3]);
  });

  it('fails clearly for HTTP errors and invalid ticker payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' }));
    await expect(runMarketCommand('ticker', 3)).rejects.toThrow('HTTP 429 Too Many Requests');

    mockJsonOnce({ code: -1000, msg: 'Invalid request' });
    await expect(runMarketCommand('top', 3)).rejects.toThrow('must be an array');
  });

  it('sorts gainers by numeric percent change', async () => {
    mockJsonOnce([
      { symbol: 'TEN', lastPrice: '1', priceChangePercent: '10.0', quoteVolume: '100' },
      { symbol: 'NINE', lastPrice: '1', priceChangePercent: '9.5', quoteVolume: '100' },
      { symbol: 'HUNDRED', lastPrice: '1', priceChangePercent: '100.0', quoteVolume: '100' },
    ]);

    const result = await runMarketCommand('gainers', 3);

    expect(result.map((item) => item.symbol)).toEqual(['HUNDRED', 'TEN', 'NINE']);
  });

  it('sorts losers by numeric percent change', async () => {
    mockJsonOnce([
      { symbol: 'TEN', lastPrice: '1', priceChangePercent: '-10.0', quoteVolume: '100' },
      { symbol: 'NINE', lastPrice: '1', priceChangePercent: '-9.5', quoteVolume: '100' },
      { symbol: 'HUNDRED', lastPrice: '1', priceChangePercent: '-100.0', quoteVolume: '100' },
    ]);

    const result = await runMarketCommand('losers', 3);

    expect(result.map((item) => item.symbol)).toEqual(['HUNDRED', 'TEN', 'NINE']);
    expect(result.map((item) => item.rank)).toEqual([1, 2, 3]);
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
