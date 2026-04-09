---
name: opencli-oneshot
description: Use when quickly generating a single OpenCLI command from a specific URL and goal description. 4-step process — open page, capture API, write TS adapter, test. For full site exploration, use opencli-explorer instead.
tags: [opencli, adapter, quick-start, ts, cli, one-shot, automation]
---

# CLI-ONESHOT — 单点快速 CLI 生成

> 给一个 URL + 一句话描述，4 步生成一个 CLI 命令。
> 完整探索式开发请看 [opencli-explorer skill](../opencli-explorer/SKILL.md)。

---

## 输入

| 项目 | 示例 |
|------|------|
| **URL** | `https://x.com/jakevin7/lists` |
| **Goal** | 获取我的 Twitter Lists |

---

## 流程

### Step 1: 打开页面 + 抓包

```bash
opencli browser open <目标 URL>          # 打开目标页面（自动开始抓包）
opencli browser wait time 3              # 等页面加载完、API 请求触发
opencli browser network                  # 查看捕获的 JSON API 请求
```

**关键**：`network` 默认已过滤静态资源，只显示 JSON/XML/text 的 API 请求。
如果没有自动触发 API，用 `opencli browser state` 找到按钮索引，`opencli browser click <N>` 点击后再 `network` 抓一次。

**`network` 为空？** ① 重新 `open` 刷新捕获窗口；② 如果是 SPA，API domain 可能是 `api.xxx.com` 而非 `app.xxx.com`，用 Step 2 里的 bundle 搜索找真实 baseURL。

### Step 2: 锁定一个接口

从 `opencli browser network` 结果中找到**那个**目标 API，用 `--detail` 查看完整响应：

```bash
opencli browser network --detail <N>     # 查看第 N 条请求的完整响应体
```

关注这几个字段：

| 字段 | 关注什么 |
|------|----------|
| URL | API 路径 pattern（如 `/i/api/graphql/xxx/ListsManagePinTimeline`） |
| Method | GET / POST |
| Headers | 有 Cookie? Bearer? CSRF? 自定义签名? |
| Response | 数据在哪个路径（如 `data.list.lists`） |

> **SPA 注意**：如果 `network` 里 API 的 host 和页面 host 不同（如 `api.xxx.com` vs `app.xxx.com`），后续 `fetch` 要用完整 URL。
> 如果 `network` 完全没有 API 请求，搜 JS bundle 找 baseURL：
> ```bash
> opencli browser eval "(async()=>{const s=[...document.querySelectorAll('script[src]')].map(e=>e.src).find(s=>s.match(/index|main|app/));const t=await fetch(s).then(r=>r.text());const m=t.indexOf('baseURL')>-1?t.indexOf('baseURL'):t.indexOf('baseUrl');return m>-1?t.slice(m-10,m+80):'not found'})()"
> ```

### Step 3: 验证接口能复现

用 `opencli browser eval` 在页面内 `fetch` 复现请求：

```bash
# Tier 2 (Cookie): 传统网站
opencli browser eval "fetch('/api/endpoint', { credentials: 'include' }).then(r => r.json())"

# Tier 2.5 (localStorage Bearer): 现代 SaaS 主流（slock、Linear、Notion 等）
opencli browser eval "(async () => {
  const token = localStorage.getItem('access_token');  // 换成实际 key
  const res = await fetch('https://api.example.com/endpoint', {
    headers: { 'Authorization': 'Bearer ' + token },
    credentials: 'include'
  });
  return res.json();
})()"

# Tier 3 (Header): 如 Twitter 需要额外 header
opencli browser eval "(async () => {
  const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
  const res = await fetch('/api/endpoint', {
    headers: { 'Authorization': 'Bearer ...', 'X-Csrf-Token': ct0 },
    credentials: 'include'
  });
  return res.json();
})()"
```

> 带了 Bearer 但返回 `{ error: "Missing X-Xxx-Id header" }`（HTTP 400）→ 多租户 SaaS 需要业务上下文 Header。先调 `/servers` 或 `/workspaces` 拿 ID，再加进 headers。

如果 fetch 能拿到数据 → 用 TS adapter（`cli()` pipeline 或 `func()`）。
如果 fetch 拿不到（签名/风控）→ 用 intercept 策略（TS `func()` + `installInterceptor`）。

### Step 4: 套模板，生成 adapter

根据 Step 3 判定的策略，选一个模板生成文件。

---

## 认证速查

```
fetch(url) 直接能拿到？                        → Tier 1: public   (browser: false)
fetch(url, {credentials:'include'})？          → Tier 2: cookie
localStorage 有 token + Bearer header 能拿到？  → Tier 2.5: localStorage Bearer  ← 现代 SaaS 主流
  带了 Bearer 但返回 400 "Missing X-Xxx header"？ → 先拿业务上下文 ID，加进 header
加 CSRF/Bearer header 后拿到？                 → Tier 3: header
都不行，但页面自己能请求成功？                    → Tier 4: intercept (installInterceptor)
```

