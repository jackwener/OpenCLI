# Binance

**Mode**: 🔓 Public · **Domain**: `data-api.binance.vision`

## Commands

| Command | Description |
|---------|-------------|
| `opencli binance pairs` | List active trading pairs on Binance |
| `opencli binance price` | Get price for a specific symbol |
| `opencli binance prices` | Get prices for multiple symbols |
| `opencli binance ticker` | Get 24h ticker for a symbol |
| `opencli binance top` | Get top traders (buyer/maker) |
| `opencli binance depth` | Get order book depth |
| `opencli binance trades` | Get recent trades |
| `opencli binance klines` | Get candlestick data |
| `opencli binance losers` | Get top losers |
| `opencli binance gainers` | Get top gainers |
| `opencli binance asks` | Get best ask orders |

## Usage Examples

```bash
# List trading pairs
opencli binance pairs --limit 10

# Get price for BTC/USDT
opencli binance price BTCUSDT

# Get multiple prices
opencli binance prices BTCUSDT ETHUSDT

# Get 24h ticker
opencli binance ticker BTCUSDT

# Get candlestick data
opencli binance klines BTCUSDT --interval 1h --limit 100
```

## Prerequisites

None - no login required, uses public Binance API