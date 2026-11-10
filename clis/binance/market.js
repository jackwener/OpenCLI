import { CommandExecutionError } from '@jackwener/opencli/errors';

const TICKERS_URL = 'https://data-api.binance.vision/api/v3/ticker/24hr';

function numericValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchRankedTickers(limit, sortKey = 'quoteVolume', order = 'desc') {
  const response = await fetch(TICKERS_URL);
  if (!response.ok) {
    throw new CommandExecutionError(
      `Binance ticker request failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const tickers = await response.json();
  if (!Array.isArray(tickers)) {
    throw new CommandExecutionError('Binance ticker response must be an array');
  }

  const direction = order === 'asc' ? 1 : -1;
  return tickers
    .map((ticker, index) => ({ ticker, index }))
    .sort((a, b) => direction * (numericValue(a.ticker[sortKey]) - numericValue(b.ticker[sortKey]))
      || String(a.ticker.symbol ?? '').localeCompare(String(b.ticker.symbol ?? ''), undefined, { numeric: true })
      || a.index - b.index)
    .slice(0, Number(limit))
    .map(({ ticker }) => ticker);
}
