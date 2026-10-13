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

提交前若已有可见推广结果，命令会拒绝执行，请先关闭旧弹窗并刷新页面。最后一次点击与旧结果基线采样在同一次页面执行中完成，同时核对商品链接、网站名称、推广位名称及已有推广位模式。结果出现后继续核对这些字段；多个可见弹窗或表单目标改变会报错。隐藏旧弹窗中的商品长链也纳入基线，旧节点重新显示、复制旧链接或返回相同旧值都不能证明本次生成成功；命令会等待商品长链实际更新，超时后停止，不重新提交。

网站或推广位下拉框在请求未返回时可能暂显“无数据”；命令等待真实选项出现后再匹配名称，持续空列表也受总超时限制。

未登录或需要安全验证时返回认证错误；名称不存在、同名或禁用时返回参数错误；京东提示“访问频繁”时返回执行错误且不自动重试；结果未出现时返回超时错误。遇到风控请在网页核实并等待京东解除限制。

测试包含脱敏的真实表单和手动生成成功弹窗。2026-10-13 通过标准命令调度器与真实浏览器桥接验证：修复后的命令已等待网站列表及推广位加载、核对表单并提交一次，但京东仍返回“访问频繁”。命令正确停止，尚未取得本次自动生成的长链，完整自动成功流程仍待补验。
