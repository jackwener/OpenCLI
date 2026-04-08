# coupang

## Commands

### add-to-cart
- Purpose: Add a Coupang product to cart using logged-in browser session
- Args:
  - `product-id`(optional); Coupang product ID
  - `url`(optional); Canonical product URL
- Usage: `opencli coupang add-to-cart [options] -f json`

### search
- Purpose: Search Coupang products with logged-in browser session
- Args:
  - `query`(required); Search keyword
  - `page`(optional; type: int; default: 1); Search result page number
  - `limit`(optional; type: int; default: 20); Max results (max 50)
  - `filter`(optional); Optional search filter (currently supports: rocket)
- Usage: `opencli coupang search [options] -f json`
