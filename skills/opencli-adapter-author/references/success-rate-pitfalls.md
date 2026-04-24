# Success-Rate Pitfalls

10 个**静默失败**（adapter 看起来能跑、verify 能过，但数据是错的）的坑。每条给：现象 → 根因 → 防御手段。

不是风格建议。每条都对应过一次真实翻车。

---

## 1. fixture pattern 被放松以过 verify

**现象**：`verify` 报 `pattern "url" does not match /^https?:\/\/.*\.com\/bbs\/thread-/`。agent 的"修法"是把 fixture 里的 pattern 改宽（`^https?://`），verify 一下就通过了。

**根因**：adapter 丢了 URL 前缀 / 拼错了路径 / 吃到了相对路径。pattern 失败不是 fixture 太严，是 adapter 输出真的破了。

**防御**：
- `autofix` skill 现有纪律：**verify pattern 失败 = 收紧 adapter，不是收紧 fixture**（`opencli-autofix` SKILL.md §Rules for Patching 第 6 条）
- 要改 fixture 的唯一合法理由：**站点本身换了格式**（例如 URL 规范迁移）。这种情况下在 `~/.opencli/sites/<site>/notes.md` 顶部写一段说明

---

## 2. 字段内容污染但 `notEmpty` / `columns` 都过

**现象**：`description` 字段不为空，`verify` 通过。肉眼看输出发现描述里混了 `"address: 上海 category: IT"` 之类明显不属于描述的片段——兄弟 DOM 节点或父节点文字被一起 `textContent` 了。

**根因**：`.container` 的 `textContent` 包括所有后代文字。调 `innerText` 仅好一点；用 `querySelector('.desc').textContent` 时，如果 `.desc` 里嵌套了 `.tag.address`，一样吃进去。

**防御**：
- fixture 用 `mustNotContain`：`{ "description": ["address:", "category:", "工作年限:"] }` 把已踩过的污染词列出来
- adapter 侧：定位更精确的 selector，或抓到后 `.replace(/address:[^\n]*/g, '').trim()`
- 别信 `textContent.trim()` 就完事

---

## 3. 字段语义分歧（两个字段看起来都对）

**现象**：51job 列表有 `updatedate` 和 `publishDate`，eastmoney 债券有 `f10`（发行日）和 `f26`（上市日）。adapter 随便选一个，verify 通过，用户一对照发现时间错位 1 个月。

**根因**：两个字段都是合法日期，format 也对，只是含义不同。`notEmpty` / `types` 都挡不住。

**防御**：
- Step 7 字段解码**必须和网页肉眼对至少一条已知记录**（"这条债券首页写的上市日是 2025-02-14"，看 adapter 输出对不对得上）
- 字段写进 `field-map.json` 时 `meaning` 要精确到"上市日"而不是"日期"

---

## 4. 字段单位混淆（数值量级错）

**现象**：eastmoney 返回 `totalMarketCap: 128`（单位：亿元），adapter 直接写进 `marketCap`，用户对照 K 线页看是 128 元。常见错位：

| 接口返回 | 网页显示 | 实际单位 | 错误写法 |
|---------|---------|----------|---------|
| `0.025` | `2.5%` | 小数 | adapter 再 × 100 → 显示 250% |
| `12800` | `1.28 万` | 元 | adapter 不除 10000 → 显示 12800 万 |
| `f152 = 2` | `9.27` | 价格 = 原值 ÷ 10^f152 | adapter 忽略 f152 → 显示 927 |

**防御**：
- fixture 加 `mustBeTruthy` 挡 `|| 0` / `|| false` silent fallback（数值列应该有值，不是 0）
- `field-map.json` 的 `meaning` 写单位：`"premium pct (0-1 fraction, NOT already × 100)"`
- Step 11 肉眼比对不能只比"有没有数字"，要比数量级

---

## 5. JSON-in-attribute vs 渲染后 innerText

**现象**：51job 把完整 JSON 塞在 `<div data-sensorsdata='{"job_title":"..."}'>` 里，用 innerText 取的是渲染后的截断显示文字（"Lead... ↩ 上海..."），字段边界丢了。

**根因**：现代站点常把结构化数据放在 `data-*` 属性里，渲染层只挑部分显示。取 innerText 相当于丢掉了结构。

**防御**：
- 看到 `data-sensorsdata` / `data-ng-state` / `data-page-props` / `data-track` 类属性先读属性，不读 innerText
- 先在 `browser eval` 里检查：`document.querySelector('.item').dataset` 看有没有 JSON 串
- 搜 bundle 时也搜 `JSON.parse(el.dataset.*)` 模式看 vendor 把数据塞哪了

