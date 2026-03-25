# barchart

## Commands

### flow
- 用途：Barchart unusual options activity / options flow
- 参数：
  - `type`（可选）：类型 str；默认值 'all'；Filter: all, call, or put
  - `limit`（可选）：类型 int；默认值 20；Number of results
- 用法：`opencli barchart flow [options] -f json`

### greeks
- 用途：Barchart options greeks overview (IV, delta, gamma, theta, vega)
- 参数：
  - `symbol`（必填）：Stock ticker (e.g. AAPL)
  - `expiration`（可选）：类型 str；Expiration date (YYYY-MM-DD). Defaults to the nearest available expiration.
  - `limit`（可选）：类型 int；默认值 10；Number of near-the-money strikes per type
- 用法：`opencli barchart greeks [options] -f json`

### options
- 用途：Barchart options chain with greeks, IV, volume, and open interest
- 参数：
  - `symbol`（必填）：Stock ticker (e.g. AAPL)
  - `type`（可选）：类型 str；默认值 'Call'；Option type: Call or Put
  - `limit`（可选）：类型 int；默认值 20；Max number of strikes to return
- 用法：`opencli barchart options [options] -f json`

### quote
- 用途：Barchart stock quote with price, volume, and key metrics
- 参数：
  - `symbol`（必填）：Stock ticker (e.g. AAPL, MSFT, TSLA)
- 用法：`opencli barchart quote [options] -f json`
