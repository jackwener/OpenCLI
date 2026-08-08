# ChanMama (蝉妈妈)

**Mode**: 🔐 Browser · **Domain**: `chanmama.com`

ChanMama is a third-party Douyin commerce analytics service. These read-only
commands expose the product, creator, video, live-room, product-card, and
audience data visible to the logged-in account.

## Commands

| Command | Description |
|---------|-------------|
| `opencli chanmama categories` | Read or search the product category tree |
| `opencli chanmama products` | Search the product ranking with category, period, commission, sales, and channel filters |
| `opencli chanmama product <promotion-id>` | Read product details, shop metadata, commission, and the 30-day overview |
| `opencli chanmama product-analysis <promotion-id>` | Read daily sales estimates and the video/live/product-card and creator-channel breakdowns |
| `opencli chanmama authors <promotion-id>` | Read associated creators and their video/live sales estimates |
| `opencli chanmama videos <promotion-id>` | Read associated commerce videos with sales and engagement sorting |
| `opencli chanmama video <aweme-id>` | Read one video's details, stable Douyin URL, trends, diagnosis, and related videos |
| `opencli chanmama live <promotion-id>` | Read associated live rooms with audience and sales estimates |
| `opencli chanmama card <promotion-id>` | Read the daily product-card sales trend |
| `opencli chanmama audience <promotion-id>` | Read product audience and buyer profiles |
| `opencli chanmama author-sales-videos <author-id>` | Read a creator's moving products videos by period and traffic source |

## Usage Examples

```bash
# Find a category id, then search the product ranking
opencli chanmama categories --query 钓鱼 --limit 200 -f json
opencli chanmama products --category 20528 --days 30 \
  --sort duration_aweme_amount --limit 20 -f json

# Drill into a promotion_id returned by products
opencli chanmama product <promotion-id> -f json
opencli chanmama product-analysis <promotion-id> --limit 30 -f json
opencli chanmama authors <promotion-id> --limit 20 -f json

# Compare associated videos, live rooms, product-card sales, and audiences
opencli chanmama videos <promotion-id> --has-sales true \
  --sort publishTime --order desc --limit 10 -f json
opencli chanmama live <promotion-id> --limit 10 -f json
opencli chanmama card <promotion-id> --limit 30 -f json
opencli chanmama audience <promotion-id> -f json

# Drill into IDs returned by videos and authors
opencli chanmama video <aweme-id> -f json
opencli chanmama author-sales-videos <author-id> --days 30 \
  --new-only true --source homepage --limit 20 -f json
```

## Prerequisites

- Chrome running and **logged into** `chanmama.com`
- A ChanMama account with access to the requested analytics pages
- [Browser Bridge extension](/guide/browser-bridge) installed

## Data and Safety Notes

- Every command is read-only. The adapter reads already-rendered, decrypted Vue
  page state and does not reproduce ChanMama's encryption or call write actions.
- Sales, revenue, exposure, conversion, and audience values are third-party
  estimates. Preserve the returned ranges and `valueTypes` metadata when using
  them in downstream analysis.
- ChanMama can represent masked numeric fields with `-2147483648` and `"-"`.
  The adapter returns `null` for these sentinels instead of treating them as
  real values.
- `promotion-id`, `aweme-id`, and `author-id` are ChanMama identifiers. Prefer
  IDs returned by the preceding list command instead of parsing page URLs.
- A valid empty result can mean that the logged-in account lacks access to the
  requested category or detail page. The adapter fails closed and does not
  silently widen filters.

## Troubleshooting

- If a command reports that login is required, log into ChanMama in the Chrome
  profile connected to Browser Bridge and retry.
- If an analytics component does not load, open the same page in Chrome and
  confirm the account can see that tab.
- Use `opencli browser verify chanmama/<command>` after creating local
  verification fixtures for repeatable live checks.
