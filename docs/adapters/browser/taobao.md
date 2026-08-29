# Taobao

**Mode**: 🔐 Browser · **Domain**: `taobao.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli taobao search <query>` | Search Taobao products |
| `opencli taobao detail <id>` | Fetch product details |
| `opencli taobao reviews <id>` | Fetch product reviews |
| `opencli taobao cart` | View shopping cart items |
| `opencli taobao add-cart <id>` | Add a product to cart |
| `opencli taobao sessions [query]` | List seller customer service sessions |
| `opencli taobao chat <seller>` | Fetch complete chat history with seller (auto backward pagination) |
| `opencli taobao orders [query]` | Fetch 10-year bought items / orders (multi-page pagination) |
| `opencli taobao bought-shops [query]` | Fetch bought shops inventory with category filters |
| `opencli taobao favorites [query]` | Fetch collected items / favorites list |
| `opencli taobao reason <seller>` | AI semantic reasoning over seller commitments & dispute evidence |
| `opencli taobao export <seller>` | Export chat history to Markdown / HTML / JSON |
| `opencli taobao sync` | High-speed in-browser batch session & chat sync |

## Usage Examples

```bash
# 1. Search products
opencli taobao search "机械键盘" --limit 5

# 2. Fetch product details
opencli taobao detail 827563850178

# 3. Dry-run add to cart
opencli taobao add-cart 827563850178 --spec "红色 XL" --dry-run

# 4. List seller sessions
opencli taobao sessions --limit 20 -f table

# 5. Extract seller chat history
opencli taobao chat "鑫鼎数码专营店" --limit 50 -f table

# 6. Fetch historical orders
opencli taobao orders --pages 3 -f table

# 7. Fetch bought shops
opencli taobao bought-shops --category "数码" -f table

# 8. Fetch favorites
opencli taobao favorites --limit 20 -f table

# 9. Semantic reasoning on seller commitments
opencli taobao reason "美日韩电玩" -f yaml

# 10. Export chat to HTML
opencli taobao export "郭氏永盛旗舰店" --format html --output ./chat.html
```

## Prerequisites

- Chrome running and logged into taobao.com
- [Browser Bridge extension](/guide/browser-bridge) installed
