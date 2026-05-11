# Binance

Access **Binance** market data from the terminal via the public API (no authentication required).

**Mode**: 🌐 Public · **Domain**: `data-api.binance.vision`

## Commands

| Command | Description |
|---------|-------------|
| `opencli binance price` | Get 24h ticker stats for one symbol |
| `opencli binance prices` | Get latest prices for all symbols |
| `opencli binance ticker` | Get 24h ticker stats for all symbols |
| `opencli binance pairs` | List exchange trading pairs |
| `opencli binance trades` | Get recent trades for one symbol |
| `opencli binance depth` | Get order-book depth for one symbol |
| `opencli binance asks` | Show ask-side depth for one symbol |
| `opencli binance klines` | Get candlestick data |
| `opencli binance top` | Show top movers by volume |
| `opencli binance gainers` | Show top gainers |
| `opencli binance losers` | Show top losers |

## Usage Examples

```bash
# One symbol, 24h stats
opencli binance price BTCUSDT

# Latest prices for all pairs
opencli binance prices

# Recent trades
opencli binance trades BTCUSDT --limit 20

# Order-book depth
opencli binance depth BTCUSDT --limit 20

# 1h candles
opencli binance klines BTCUSDT --interval 1h --limit 50

# JSON output
opencli binance top -f json
```

## Prerequisites

- No browser required — uses Binance public market-data endpoints

## Notes

- Symbols use Binance market format such as `BTCUSDT` or `ETHUSDT`
- Public market-data endpoints can still be rate-limited upstream; retry if you hit transient failures
