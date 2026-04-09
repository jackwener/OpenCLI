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
// clis/v2ex/hot.ts
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
// clis/zhihu/hot.ts
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
// clis/slock/channels.ts
import { cli, Strategy } from '@jackwener/opencli/registry';

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
      if (!token) return { error: 'Not logged in', remedy: 'Open https://app.slock.ai and log in, then retry' };

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
    if ((data as any).error) return [data as any];
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
// clis/twitter/lists.ts
import { cli, Strategy } from '@jackwener/opencli/registry';

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
      if (!ct0) return { error: 'Not logged in', remedy: 'Open https://x.com and log in, then retry' };
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
    if ((data as any).error) return [data as any];
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
// clis/xiaohongshu/notifications.ts
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
// clis/xiaohongshu/user.ts
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

## 错误处理规范

### 返回 `{ error, remedy }` 而非 throw

```typescript
// ❌ 不推荐：throw 导致 CLI 打印 stack trace，用户不知道怎么修复
if (!token) throw new Error('Not logged in');

// ✅ 推荐：返回结构化错误，remedy 告诉 AI Agent 或用户下一步怎么做
if (!token) return [{ error: 'Not logged in', remedy: 'Open https://site.com and log in, then retry' }];
```

**字段约定**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `error` | `string` | 问题描述，事实性，不带感叹号 |
| `remedy` | `string` | 具体的修复动作，可直接执行 |

**常用 remedy 模板**：

```typescript
// 未登录
{ error: 'Not logged in', remedy: 'Open https://site.com in the browser and log in, then retry' }

// 找不到资源
{ error: `Channel not found: ${kwargs.channel}`, remedy: 'Run `opencli site channels` to see available channels' }

// 权限不足
{ error: 'Forbidden (403)', remedy: 'Check that your account has access to this resource' }

// API 结构变更
{ error: 'Unexpected response structure', remedy: 'Run `opencli browser network --detail N` to inspect the current API response' }

// 风控降级（伪 200）
{ error: 'Core data is empty — possible risk-control block', remedy: 'Re-login to the site in the browser, then retry' }
```

**何时 throw vs 返回 error 对象**：
- 程序错误（参数类型错、配置缺失）→ `throw`，这是 bug
- 运行时用户可修复的情况（未登录、找不到资源、API 变更）→ 返回 `{ error, remedy }`
