# Site Recon

**Layer 1：这是哪种站？** 分类完直接进 `api-discovery.md` 找 endpoint。

本文件**只做分类**，不讲 endpoint 怎么找。

---

## 页面与请求事实

```bash
opencli browser open <url> --session research
opencli browser state --diagnostics --session research
opencli browser network --static --session research
```

读取 success envelope 的 `data`。`state --diagnostics` 返回页面与可用 state globals；
`network --static` 返回捕获请求和脚本候选。由 agent 判断最适合的数据源，CLI 不再给出
Pattern 分类或 `recommended_next_step`。下面的分类仅作为分析参考。

看 `network` 输出判：

| `network` 看到什么 | 站点类型 | 特征 |
|------------------|---------|------|
| 大量 `/api/...` JSON 请求，包含目标数据 | **A. SPA / JSON XHR** | React/Vue，数据走 fetch |
| 有请求但都是广告 / 埋点，无目标数据 | **B. SSR / inline data** | 首屏在 HTML 里，深层再走 API |
| 完全空 / 只有静态资源 | **C. JSONP / `<script src>` 驱动** | 老金融行情站常见 |
| 有 API 但 401/403/签名错 | **D. Token / CSRF 鉴权型** | 在 A 基础上加鉴权 |
| `Content-Type: text/event-stream` / WebSocket 握手 | **E. 流式** | 行情 tick / chat |

分不清时参考下面五节的其他信号。

**数据是 SPA / 异步加载时，`wait time 2` 可能不够**。改用 `opencli browser --session research wait xhr '/api/path-fragment'` 直接等具体接口到场，比盲 `wait time 5` 更稳。

---

## Pattern A — SPA / JSON XHR

**代表**：xueqiu、linear、notion、大多数现代 SaaS

**信号**：
- URL 一访问就是 `/`，后续数据都在 network tab
- `document.querySelector('main').childElementCount` 一开始为 0，后被 JS 填充
- `window.React / window.Vue / window.__REACT_DEVTOOLS_GLOBAL_HOOK__` 存在

**下一步**：`api-discovery.md` §1（network 精读）

**注意 — Pattern A 命中不等于 strategy 选 `PAGE_FETCH`**：
- 检查 network response shape 与业务目标是否一致；analytics / beacon / personalization 不能单独证明目标 API 可用。
- booking #1680 反例：17 个 JSON XHR 看起来像 Pattern A，但全是 analytics side-channel，最终走 `DOM_STATE` / `UI_SELECTOR`
- replay 候选 endpoint 后，按 `strategy-selection.md` 的契约模型选 strategy；`PUBLIC_API` / `COOKIE_API` 都不通才考虑 `PAGE_FETCH`

---

## Pattern B — SSR / inline data

**代表**：bilibili 个人主页、小红书、微博、部分 Next.js / Nuxt 页

**信号**：
- 第一个请求（`document`）返回的 HTML 里已经含目标数据（`curl <url> | grep <某数字>`）
- `window.__INITIAL_STATE__` / `window.__NEXT_DATA__` / `window.__NUXT__` 存在
- 关 JS 仍能看到首屏数据

**下一步**：`api-discovery.md` §2（state 抽取） + §1（深层数据回到 network）

---

## Pattern C — JSONP / `<script src>` 驱动

**代表**：eastmoney、tonghuashun、老一代金融站

**信号**：
- `network` 空或只有 css/font
- 页面上肯定有数据（价格、成交量等）
- `document.querySelectorAll('script[src]')` 里有指向 `push / api / data` 域名的 src
- 响应是 `jQuery123({...})` 这种回调包裹（JSONP）

**下一步**：`api-discovery.md` §3（bundle / script src 搜索）

---

## Pattern D — Token / CSRF / Bearer

**代表**：Twitter/X、部分企业 SaaS

**信号**：
- 已经是 Pattern A，但 `fetch(url, {credentials:'include'})` 返回 401/403
- network 里请求头有 `X-Csrf-Token / Authorization: Bearer / X-Client-Id / X-Workspace-Id` 等自定义字段
- 401 响应体带 `{"code":"AUTH_REQUIRED","csrf":"..."}` 类提示

**下一步**：`api-discovery.md` §4（token 来源排查） + §5（store action / intercept 降级）

---

## Pattern E — 流式

**代表**：行情 tick、LLM chat

**信号**：
- `network` 里有 `101 Switching Protocols`（WebSocket 握手）
- Response headers 含 `Content-Type: text/event-stream`
- 请求一直 pending 不结束

**下一步**：先找**同数据的 HTTP 轮询接口**（90% 概率有）。真没有再走 intercept 收 N 条。

---

## 识别失败怎么办

诊断信号互相矛盾（比如 network 非空但目标数据不在里面），按优先级硬走：

1. 先当 A，试 `api-discovery.md` §1
2. 不行当 B，试 §2
3. 还不行当 C，试 §3
4. 401 出现了切 D，试 §4
5. 所有手段都试过，启动 intercept（§5）

不要纠结分类。分类是帮忙定第一步，没命中就按顺序降级。