---

## 6. cookie 域 / origin 不一致的隐式假设

**现象**：在 `jobs.51job.com` 页面调 `cupid.51job.com` 的接口，headless 里带了 cookie 也跨不过去——`credentials:'include'` 只管带 cookie，不管 CORS。

**根因**：浏览器 CORS 预检默认关闭跨 subdomain 请求。`credentials:'include'` 不是万能药。

**防御**：参见 `api-discovery.md §0.2`。判断：`fetch(target).catch(e=>'cors:'+e.message)` 看是不是 TypeError。降级路径：改用 same-origin endpoint / 改在目标 subdomain 上打开页面 / 走 `§5 intercept`。

---

## 7. 等不够就抓导致空 DOM / 空 network

**现象**：`open url && wait time 2 && network` 看到 0 条业务 API。agent 以为是 Pattern C（静态），去 bundle 里找 baseURL，找不到就卡住。真相：SPA 3.5 秒才发出第一个 API。

**根因**：`wait time N` 是盲等。不同站点 JS 执行速度差很多。

**防御**：
- 数据是异步加载时**不用 `wait time`**，用 `opencli browser wait xhr '/api/path-fragment'`，等具体 XHR 到场再 `network`
- 不确定 endpoint 路径时：先 `wait time 2 && network`，看到候选路径再转 `wait xhr` 确认
- 首诊断用 `opencli browser analyze <url>` 一步拿 `json_responses` 数量——=0 时才真的是 Pattern C

---

## 8. adapter 里的 falsy `|| 0` 兜底静默

**现象**：`likes: data.likes || 0`。接口偶尔返回 `likes: null`（可能因字段名改了、权限问题等），adapter 写成 0，verify `types: {likes: 'number'}` 通过，用户看到的是"所有帖子 0 赞"。

**根因**：`||` 兜底把"没抓到"变成"是 0"。`notEmpty` 挡不住 0，`types` 也不挡。

**防御**：
- fixture 用 `mustBeTruthy: ["likes", "count", ...]`——业务数值列必须 truthy
- adapter 侧 prefer `?.` 而不是 `||`；真的想兜底就兜 `undefined`，让 verify 能看见
- 全部 `|| 0` 要过一遍眼：这个 0 是合法值还是漏抓 fallback

---

## 9. 跨 session cookie 污染 / 登录态漂移

**现象**：本地开发时用自己的登录态验 endpoint 能通，PR 一合 verify fixture 跑在 CI 环境里立刻 401——顺手把样本数据也固化进了 fixture，看起来"一切正常"。

**根因**：fixture 样本是带登录态跑出来的。存 `~/.opencli/sites/<site>/fixtures/*.json` 没脱敏，把 cookie / token / 自己的 uid / 昵称存了进去。

**防御**：
- `site-memory.md` 的脱敏规则：存 fixtures 前去掉 cookie / token / 用户私有字段（手机号 / 邮箱 / 昵称 / uid）
- 需要登录态的接口：adapter 用 `Strategy.COOKIE`，adapter 代码里**不写任何具体 cookie 值**，只声明"我需要 domain X 的 cookie"
- verify 样本里看到 `Bearer ...` 或 32 位 hex token → 先删再存

---

## 10. adapter 默认 timeout 不统一

**现象**：同一个站两个 adapter，一个默认 15s timeout，另一个默认 60s。慢接口在一个命令里 ok，在另一个一样的慢接口却 timeout 了。

**根因**：模板没统一 timeout；agent 依赖"最像的邻居"复制，复制到的邻居选了短 timeout。

**防御**：
- 邻居 adapter 的 `requestTimeoutMs` / `browser.wait` 配置**不能盲抄**。每个 adapter 应该结合自己的接口特性设一个
- 真实接口延迟：Step 5 endpoint 验证时用 `time curl`（或 `performance.now()` 包 fetch）量一下 p50 / p95，timeout 设 p95 × 2 比较安全
- 出现偶发 timeout 别 retry 掩盖；记到 `notes.md`，下次就知道这接口 p95 偏高

---

## 总结：静默失败的共同特征

1. **verify 绿 ≠ 数据对**。verify 只能证"结构没坏"，证不出"值对不对"。Step 11 肉眼比对是必须的。
2. **"字段有值"是个比"字段为空"更危险的失败态**。空你会去查，有值你会 fallthrough。
3. **fixture 四件套一起上**：`patterns` + `notEmpty` + `mustNotContain` + `mustBeTruthy`——每件挡一类问题，缺一个就漏。

回写 `notes.md` 时把你踩的新坑写进去。下次就有第 11 条了。
