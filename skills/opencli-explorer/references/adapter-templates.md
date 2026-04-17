# Adapter Templates

适配器模板库。按认证 Tier 选择，复制后改 3 处：`name`、API URL、字段映射。

---

## 认证速查

```
fetch(url) 直接能拿到？                        → Tier 1: public   (browser: false)
fetch(url, {credentials:'include'})？          → Tier 2: cookie
localStorage 有 token + Bearer header 能拿到？  → Tier 2.5: localStorage Bearer
  带了 Bearer 但返回 400 "Missing X-Xxx header"？ → 先拿业务上下文 ID，加进 header
加 CSRF/Bearer header 后拿到？                 → Tier 3: header
都不行，但页面自己能请求成功？                    → Tier 4: intercept
```

---

## Tier 1 — 公开 API

```typescript
// clis/v2ex/hot.js
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'v2ex',
  name: 'hot',
  description: 'V2EX 热门话题',
  domain: 'www.v2ex.com',
  strategy: Strategy.PUBLIC,
  browser: false,         // ← 公开 API 不需要浏览器，~1s
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'title', 'replies'],
  func: async (_page, kwargs) => {
    const res = await fetch('https://www.v2ex.com/api/topics/hot.json');
    const data = await res.json();
    return data.slice(0, kwargs.limit).map((item: any, i: number) => ({
      rank: i + 1,
      title: item.title,
      replies: item.replies,
    }));
  },
});
```

---

## Tier 2 — Cookie 认证（最常用）

```typescript
// clis/zhihu/hot.js
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'zhihu',
  name: 'hot',
  description: '知乎热榜',
  domain: 'www.zhihu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 50 },
  ],
  columns: ['rank', 'title', 'heat', 'answers'],
  func: async (page, kwargs) => {
    await page.goto('https://www.zhihu.com');  // 先加载页面建立 session
    const data = await page.evaluate(`(async () => {
      const res = await fetch('/api/v3/feed/topstory/hot-lists/total?limit=50', {
        credentials: 'include'
      });
      const d = await res.json();
      return (d?.data || []).map(item => {
        const t = item.target || {};
        return {
          title: t.title,
          heat: item.detail_text || '',
          answers: t.answer_count,
        };
      });
    })()`);
    return (data as any[]).slice(0, kwargs.limit).map((item, i) => ({
      rank: i + 1,
      title: item.title,
      heat: item.heat,
      answers: item.answers,
    }));
  },
});
```

> `page.evaluate` 内的 `fetch` 运行在浏览器页面内，自动携带 Cookie，无需手动处理。

---

## Tier 2.5 — localStorage Bearer（现代 SaaS）

适用于 JWT 存 `localStorage`、API 在独立 domain（如 `api.xxx.com`）的 SaaS：

