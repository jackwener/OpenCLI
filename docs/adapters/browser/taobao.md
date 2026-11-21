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

## Security verification

Product, search, review, cart, and add-to-cart commands stop on detected login or
security verification pages. When an Alibaba NoCaptcha / Baxia slider is present,
the adapter automatically drags it with trusted CDP mouse events (up to three
attempts, including clicking the "验证失败，点击框体重试" reset prompt). The same
handle works when the challenge is rendered inside a cross-origin Baxia/punish
iframe. One-tap smart verification and scratch challenges are also attempted.
A timed-out drag or an unconfirmed mouse release stops the command rather than
starting another attempt.

The solver does not change window focus for a normal attempt. Only after a
slider attempt fails, and only if the tab reports `hidden`, does it try
`Page.bringToFront` (falling back to selecting the current automation tab) and
refresh the page if it is still hidden. If it still cannot become visible, it
stops instead of hanging. This requires reloading the Browser Bridge extension
after updating it.

Click-order, rotate, face, and SMS challenges have no reliable local solver; after
three attempts they still return `SECURITY_BLOCK` and must be resolved in the
browser. Set `OPENCLI_SOLVE_CAPTCHA=0` to disable automatic dragging.
