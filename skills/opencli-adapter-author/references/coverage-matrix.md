# Coverage Matrix

skill 明确承诺能搞定什么、搞不定什么。动手前先看一眼这张表，判断目标站落在哪一格。

**状态标记**：
- ✅ **已验证**：有可跑通的真实 adapter / dry-run 证据
- 🟡 **已列招但未硬跑**：文档把方法写全了，但这一版没拿真实站点跑过；第一次遇到时按文档走，踩坑回来补 `site-memory`
- ❌ **不支持**：skill 明确不碰，走绕开方案

---

## 支持（skill 里有对应的招）

| 维度 | 支持 | 状态 | 走哪节 |
|------|------|------|-------|
| 页面形态 | 列表页 / 排行页 | ✅ | `adapter-template.md`（convertible.js / rank.js 类） |
| | 详情页（单对象） | ✅ | `adapter-template.md`（stock.js / holders.js 类） |
| | 时间序列（K 线 / 分钟线） | ✅ | `adapter-template.md`（kline.js） |
| | 嵌套列表（列表里含列表） | 🟡 | `adapter-template.md` + `output-design.md` 打平规则 |
| 站点类型 | SPA（React/Vue，JSON XHR） | ✅ | `site-recon.md` Pattern A + `api-discovery.md` §network |
| | SSR（HTML with inline data） | 🟡 | `site-recon.md` Pattern B + `api-discovery.md` §state |
| | JSONP / push/script[src] | ✅ | `site-recon.md` Pattern C + `api-discovery.md` §bundle（eastmoney / tonghuashun 已覆盖） |
| | SPA + 独立 BFF domain | 🟡 | `api-discovery.md` §bundle §suffix |
| 鉴权 | 裸 `fetch()` 拿到（PUBLIC） | ✅ | `Strategy.PUBLIC + browser:false`（coingecko dry run 验证） |
| | cookie | ✅ | `Strategy.COOKIE + browser:true` + `credentials:'include'`（xueqiu / bilibili 已覆盖） |
| | Bearer + X-Csrf-Token | 🟡 | `Strategy.HEADER` + 在 `page.evaluate` 拼 header |
| | 页面能发但独立 fetch 不行 | 🟡 | `Strategy.INTERCEPT` |
| 字段形态 | 自解释（`title / price / current`） | ✅ | 直接映射 |
| | 已登记代号 | ✅ | `field-conventions.md` 查表 |
| | 未登记代号 | 🟡 | `field-decode-playbook.md` 排序键对比法 |
| | 嵌套路径 `data.diff[].f2` | ✅ | `field-decode-playbook.md` §3 结构差分 |
| 分页 | `page` / `pn` / `pageNum` | ✅ | `adapter-template.md` 例子 |
| | `cursor` / `next_cursor` | ✅ | adapter 里 while 循环，收集到 limit |
| | `offset` / `start` | ✅ | 同上 |
| 响应格式 | JSON | ✅ | 默认 |
| | JSONP（`?callback=`） | ✅ | 去掉 callback 参数直接请求，返回仍是 JSON 字符串包裹 |
| | CSV 字符串（eastmoney kline） | ✅ | `response.split(',')` 按列序解 |
| | HTML 表格（tonghuashun） | 🟡 | `page.evaluate` 里用 `querySelectorAll` 拿 |

🟡 的维度意思：方法在文档里，但这一版没拿真实站点跑过端到端。第一次遇到时按文档走，遇到和文档不一致的地方记到 `~/.opencli/sites/<site>/notes.md`，下一次再打开就是 ✅。

---

## 不支持（承认搞不定，skill 不教）

| 场景 | 原因 | 绕开方案 |
|------|------|---------|
| 首次登录获取 token | 需要用户真实输入账密 | 让用户先在 browser session 里手动登录，adapter 拿 cookie 就行 |
| 复杂 anti-bot（captcha） | 反爬拒流量 | 放弃，换同数据的其他站点 |
| 加密字段（客户端 crypto） | 要破解 bundle 逆向 | 换 endpoint；实在不行发请求到 intercept 让页面自己解 |
| WebSocket 流式数据 | 状态管理复杂 | 退回 HTTP 轮询版本（多数站都有） |
| 私有 binary 协议 | 非 HTTP/WS | 不在 skill 范围 |
| 视觉化图表（只有 canvas） | 数据埋在渲染层 | 找对应 API；找不到就放弃 |
| 签名算法涉及静态密钥 | 需要长期跟踪 bundle 变更 | 走 `Strategy.INTERCEPT`，让页面自己发带签名的请求 |
| 频控 / rate-limit 严格 | 多发几次就 429 | adapter 层控并发 + 加退避；但 skill 不解决 |

---

## 决定用不用 skill 的快速自测

三个问题：

1. **数据能在浏览器里看到吗？** 看不到（登录墙 / 付费墙）→ 先解决鉴权，再回来
2. **数据来源是 HTTP/JSON/HTML 之一吗？** 不是（binary / 加密）→ 不在 skill 范围
3. **需不需要每秒推送？** 需要 → 找同数据 HTTP 接口；没有就放弃

三个都 yes 再往下走。

---

## 本轮硬验证 / 当前证据

| 类型 | 证据 adapter | 覆盖维度 |
|------|-------------|---------|
| PUBLIC + 自解释字段 + SPA | `~/.opencli/clis/coingecko/top.js`（本轮 dry run） | `Strategy.PUBLIC` + REST JSON + 自解释字段 + 列表页 |
| COOKIE + 代号字段 + JSONP | `clis/eastmoney/*.js` × 13（PR #1091 merged） | `Strategy.PUBLIC`（匿名 `ut=`）+ JSONP + f-代号 + 列表/详情/K 线 |
| COOKIE + SPA | `clis/bilibili/*.js` × 10+（已存在） | `Strategy.COOKIE + browser:true` + wbi 签名 |

**本 PR 新增的 skill 还未硬验证的维度**：🟡 行，尤其 SSR Pattern B + Bearer/CSRF + 未登记代号解码。这些放到第一批真实用户 adapter 写作中打磨，skill 文档先落，踩坑回来补 `site-memory`。合 PR 之前先拿 coingecko 跑第二轮（带着第一轮写出的 `~/.opencli/sites/coingecko/`）验证 memory 命中 → endpoint re-verify → 字段抽查 → 写 adapter 这条回路。
