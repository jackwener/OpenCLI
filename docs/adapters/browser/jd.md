# JD.com

**Mode**: 🔐 Browser · **Domains**: `item.jd.com`, `union.jd.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli jd item <sku>` | Fetch product details (price, shop, specs, AVIF images) |
| `opencli jd promotion-link <sku> --website <name> --position <name>` | 使用京东联盟已有网站和推广位生成商品推广长链 |

## Usage Examples

```bash
# Get product details by SKU
opencli jd item 100291143898

# Limit returned AVIF images
opencli jd item 100291143898 --images 5

# JSON output
opencli jd item 100291143898 -f json
```

## Prerequisites

- Chrome running and **logged into** jd.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## 京东联盟网站推广长链

```bash
opencli jd promotion-link 100291143898 \
  --website "示例网站" --position "示例推广位" -f json
```

先在 Chrome 登录 `union.jd.com`，确认账号能使用“自定义链接推广”的“网站推广”。网站媒体和其下的推广位须已存在；两个参数使用页面中的完整名称，命令不会创建网站或推广位。可用 `--timeout 60` 调整总等待时间（默认 30 秒，范围 1–120 秒）。

命令填写商品页链接，选择网站及推广位，点击一次“获取推广链接”，再读取结果弹窗的“长链接 → 商品链接”。返回字段为 `sku`、`website`、`position`、`sourceUrl` 和 `promotionUrl`；推广长链只接受 HTTPS 的 `union-click.jd.com` 域名。优惠券链接、短链和旧弹窗不会作为商品推广长链输出。

未登录或需要安全验证时返回认证错误；名称不存在、同名或禁用时返回参数错误；京东提示“访问频繁”时返回执行错误且不自动重试；结果未出现时返回超时错误。遇到风控请在网页核实并等待京东解除限制。

当前真实页面已核验表单和名称选择，测试覆盖结果读取及失败边界。京东在开发验证时对网页手动生成和自动生成均返回 HTTP 403 /“访问频繁”，因此真实转链成功流程尚待补验。
