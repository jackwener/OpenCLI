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

## Prerequisites

- Chrome running and logged into taobao.com
- [Browser Bridge extension](/guide/browser-bridge) installed
