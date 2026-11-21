# Taobao

**Mode**: 🔐 Browser · **Domain**: `taobao.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli taobao search <query>` | Search Taobao products |
| `opencli taobao detail <id>` | Fetch product details |
| `opencli taobao reviews <id>` | Fetch product reviews |
| `opencli taobao cart` | View cart items |
| `opencli taobao add-cart <id>` | Add a product to cart |

## Usage Examples

```bash
# Search products
opencli taobao search "机械键盘" --limit 5

# Fetch product details
opencli taobao detail 827563850178

# Dry-run add to cart
opencli taobao add-cart 827563850178 --spec "红色 XL" --dry-run
```

## Price fields

Search returns the displayed card amount as `price_num`. `price_basis` identifies
an explicitly labelled listing, activity, coupon, or estimated price; an
unlabelled amount remains `displayed_card`. Raw page text stays internal.

Detail keeps the listing price, coupon discount amount, coupon-adjusted price,
and estimated payable separate. Missing amounts remain null, and no checkout
total is inferred from a product page.

## Prerequisites

- Chrome running and logged into taobao.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Add-to-cart confirmation

`add-cart` supports both text and compact icon-only buttons. It clicks only one
visible, enabled match and requires a new success message before reporting success.
Missing or ambiguous buttons, additional required specifications, and unconfirmed
outcomes return errors. For an unconfirmed outcome, check the cart before retrying
to avoid adding the item twice.

Product, search, review, and add-to-cart commands stop on detected login or security
verification pages. Resolve those in the browser before running another command.
