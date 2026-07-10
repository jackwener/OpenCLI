# SHEIN

**Mode**: 🔐 Browser · **Primary domain**: `sso.geiwohuo.com`

OpenCLI supports SHEIN seller GSP session checks, aftersales order export, and product feedback export through a live Chrome profile with the Browser Bridge extension enabled.

## Commands

| Command | Description |
|---------|-------------|
| `opencli shein login` | Open the SHEIN SSO login page, optionally autofill credentials, and wait for the GSP aftersales session to become usable |
| `opencli shein whoami` | Probe whether the current SHEIN GSP session is ready |
| `opencli shein aftersales` | Export SHEIN aftersales orders and flatten each order by goods row |
| `opencli shein feedback` | Export SHEIN product feedback rows |

## Usage Examples

```bash
# Login with environment-provided credentials
SHEIN_USERNAME=... SHEIN_PASSWORD=... \
opencli --profile profile1 shein login -f json

# Check the current GSP session
opencli --profile profile1 shein whoami -f json

# Export the first 10 aftersales goods rows
opencli --profile profile1 shein aftersales --limit 10 -f json

# Export aftersales rows newer than a known request time
opencli --profile profile1 shein aftersales \
  --sinceRequestTime "2026-07-06 19:26:29" \
  --requestTimeout 120 \
  -f json

# Export product feedback for a time window
opencli --profile profile1 shein feedback \
  --sinceCommentTime "2026-07-01 00:00:00" \
  --untilCommentTime "2026-07-07 23:59:59" \
  --requestTimeout 120 \
  -f json
```

## Login And Profiles

- The adapter uses the Browser Bridge profile selected by `opencli --profile`, not a Chrome profile folder path.
- Run `opencli profile list` to see connected Browser Bridge profile ids and aliases.
- Use `opencli profile rename <id> profile1` to give a connected profile a stable alias.
- The selected Chrome profile must already have the Browser Bridge extension installed and connected.
- `opencli shein login` reads `--username` / `--password`, or the `SHEIN_USERNAME` / `SHEIN_PASSWORD` environment variables.
- `whoami` and data commands depend on the SHEIN GSP subsystem session, not just the SSO login form being submitted.

## Aftersales Export

`opencli shein aftersales` opens:

```text
https://sso.geiwohuo.com/#/gsp/order-management/after-sales-list
```

It captures the first `/gsp/aftersalesOrder/list` request from the page, replays list pagination through the page session, then captures order detail and evidence requests for fields that are not present on the list response.

### Aftersales Options

| Option | Description |
|--------|-------------|
| `--limit <n>` | Maximum number of aftersales orders to process. Omit for all pages available from the list response. |
| `--sinceRequestTime <time>` | Keep rows with `requestTime` greater than this value. Accepts `YYYY-M-D` or `YYYY-M-D HH:mm[:ss]`. |
| `--maxPages <n>` | Maximum list pages to fetch, useful for bounded tests. |
| `--timeout <seconds>` | Whole command timeout. Defaults to `1800`. |
| `--requestTimeout <seconds>` | Timeout for a single page-side API capture or request. Defaults to `60`. |
| `--retryAttempts <n>` | Retry count for page-side API requests. Defaults to `3`. |
| `--retryDelayMs <ms>` | Base retry delay. Defaults to `1000`. |

### Aftersales Output Fields

```text
requestTime, aftersalesOrderNo, returnOrderNo, orderNo, site,
orderSubStatusName, aftersalesResolutionPlanName, refundMethod,
sellerResolutionPlanName, sellerInstruction, etaTime, goodsThumb,
goodsTitle, goodsSn, suffix, skuSn, quantity, afterSalesReason,
buyerInstruction, returnExpressNos, return_attachments, priceAmount,
checkEstimateIncomeMoney, returnExpense, performancePrice,
promotionAmount, refundRatio, estimateIncomeMoney, goodsSettlePrice,
goodsServiceCharge, freezeAmount
```

Notes:

- `returnExpressNos` comes from the list response `returnExpressInfoList[].expressNo`.
- `buyerInstruction`, `sellerResolutionPlanName`, and `sellerInstruction` come from the evidence work order detail capture when available.
- `refundRatio` comes from the aftersales detail response.
- `refundMethod` is derived from `aftersalesResolutionPlanName` and `refundRatio`.
- `afterSalesReason` is normalized to a comma-separated string.

## Product Feedback Export

`opencli shein feedback` opens:

```text
https://sso.geiwohuo.com/#/mgs/store-management/product-feedback
```

It captures `/mgs-api-prefix/goods/comment/list`, injects the requested comment time range into the captured request body, replays page 1 and later pages through the browser session, and keeps a local comment-time filter as a final guard.

### Feedback Options

| Option | Description |
|--------|-------------|
| `--limit <n>` | Maximum number of feedback rows. |
| `--perPage <n>` | Page size for replayed list requests. |
| `--maxPages <n>` | Maximum list pages to fetch. |
| `--sinceCommentTime <time>` | Keep rows with `commentTime` greater than this value. Accepts `YYYY-M-D` or `YYYY-M-D HH:mm[:ss]`. |
| `--untilCommentTime <time>` | Keep rows with `commentTime` less than or equal to this value. Accepts `YYYY-M-D` or `YYYY-M-D HH:mm[:ss]`. |
| `--timeout <seconds>` | Whole command timeout. Defaults to `3600`. |
| `--requestTimeout <seconds>` | Timeout for a single page-side API capture or request. Defaults to `60`. |
| `--retryAttempts <n>` | Retry count for page-side API requests. Defaults to `3`. |
| `--retryDelayMs <ms>` | Base retry delay. Defaults to `1000`. |

### Feedback Output Fields

