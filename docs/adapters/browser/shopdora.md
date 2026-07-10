# Shopdora

**Mode**: 🔐 Browser · **Primary domain**: `www.shopdora.com`

OpenCLI supports querying Shopdora product data from a Shopee product URL.

## Commands

| Command | Description |
|---------|-------------|
| `opencli shopdora product <shopee-url>` | Open `https://www.shopdora.com/my/product`, fill the `产品id` search input with the Shopee URL, capture `/api/product/search`, and return the mapped product fields |
| `opencli shopdora search <keyword> --region <site>` | Open `https://www.shopdora.com/my/product#hot`, select the region, fill the `搜索热门产品` input with the keyword, capture `/api/product/search`, and return the result list with Shopee product URLs |
| `opencli shopdora product-shopdora-download <shopee-product-url>` | Open `https://www.shopdora.com/my/analysis/comment`, reuse an existing completed task or submit the Shopee product link through the add dialog, open the comment-detail page from `taskKey`, apply the low-star/media/date filters, download the Excel, and return the local file link |

## Usage Example

```bash
opencli shopdora product "https://shopee.sg/...-i.123.456" -f json
opencli shopdora search "shoe" --region sg -f json
opencli shopdora product-shopdora-download "https://shopee.sg/...-i.123.456" -f json
```

## Prerequisites

- Chrome running with an active Shopdora session in the shared profile
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- The command depends on Shopdora's search form and `/api/product/search` response shape.
- `product-shopdora-download` waits for existing task reuse to reach progress `100`. For newly added products, it builds the `newComment` detail URL as soon as Shopdora returns `taskKey`, using `site`, `taskKey`, and `shopId`, then downloads the filtered comment Excel and returns both `task_key` and the local file path/URL.
- If you get `Shopdora 未登录`, sign in to `https://www.shopdora.com` in Chrome and retry.