---

## 模板

### TS — Cookie/Public（最简，`func()` 模式）

```typescript
// clis/<site>/<name>.ts
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'mysite',
  name: 'mycommand',
  description: '一句话描述',
  domain: 'www.example.com',
  strategy: Strategy.COOKIE,   // 或 Strategy.PUBLIC (加 browser: false)
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'title', 'value'],
  func: async (page, kwargs) => {
    await page.goto('https://www.example.com/target-page');
    const data = await page.evaluate(`(async () => {
      const res = await fetch('/api/target', { credentials: 'include' });
      const d = await res.json();
      return (d.data?.items || []).map(item => ({
        title: item.title,
        value: item.value,
      }));
    })()`);
    return (data as any[]).slice(0, kwargs.limit).map((item, i) => ({
      rank: i + 1,
      title: item.title || '',
      value: item.value || '',
    }));
  },
});
```

### TS — localStorage Bearer（现代 SaaS）

```typescript
// clis/<site>/<name>.ts
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'mysite',
  name: 'mycommand',
  description: '一句话描述',
  domain: 'app.example.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'title', 'value'],
  func: async (page, kwargs) => {
    await page.goto('https://app.example.com');
    const data = await page.evaluate(`(async () => {
      const token = localStorage.getItem('access_token');
      // 多租户 SaaS：先拿工作空间 ID
      const servers = await fetch('https://api.example.com/api/servers', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(r => r.json());
      const server = servers[0];
      const res = await fetch('https://api.example.com/api/items', {
        headers: { 'Authorization': 'Bearer ' + token, 'X-Server-Id': server.id }
      });
      return res.json();
    })()`);
    return (data as any[]).slice(0, kwargs.limit).map((item, i) => ({
      rank: i + 1,
      title: item.title || '',
      value: item.value || '',
    }));
  },
});
```

### TS — Intercept（抓包模式）

```typescript
// clis/<site>/<name>.ts
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'mysite',
  name: 'mycommand',
  description: '一句话描述',
  domain: 'www.example.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'title', 'value'],
  func: async (page, kwargs) => {
    // 1. 导航
    await page.goto('https://www.example.com/target-page');
    await page.wait(3);

    // 2. 注入拦截器（URL 子串匹配）
    await page.installInterceptor('target-api-keyword');

    // 3. 触发 API（滚动/点击）
    await page.autoScroll({ times: 2, delayMs: 2000 });

    // 4. 读取拦截的响应
    const requests = await page.getInterceptedRequests();
    if (!requests?.length) return [];

    let results: any[] = [];
    for (const req of requests) {
      const items = req.data?.data?.items || [];
      results.push(...items);
    }

    return results.slice(0, kwargs.limit).map((item, i) => ({
      rank: i + 1,
      title: item.title || '',
      value: item.value || '',
    }));
  },
});
```

### TS — Header（如 Twitter GraphQL）

```typescript
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'twitter',
  name: 'mycommand',
  description: '一句话描述',
  domain: 'x.com',
  strategy: Strategy.HEADER,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'name', 'value'],
  func: async (page, kwargs) => {
    await page.goto('https://x.com');
    const data = await page.evaluate(`(async () => {
      const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
      if (!ct0) return { error: 'Not logged in' };
      const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D...';
      const res = await fetch('/i/api/graphql/QUERY_ID/Endpoint', {
        headers: {
          'Authorization': 'Bearer ' + decodeURIComponent(bearer),
          'X-Csrf-Token': ct0,
          'X-Twitter-Auth-Type': 'OAuth2Session',
        },
        credentials: 'include',
      });
      return res.json();
    })()`);
    // 解析 data...
    return [];
  },
});
```

---

## 测试（必做）

> **两种开发场景**：
> - **Repo 贡献**：文件放 `clis/<site>/<name>.ts`，`npm run build` 后自动注册
> - **私人 adapter**（本地使用，无需提 PR）：文件放 `~/.opencli/clis/<site>/<name>.ts`，无需 build

```bash
opencli browser verify <site>/<name>      # 一键验证（推荐，自动检查注册+运行）
# 或手动：
opencli list | grep mysite                 # 确认注册
opencli mysite mycommand --limit 3 -v      # 实际运行
```

**Done 标准**：命令运行后返回非空表格，且字段符合预期。

---

## 就这样，没了

写完文件 → verify → 提交。有问题再看 [opencli-explorer skill](../opencli-explorer/SKILL.md)。