```text
commentId, countrySiteCn, supplierId, goodsTitle, goodsThumb,
goodsAttribute, goodsUrl, goodSn, spu, skc, sku, goodsCommentStar,
goodsCommentStarName, goodsCommentContent, goodsCommentImages,
logisticCommentStar, logisticCommentContent, commentTime, orderTime,
billNo, memberOverallFitLabelList, badCommentLabelList
```

When time filters are passed, the adapter sets `startCommentTime` and `commentEndTime` on the replayed list API body before fetching page 1 and later pages. `goodsCommentImages` is returned as an array. `memberOverallFitLabelList` and `badCommentLabelList` are flattened to comma-separated label strings.

## MaybeAI Sheet Sync Scripts

Two helper scripts sync SHEIN CLI output into MaybeAI Sheet with `update_data_keep_headers`.

They require:

```bash
export MAYBEAI_API_TOKEN=...
export SHEIN_USERNAME=...
export SHEIN_PASSWORD=...
```

Both scripts:

- Run `opencli shein whoami` before fetching data.
- Run `opencli shein login` first when the GSP session is unavailable.
- Read existing sheet data without a fixed range by default.
- Merge rows by the script-specific unique key.
- Sort merged rows descending by the business time column before writing.
- Write data rows with `update_data_keep_headers`, preserving the existing header row.
- Save the raw CLI JSON in the current working directory.

### Sync Aftersales To Sheet

Script:

```bash
python3 scripts/sync-shein-aftersales-to-sheet.py \
  --profile profile1 \
  --sheet-url "https://www.maybe.ai/docs/spreadsheets/d/<doc-id>?gid=<gid>" \
  --store 店3
```

Important options:

| Option | Description |
|--------|-------------|
| `--since-request-time <time>` | Explicit incremental cutoff. If omitted, the script reads the sheet and uses the max `退款申请时间` for the selected store. |
| `--limit <n>` | Optional bounded test limit. |
| `--max-pages <n>` | Optional bounded page count. |
| `--profile <id-or-alias>` | Browser Bridge profile id or alias. |
| `--sheet-url <url>` | Target MaybeAI spreadsheet URL with `gid`. |
| `--store <name>` | Value written to the `店铺` column. Defaults to `店3`. |
| `--request-timeout <seconds>` | Passed to `opencli shein aftersales --requestTimeout`. |
| `--attempts <n>` | Whole SHEIN CLI retry attempts. Defaults to `3`. |
| `--preflight-login` / `--no-preflight-login` | Enable or disable the `whoami` preflight. Enabled by default. |

Raw JSON is saved as:

```text
<店铺>售后数据.json
```

Sheet headers:

```text
店铺,站点,退款申请时间,退款产品图片,售后单号,订单号,商品SKU,售后处理方案,售后申请类型,退款原因描述,退款附件,商品结算总金额,退货率约服务费,预计退货总支出,是否已退款,退款方式,退回单号,备注(退款解析)
```

Unique key:

```text
店铺 + 站点 + 退款申请时间 + 售后单号 + 订单号 + 商品SKU
```

### Sync Product Feedback To Sheet

Script:

```bash
python3 scripts/sync-shein-feedback-to-sheet.py \
  --profile profile1 \
  --sheet-url "https://www.maybe.ai/docs/spreadsheets/d/<doc-id>?gid=<gid>" \
  --store 店3
```

Important options:

| Option | Description |
|--------|-------------|
| `--start-time <time>` | Start comment time. Defaults to yesterday `00:00:00`. Passed to `--sinceCommentTime`. |
| `--end-time <time>` | End comment time. Defaults to today `23:59:59`. Passed to `--untilCommentTime`. |
| `--limit <n>` | Optional bounded test limit. |
| `--per-page <n>` | Optional feedback page size. |
| `--max-pages <n>` | Optional bounded page count. |
| `--profile <id-or-alias>` | Browser Bridge profile id or alias. |
| `--sheet-url <url>` | Target MaybeAI spreadsheet URL with `gid`. |
| `--store <name>` | Value written to the `店铺` column. Defaults to `店3`. |
| `--request-timeout <seconds>` | Passed to `opencli shein feedback --requestTimeout`. |
| `--attempts <n>` | Whole SHEIN CLI retry attempts. Defaults to `3`. |
| `--preflight-login` / `--no-preflight-login` | Enable or disable the `whoami` preflight. Enabled by default. |

When a date is provided without a time, `--start-time 2026-7-1 --end-time 2026-7-7` becomes:

```text
sinceCommentTime = 2026-07-01 00:00:00
untilCommentTime = 2026-07-07 23:59:59
```

The CLI filter is `commentTime > sinceCommentTime` and `commentTime <= untilCommentTime`.

Raw JSON is saved as:

```text
<店铺>商品评价数据.json
```

Sheet headers:

```text
店铺,评价时间,评论ID,国家站点,SPU,SKC,商品SKU,商品评分,商品评分名称,商品评价内容,商品评价图片,物流评分,物流评价内容,下单时间,订单号,合身标签,差评标签
```

Unique key:

```text
店铺 + 评价时间 + 评论ID
```

## Troubleshooting

- If `opencli profile list` says the daemon is not running, open Chrome with the Browser Bridge extension enabled and retry.
- If a Chrome profile such as `Profile 1` is needed, enable Browser Bridge in that Chrome profile first, then rename the connected OpenCLI profile id with `opencli profile rename`.
- If `whoami` fails after `login` succeeds, the SSO login completed but the GSP subsystem session is not ready. Retry `opencli shein login` and keep the GSP aftersales page open.
- If a list capture times out, raise `--requestTimeout`, rerun after `opencli shein login`, or reduce scope with `--limit` / `--maxPages` while debugging.
- Avoid running multiple SHEIN browser commands in parallel against the same Browser Bridge profile.
