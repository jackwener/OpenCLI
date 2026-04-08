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

```
1. browser_navigate → 打开目标 URL
2. 等待 3-5 秒（让页面加载完、API 请求触发）
3. browser_network_requests → 筛选 JSON API
```

**关键**：只关注返回 `application/json` 的请求，忽略静态资源。
如果没有自动触发 API，手动点击目标按钮/标签再抓一次。

### Step 2: 锁定一个接口

从抓包结果中找到**那个**目标 API。看这几个字段：

| 字段 | 关注什么 |
|------|----------|
| URL | API 路径 pattern（如 `/i/api/graphql/xxx/ListsManagePinTimeline`） |
| Method | GET / POST |
| Headers | 有 Cookie? Bearer? CSRF? 自定义签名? |
| Response | 数据在哪个路径（如 `data.list.lists`） |

### Step 3: 验证接口能复现

在 `browser_evaluate` 中用 `fetch` 复现请求：

```javascript
// Tier 2 (Cookie): 大多数情况
fetch('/api/endpoint', { credentials: 'include' }).then(r => r.json())

// Tier 3 (Header): 如 Twitter 需要额外 header
const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
fetch('/api/endpoint', {
  headers: { 'Authorization': 'Bearer ...', 'X-Csrf-Token': ct0 },
  credentials: 'include'
}).then(r => r.json())
```

如果 fetch 能拿到数据 → 用 TS adapter（`cli()` pipeline 或 `func()`）。
如果 fetch 拿不到（签名/风控）→ 用 intercept 策略（TS `func()` + `installInterceptor`）。

### Step 4: 套模板，生成 adapter

根据 Step 3 判定的策略，选一个模板生成文件。

---

## 认证速查

```
fetch(url) 直接能拿到？              → Tier 1: public   (TS pipeline, browser: false)
fetch(url, {credentials:'include'})？ → Tier 2: cookie   (TS pipeline 或 func())
加 Bearer/CSRF header 后拿到？        → Tier 3: header   (TS func())
都不行，但页面自己能请求成功？          → Tier 4: intercept (TS func(), installInterceptor)
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

```bash
npm run build                              # 语法检查
opencli list | grep mysite                 # 确认注册
opencli mysite mycommand --limit 3 -v      # 实际运行
```

---

## 就这样，没了

写完文件 → build → run → 提交。有问题再看 [opencli-explorer skill](../opencli-explorer/SKILL.md)。
