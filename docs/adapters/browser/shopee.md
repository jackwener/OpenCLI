# Shopee

**Mode**: 🔐 Browser · **Primary domains**: `shopee.sg`, `shopee.com.my`

OpenCLI supports Shopee product search, product detail extraction, and Shopdora review export.

## Commands

| Command | Description |
|---------|-------------|
| `opencli shopee search <query>` | Search Shopee product links and return `rank`, `product_url`, and `title`; defaults to `https://shopee.com.my` and accepts `--origin` for other Shopee regions |
| `opencli shopee browse <url>` | Run a read-only browse rehearsal from a Shopee search/product/shop page and return the visited path plus the next selected candidate at each step |
| `opencli shopee product <product-url>` | Read a Shopee product page and extract visible product, pricing, seller, variant, media, and Shopdora-annotated fields |
| `opencli shopee product-sku <product-url>` | Click every enabled Shopee variation button combination, watch `select_variation_pc`, and return per-SKU stock |
| `opencli shopee product-shopdora-download <product-url>` | Run the Shopdora export-review workflow from a Shopee product page and wait for the downloaded CSV |

## Usage Examples

```bash
# Search Shopee product links
opencli shopee search "wireless earbuds" --origin https://shopee.sg --limit 10 -f json

# Run a short browse rehearsal from a search page
opencli shopee browse "https://shopee.sg/search?keyword=wireless+earbuds" --steps 3 -f json

# Run a 10-minute read-only public browse plan from the Shopee home page
opencli shopee browse "https://shopee.sg/" --duration-min 10 --steps 120 --search-terms shoes,shirt -f json

# Run the same browse plan with per-step action logs on stderr
opencli shopee browse "https://shopee.sg/" --duration-min 10 --steps 120 --search-terms shoes,shirt --action-log -f json

# Run browse against a local mock site during adapter development
opencli shopee browse "https://mock.shopee.test/product/101/201" --mock --steps 3 -f json

# Read one Shopee product page
opencli shopee product "https://shopee.sg/...-i.123.456" -f json

# Read per-SKU stock for a Shopee product
opencli shopee product-sku "https://shopee.sg/...-i.123.456" -f json

# Export Shopdora review CSV for the same product
opencli shopee product-shopdora-download "https://shopee.sg/...-i.123.456" -f json
```

## Prerequisites

- Chrome running with an active Shopee session in the shared profile
- [Browser Bridge extension](/guide/browser-bridge) installed
- For `search`, sign in to the Shopee origin you plan to query if that market prompts for login
- For `browse`, pass `--mock` if you are exercising the command against a local mock site on `localhost` or a `.test` host during development
- For `product-sku`, keep the target product page reachable in Chrome; the command clicks the live variation buttons and depends on Shopee's variation API responses
- For `product-shopdora-download`, Shopdora must already be logged in on the product page if you want the export to succeed
- For `product-shopdora-download`, your Browser Bridge build must support download tracking

## Notes

- `search` defaults to `https://shopee.com.my`; use `--origin https://shopee.sg` or another Shopee host to search a different region.
- `browse` is intentionally read-only. It scrolls, inspects visible candidates, waits briefly, and navigates with `page.goto`; it does not add to cart, submit forms, or attempt to mimic account-state changes.
- `browse` only follows public browse paths. It explicitly skips account, cart, checkout, purchase, login, and notification routes such as `/user/account/profile` and `/user/account/address`.
- `browse` accepts `--duration-min` for time-budgeted runs. If the current page has no public candidates, it falls back to public search seeds from `--search-terms` such as `shoes,shirt`.
- `browse` accepts `--steps`, `--duration-min`, `--inspect-limit`, `--search-terms`, `--dwell-min-ms`, and `--dwell-max-ms` so you can tune the rehearsal depth and wait time when verifying the skeleton on a mock site.
- `browse` now defaults to `--dwell-min-ms 3500` and `--dwell-max-ms 6500`, so step-to-step dwell averages about 5 seconds if you do not override it.
- `browse` has a command timeout of 900 seconds by default so a 10-minute browse plan can finish without requiring `OPENCLI_BROWSER_COMMAND_TIMEOUT`.
- `browse` supports `--action-log`, or `OPENCLI_ACTION_LOG=1`, to emit one stderr log line per action such as `action:step_start`, `action:navigate_done`, `action:inspect_done`, and `action:dwell_done`.
- Under `--action-log`, the command also emits a simple state line: `action:status value:ok` on normal pages, and `action:status value:not_ok reason:new_captcha` when Shopee returns the `#NEW_CAPTCHA` read-error screen.
- `browse` stops immediately when the page shows the `#NEW_CAPTCHA` read-error container, and returns the extracted reason text instead of continuing.
- `product` returns page-visible Shopee fields even if Shopdora is not logged in. In that case `shopdora_login_message` will be populated.
- `product-sku` outputs one row per selected SKU combination. Fields include `sku`, `stock`, `stock_source`, plus JSON-encoded `group_names` and `option_labels` for the clicked selection path.
- `product-sku` prefers live API stock from `https://shopee.sg/api/v4/pdp/cart_panel/select_variation_pc`; if the Browser Bridge cannot expose network capture for the initial default selection, it falls back to the visible stock text currently rendered on the page.
- `product-sku` has a 10-minute adapter timeout, and it only waits briefly for selection/capture on each click, because exhaustive variant traversal on multi-option listings routinely exceeds the global 60-second default.
- `product-shopdora-download` opens the export dialog, shifts the time-period start date from the current value by `-3 months + 7 days`, enables the review-image detail filter when available, and waits for the CSV download to finish.
- The download command has a long timeout because Shopdora export generation can be slow.
- Output fields for the download flow include `status`, `message`, `local_url`, `local_path`, `product_url`, and `shopdora_login_message`.

## Troubleshooting

- If `search` returns `Shopee login required`, open the same Shopee origin in Chrome, complete login, and retry.
- If you get `Shopdora 未登录`, log into Shopdora on the real Shopee product page in Chrome and retry.
- If the download command says download tracking is unavailable, reload or upgrade the Browser Bridge extension.
- If the wrong tab is active, retry after opening the target Shopee product page directly in Chrome.
