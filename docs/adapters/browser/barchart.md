# Barchart

**Mode**: 🔐 Browser · **Domain**: `barchart.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli barchart quote` | Stock quote with price, volume, and key metrics |
| `opencli barchart options` | Options chain with greeks, IV, volume, and open interest |
| `opencli barchart greeks` | Options greeks overview (IV, delta, gamma, theta, vega) |
| `opencli barchart flow` | Unusual options activity / options flow |

## Usage Examples

```bash
# Get stock quote
opencli barchart quote AAPL

# View options chain
opencli barchart options TSLA

# Options greeks overview
opencli barchart greeks NVDA

# Unusual options flow
opencli barchart flow --limit 20 -f json
```

## Prerequisites

- Chrome running and able to open `barchart.com`
- [Browser Bridge extension](/guide/browser-bridge) installed
