# barchart

## Commands

### flow
- Purpose: Barchart unusual options activity / options flow
- Args:
  - `type`(optional; type: str; default: 'all'); Filter: all, call, or put
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli barchart flow [options] -f json`

### greeks
- Purpose: Barchart options greeks overview (IV, delta, gamma, theta, vega)
- Args:
  - `symbol`(required); Stock ticker (e.g. AAPL)
  - `expiration`(optional; type: str); Expiration date (YYYY-MM-DD). Defaults to the nearest available expiration.
  - `limit`(optional; type: int; default: 10); Number of near-the-money strikes per type
- Usage: `opencli barchart greeks [options] -f json`

### options
- Purpose: Barchart options chain with greeks, IV, volume, and open interest
- Args:
  - `symbol`(required); Stock ticker (e.g. AAPL)
  - `type`(optional; type: str; default: 'Call'); Option type: Call or Put
  - `limit`(optional; type: int; default: 20); Max number of strikes to return
- Usage: `opencli barchart options [options] -f json`

### quote
- Purpose: Barchart stock quote with price, volume, and key metrics
- Args:
  - `symbol`(required); Stock ticker (e.g. AAPL, MSFT, TSLA)
- Usage: `opencli barchart quote [options] -f json`
