# Coinpaprika

**Mode**: 🌐 Public · **Domain**: `coinpaprika.com`

Cryptocurrency listing + per-coin live ticker from the public REST API at `api.coinpaprika.com/v1`. No auth, no API key, generous rate limits on the free tier. Stable schema, ranks ~3000 coins.

## Commands

| Command | Description |
|---------|-------------|
| `opencli coinpaprika coins` | Listing of all coins (id, name, symbol, rank, type) |
| `opencli coinpaprika ticker <coin-id>` | Live price + market cap + supply for a single coin |

## Usage Examples

```bash
# Coin listing
opencli coinpaprika coins --limit 20
opencli coinpaprika coins --active --limit 50
opencli coinpaprika coins --limit 1000

# Live ticker (use coins to find an id)
opencli coinpaprika ticker btc-bitcoin
opencli coinpaprika ticker eth-ethereum
opencli coinpaprika ticker sol-solana
```

## Output Columns

| Command | Columns |
|---------|---------|
| `coins` | `rank, id, name, symbol, type, isNew, isActive, coinRank` |
| `ticker` | `id, name, symbol, rank, priceUsd, volume24hUsd, marketCapUsd, percentChange1h, percentChange24h, percentChange7d, totalSupply, maxSupply, circulatingSupply, firstDataAt, lastUpdated` |

`coinRank` is the upstream Coinpaprika rank (1-based). The `rank` column on `coins` is the row index after sorting/filtering and is what the table view displays.

## Options

### `coins`

| Option | Description |
|--------|-------------|
| `--limit` | Max rows (1–1000, default 50). Server returns the full list; client-side slice. |
| `--active` | Only include coins where `is_active === true` (filters out delisted). |

### `ticker`

| Option | Description |
|--------|-------------|
| `<coin-id>` | Required positional. Coinpaprika coin id (lowercased automatically; e.g. `btc-bitcoin`). |

## Notes

- **`rank: 0` means "not ranked".** Upstream uses `0` as a sentinel for unranked coins. Adapter sorts those to the end with `Number.POSITIVE_INFINITY` and surfaces them as `coinRank: null` so the column doesn't lie.
- **`coins → ticker` round-trip.** The `id` column on `coins` is exactly what `ticker <coin-id>` expects. No transformation needed.
- **USD quotes only.** `ticker` flattens `quotes.USD.*` to top-level `priceUsd / volume24hUsd / marketCapUsd / percentChange*`. For other quote currencies the upstream supports `?quotes=BTC,EUR` but this adapter doesn't expose it.
- **Coin id is lowercased.** `ticker BTC-Bitcoin` and `ticker btc-bitcoin` both work — the positional is normalised to lowercase before the URL is built.
- **Errors.** `--limit` out of range → `ArgumentError`; missing `<coin-id>` → `ArgumentError`; coin not found / empty result → `EmptyResultError`; 429 → `CommandExecutionError` with rate-limit hint; other non-200 → `CommandExecutionError`.