```typescript
// clis/slock/channels.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

cli({
  site: 'slock',
  name: 'channels',
  description: '列出 Slock 频道',
  domain: 'app.slock.ai',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'server', type: 'str', required: false, help: '工作空间 slug' },
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'name', 'topic'],
  func: async (page, kwargs) => {
    await page.goto('https://app.slock.ai');
    const data = await page.evaluate(`(async () => {
      const token = localStorage.getItem('slock_access_token');
      if (!token) return { error: 'Not logged in' };

      // 多租户 SaaS：先拿工作空间列表
      const slug = ${JSON.stringify(kwargs.server || null)} || localStorage.getItem('slock_last_server_slug');
      const servers = await fetch('https://api.slock.ai/api/servers', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(r => r.json());
      const server = servers.find(s => s.slug === slug) || servers[0];

      // 带业务上下文 Header
      const res = await fetch('https://api.slock.ai/api/channels', {
        headers: { 'Authorization': 'Bearer ' + token, 'X-Server-Id': server.id }
      });
      return res.json();
    })()`);
    if ((data as any).error) throw new AuthRequiredError('app.slock.ai');
    return (data as any[]).slice(0, kwargs.limit).map((ch: any, i: number) => ({
      rank: i + 1,
      name: ch.name || '',
      topic: ch.topic || '',
    }));
  },
});
```

**多租户 SaaS 要点**：
1. Token 来自 `localStorage`（key 名各站点不同，先用 `opencli browser eval "Object.keys(localStorage)"` 查）
2. API domain 和页面 domain 不同 → 用完整 URL
3. 带了 Bearer 但仍 400 → 缺业务上下文 Header，先调 `/servers` 或 `/workspaces` 拿 ID

---

## Tier 3 — Header 认证（Twitter GraphQL）

```typescript
// clis/twitter/lists.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

cli({
  site: 'twitter',
  name: 'lists',
  description: '我的 Twitter Lists',
  domain: 'x.com',
  strategy: Strategy.HEADER,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'name', 'memberCount'],
  func: async (page, kwargs) => {
    await page.goto('https://x.com');
    const data = await page.evaluate(`(async () => {
      const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
      if (!ct0) return { error: 'Not logged in' };
      const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
      const res = await fetch('/i/api/graphql/QUERY_ID/ListsManagePinTimeline', {
        headers: {
          'Authorization': 'Bearer ' + decodeURIComponent(bearer),
          'X-Csrf-Token': ct0,
          'X-Twitter-Auth-Type': 'OAuth2Session',
        },
        credentials: 'include',
      });
      const d = await res.json();
      return d?.data?.list?.listsTimeline?.timeline?.instructions
        ?.flatMap(i => i.entries || [])
        ?.filter(e => e.content?.itemContent?.list)
        ?.map(e => e.content.itemContent.list) || [];
    })()`);
    if ((data as any).error) throw new AuthRequiredError('x.com');
    return (data as any[]).slice(0, kwargs.limit).map((l: any, i: number) => ({
      rank: i + 1,
      name: l.name || '',
      memberCount: l.member_count || 0,
    }));
  },
});
```

> Twitter queryId 会随部署更新，建议配合[动态 queryId 发现模式](./advanced-patterns.md#模式-1动态-queryid-发现替代硬编码)。

---

## Tier 4 — Intercept（Pinia Store 触发）

```typescript
// clis/xiaohongshu/notifications.js
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xiaohongshu',
  name: 'notifications',
  description: '小红书通知',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  args: [
    { name: 'type', type: 'str', default: 'mentions', help: 'mentions | likes | connections' },
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'user', 'action', 'content'],
  func: async (page, kwargs) => {
    await page.goto('https://www.xiaohongshu.com/notification');
    await page.wait(3);

    await page.installInterceptor('/you/');  // URL 子串匹配

    await page.evaluate(`(async () => {
      const app = document.querySelector('#app')?.__vue_app__;
      const pinia = app?.config?.globalProperties?.$pinia;
      const store = pinia?._s?.get('notification');
      if (store?.getNotification) {
        await store.getNotification('${kwargs.type}');
      }
    })()`);

    const requests = await page.getInterceptedRequests();
    if (!requests?.length) return [];

    let results: any[] = [];
    for (const req of requests) {
      results.push(...(req.data?.data?.message_list || []));
    }

    return results.slice(0, kwargs.limit).map((item, i) => ({
      rank: i + 1,
      user: item.user_info?.nickname || '',
      action: item.title || '',
      content: item.comment_info?.content || '',
    }));
  },
});
```

---

## Tier 4 — Intercept（XHR/Fetch 双重拦截）

不依赖 Pinia，通用于任何请求有签名的场景：

```typescript
// clis/xiaohongshu/user.js
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xiaohongshu',
  name: 'user',
  description: '获取用户笔记列表',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  args: [
    { name: 'id', type: 'str', required: true, positional: true, help: '用户 ID' },
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'title', 'likes', 'url'],
  func: async (page, kwargs) => {
    await page.goto(`https://www.xiaohongshu.com/user/profile/${kwargs.id}`);
    await page.wait(5);

    await page.installInterceptor('v1/user/posted');

    // 触发滚动加载
    await page.autoScroll({ times: 2, delayMs: 2000 });

    const requests = await page.getInterceptedRequests();
    if (!requests?.length) return [];

    let results: any[] = [];
    for (const req of requests) {
      for (const note of req.data?.data?.notes || []) {
        results.push({
          title: note.display_title || '',
          likes: note.interact_info?.liked_count || '0',
          url: `https://www.xiaohongshu.com/explore/${note.note_id || note.id}`,
        });
      }
    }

    return results.slice(0, kwargs.limit).map((item, i) => ({
      rank: i + 1,
      ...item,
    }));
  },
});
```

---

## 通用模式：分页 API

```typescript
args: [
  { name: 'page', type: 'int', required: false, default: 1, help: '页码' },
  { name: 'limit', type: 'int', required: false, default: 50, help: '每页数量 (最大 50)' },
],
func: async (page, kwargs) => {
  const pn = kwargs.page ?? 1;
  const ps = Math.min(kwargs.limit ?? 50, 50); // 尊重 API 的 ps 上限
  const payload = await fetchJson(page,
    `https://api.example.com/list?pn=${pn}&ps=${ps}`
  );
  return payload.data?.list || [];
},
```

> 大多数站点 `ps` 上限是 20~50，超过会被静默截断。

---

## 同站点多 adapter：提取 utils.js

同一站点写第二个 adapter 时，如果发现要复制 auth context 解析逻辑，就应该提取 `clis/<site>/utils.js`。

**判断标准**：两个 adapter 里出现了几乎相同的这几行：

```typescript
const token = localStorage.getItem('xxx_access_token');
const servers = await fetch('https://api.xxx.com/api/servers', {
  headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json());
const server = servers.find(s => s.slug === slug) || servers[0];
```

**正确做法**：提取成 helper，所有 adapter import 复用：

```typescript
// clis/mysite/utils.js
export async function getServerContext(slug: string | null): Promise<{ token: string; server: any }> {
  const token = localStorage.getItem('mysite_access_token');
  if (!token) return { error: 'Not logged in' };
  const servers = await fetch('https://api.mysite.com/api/servers', {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(r => r.json());
  const server = servers.find((s: any) => s.slug === slug) || servers[0];
  return { token, server };
}
```

```typescript
// clis/mysite/channels.js — import 复用
import { getServerContext } from './utils.js';

func: async (page, kwargs) => {
  await page.goto('https://app.mysite.com');
  const data = await page.evaluate(`(async () => {
    const ctx = await (${getServerContext.toString()})(${JSON.stringify(kwargs.server || null)});
    if (ctx.error) return ctx; // bubble error sentinel to func() body
    const { token, server } = ctx;
    // ...
  })()`);
  if (data?.error) throw new AuthRequiredError('app.mysite.com', data.error);
}
```

> **现有参考**：`clis/bilibili/utils.js` 里的 `fetchJson` / `apiGet` / `getSelfUid` 是同类实践。
> `clis/slock/` 三个 adapter（tasks / members / send）都有重复的 server 解析逻辑，是反例。

---



## 错误处理规范

### 使用 `throw CliError` 子类

所有错误都通过 `throw` 类型化的 `CliError` 子类来表达。框架层统一捕获并输出 YAML Error Envelope 到 stderr + 非零 exit code。**不要用 `return [{error, help}]`**——stdout 是纯数据通道。

```typescript
import { AuthRequiredError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

// ❌ 不推荐：错误伪装成数据混入 stdout
if (!token) return [{ error: 'Not logged in', help: '...' }];

// ✅ 推荐：throw 类型化错误，框架自动输出 YAML envelope 到 stderr
if (!token) throw new AuthRequiredError('site.com');
```

**注意 `page.evaluate()` 内部**：browser 环境没有 CliError，在 evaluate 内返回 `{ error, help }` 后，在 `func()` 体内检查并 throw：

```typescript
const data = await page.evaluate(`(async () => {
  const token = localStorage.getItem('token');
  if (!token) return { error: 'Not logged in' };
  // ...
})()`);
if ((data as any).error) throw new AuthRequiredError('site.com', (data as any).error);
```

**可用的 CliError 子类**：

| 子类 | code | 场景 | exit code |
|------|------|------|-----------|
| `AuthRequiredError` | AUTH_REQUIRED | 未登录、Cookie 过期 | 77 |
| `EmptyResultError` | EMPTY_RESULT | API 返回空数据 | 66 |
| `CommandExecutionError` | COMMAND_EXEC | 通用执行失败 | 1 |
| `TimeoutError` | TIMEOUT | 超时 | 75 |
| `ArgumentError` | ARGUMENT | 参数错误 | 2 |
| `SelectorError` | SELECTOR | DOM 元素找不到 | 1 |
| `BrowserConnectError` | BROWSER_CONNECT | 浏览器连接失败 | 69 |
| `ConfigError` | CONFIG | 配置缺失 | 78 |

**错误输出示例**（YAML envelope → stderr）：

```yaml
ok: false
error:
  code: AUTH_REQUIRED
  message: Not logged in to site.com
  help: Please open Chrome or Chromium and log in to https://site.com
  exitCode: 77
```
