# coupang

## Commands

### add-to-cart
- 用途：Add a Coupang product to cart using logged-in browser session
- 参数：
  - `product-id`（可选）：Coupang product ID
  - `url`（可选）：Canonical product URL
- 用法：`opencli coupang add-to-cart [options] -f json`

### search
- 用途：Search Coupang products with logged-in browser session
- 参数：
  - `query`（必填）：Search keyword
  - `page`（可选）：类型 int；默认值 1；Search result page number
  - `limit`（可选）：类型 int；默认值 20；Max results (max 50)
  - `filter`（可选）：Optional search filter (currently supports: rocket)
- 用法：`opencli coupang search [options] -f json`
