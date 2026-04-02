# CLI-EXPLORER — 适配器探索式开发完全指南

> 本文档教你（或 AI Agent）如何为 OpenCLI 添加一个新网站的命令。  
> 从零到发布，覆盖 API 发现、方案选择、适配器编写、测试验证全流程。

> [!TIP]
> **只想为一个具体页面快速生成一个命令？** 看 [CLI-ONESHOT.md](./CLI-ONESHOT.md)（~150 行，4 步搞定）。
> 本文档适合从零探索一个新站点的完整流程。

---

## AI Agent 开发者必读：用浏览器探索

> [!CAUTION]
> **你（AI Agent）必须通过浏览器打开目标网站去探索！**  
> 不要只靠 `opencli explore` 命令或静态分析来发现 API。  
> 你拥有浏览器工具，必须主动用它们浏览网页、观察网络请求、模拟用户交互。

### 为什么？

很多 API 是**懒加载**的（用户必须点击某个按钮/标签才会触发网络请求）。字幕、评论、关注列表等深层数据不会在页面首次加载时出现在 Network 面板中。**如果你不主动去浏览和交互页面，你永远发现不了这些 API。**

### AI Agent 探索工作流（必须遵循）

| 步骤 | 工具 | 做什么 |
|------|------|--------|
| 0. 打开浏览器 | `browser_navigate` | 导航到目标页面 |
| 1. 观察页面 | `browser_snapshot` | 观察可交互元素（按钮/标签/链接） |
| 2. 首次抓包 | `browser_network_requests` | 筛选 JSON API 端点，记录 URL pattern |
| 3. 模拟交互 | `browser_click` + `browser_wait_for` | 点击"字幕""评论""关注"等按钮 |
| 4. 二次抓包 | `browser_network_requests` | 对比步骤 2，找出新触发的 API |
| 5. 验证 API | `browser_evaluate` | `fetch(url, {credentials:'include'})` 测试返回结构 |
| 6. 写代码 | — | 基于确认的 API 写适配器 |

### 常犯错误

| ❌ 错误做法 | ✅ 正确做法 |
|------------|------------|
| 只用 `opencli explore` 命令，等结果自动出来 | 用浏览器工具打开页面，主动浏览 |
| 直接在代码里 `fetch(url)`，不看浏览器实际请求 | 先在浏览器中确认 API 可用，再写代码 |
| 页面打开后直接抓包，期望所有 API 都出现 | 模拟点击交互（展开评论/切换标签/加载更多） |
| 遇到 HTTP 200 但空数据就放弃 | 检查是否需要 Wbi 签名或 Cookie 鉴权 |
| 完全依赖 `__INITIAL_STATE__` 拿所有数据 | `__INITIAL_STATE__` 只有首屏数据，深层数据要调 API |

### 实战成功案例：5 分钟实现「关注列表」适配器

以下是用上述工作流实际发现 Bilibili 关注列表 API 的完整过程：

```
1. browser_navigate → https://space.bilibili.com/{uid}/fans/follow
2. browser_network_requests → 发现:
   GET /x/relation/followings?vmid={uid}&pn=1&ps=24  →  [200]
   GET /x/relation/stat?vmid={uid}                    →  [200]
3. browser_evaluate → 验证 API:
   fetch('/x/relation/followings?vmid=137702077&pn=1&ps=5', {credentials:'include'})
   → { code: 0, data: { total: 1342, list: [{mid, uname, sign, ...}] } }
4. 结论：标准 Cookie API，无需 Wbi 签名
5. 写 following.ts → 一次构建通过
```

**关键决策点**：
- 直接访问 `fans/follow` 页面（不是首页），页面加载就会触发 following API
- 看到 URL 里没有 `/wbi/` → 不需要签名 → 直接用 `fetchJson` 而非 `apiGet`
- API 返回 `code: 0` + 非空 `list` → Tier 2 Cookie 策略确认

---

## 核心流程

```
 ┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌────────┐
 │ 1. 发现 API  │ ──▶ │ 2. 选择策略  │ ──▶ │ 3. 写适配器   │ ──▶ │ 4. 测试 │
 └─────────────┘     └─────────────┘     └──────────────┘     └────────┘
   explore             cascade             YAML / TS            run + verify
```

---

## Step 1: 发现 API

### 1a. 自动化发现（推荐）

OpenCLI 内置 Deep Explore，自动分析网站网络请求：

```bash
opencli explore https://www.example.com --site mysite
```

输出到 `.opencli/explore/mysite/`：

| 文件 | 内容 |
|------|------|
| `manifest.json` | 站点元数据、框架检测（Vue2/3、React、Next.js、Pinia、Vuex） |
| `endpoints.json` | 已发现的 API 端点，按评分排序，含 URL pattern、方法、响应类型 |
| `capabilities.json` | 推理出的功能（`hot`、`search`、`feed`…），含置信度和推荐参数 |
| `auth.json` | 认证方式检测（Cookie/Header/无认证），策略候选列表 |

### 1b. 手动抓包验证

Explore 的自动分析可能不完美，用 verbose 模式手动确认：

```bash
# 在浏览器中打开目标页面，观察网络请求
opencli explore https://www.example.com --site mysite -v

# 或直接用 evaluate 测试 API
opencli bilibili hot -v   # 查看已有命令的 pipeline 每步数据流
```

关注抓包结果中的关键信息：
- **URL pattern**: `/api/v2/hot?limit=20` → 这就是你要调用的端点
- **Method**: `GET` / `POST`
- **Request Headers**: Cookie? Bearer? 自定义签名头（X-s、X-t）?
- **Response Body**: JSON 结构，特别是数据在哪个路径（`data.items`、`data.list`）

### 1c. 高阶 API 发现捷径法则 (Heuristics)

在开始死磕复杂的抓包拦截之前，按照以下优先级进行尝试：

1. **后缀爆破法 (`.json`)**: 像 Reddit 这样复杂的网站，只要在其 URL 后加上 `.json`（例如 `/r/all.json`），就能在带 Cookie 的情况下直接利用 `fetch` 拿到极其干净的 REST 数据（Tier 2 Cookie 策略极速秒杀）。另外如功能完备的**雪球 (xueqiu)** 也可以走这种纯 API 的方式极简获取，成为你构建简单 YAML 的黄金标杆。
2. **全局状态查找法 (`__INITIAL_STATE__`)**: 许多服务端渲染 (SSR) 的网站（如小红书、Bilibili）会将首页或详情页的完整数据挂载到全局 window 对象上。与其去拦截网络请求，不如直接 `page.evaluate('() => window.__INITIAL_STATE__')` 获取整个数据树。
3. **主动交互触发法 (Active Interaction)**: 很多深层 API（如视频字幕、评论下的回复）是懒加载的。在静态抓包找不到数据时，尝试在 `evaluate` 步骤或手动打断点时，主动去**点击（Click）页面上的对应按钮**（如"CC"、"展开全部"），从而诱发隐藏的 Network Fetch。
4. **框架探测与 Store Action 截断**: 如果站点使用 Vue + Pinia，可以使用 `tap` 步骤调用 action，让前端框架代替你完成复杂的鉴权签名封装。
5. **底层 XHR/Fetch 拦截**: 最后手段，当上述都不行时，使用 TypeScript 适配器进行无侵入式的请求抓取。

### 1d. 框架检测

Explore 自动检测前端框架。如果需要手动确认：

```bash
# 在已打开目标网站的情况下
opencli evaluate "(()=>{
  const vue3 = !!document.querySelector('#app')?.__vue_app__;
  const vue2 = !!document.querySelector('#app')?.__vue__;
  const react = !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const pinia = vue3 && !!document.querySelector('#app').__vue_app__.config.globalProperties.\$pinia;
  return JSON.stringify({vue3, vue2, react, pinia});
})()"
```

Vue + Pinia 的站点（如小红书）可以直接通过 Store Action 绕过签名。

---

## Step 2: 选择认证策略

OpenCLI 提供 5 级认证策略。使用 `cascade` 命令自动探测：

```bash
opencli cascade https://api.example.com/hot
```

### 策略决策树

```
直接 fetch(url) 能拿到数据？
  → ✅ Tier 1: public（公开 API，不需要浏览器）
  → ❌ fetch(url, {credentials:'include'}) 带 Cookie 能拿到？
       → ✅ Tier 2: cookie（最常见，evaluate 步骤内 fetch）
       → ❌ → 加上 Bearer / CSRF header 后能拿到？
              → ✅ Tier 3: header（如 Twitter ct0 + Bearer）
              → ❌ → 网站有 Pinia/Vuex Store？
                     → ✅ Tier 4: intercept（Store Action + XHR 拦截）
                     → ❌ Tier 5: ui（UI 自动化，最后手段）
```

### 各策略对比

| Tier | 策略 | 速度 | 复杂度 | 适用场景 | 实例 |
|------|------|------|--------|---------|------|
| 1 | `public` | ⚡ ~1s | 最简 | 公开 API，无需登录 | Hacker News, V2EX |
| 2 | `cookie` | 🔄 ~7s | 简单 | Cookie 认证即可 | Bilibili, Zhihu, Reddit |
| 3 | `header` | 🔄 ~7s | 中等 | 需要 CSRF token 或 Bearer | Twitter GraphQL |
| 4 | `intercept` | 🔄 ~10s | 较高 | 请求有复杂签名 | 小红书 (Pinia + XHR) |
| 5 | `ui` | 🐌 ~15s+ | 最高 | 无 API，纯 DOM 解析 | 遗留网站 |

---

## Step 2.5: 准备工作（写代码之前）

### 先找模板：从最相似的现有适配器开始

**不要从零开始写**。先看看同站点已有哪些适配器：

```bash
ls src/clis/<site>/    # 看看已有什么
cat src/clis/<site>/feed.ts   # 读最相似的那个
```

最高效的方式是 **复制最相似的适配器，然后改 3 个地方**：
1. `name` → 新命令名
2. API URL → 你在 Step 1 发现的端点
3. 字段映射 → 对应新 API 的字段

### 平台 SDK 速查表

写 TS 适配器之前，先看看你的目标站点有没有**现成的 helper 函数**可以复用：

#### Bilibili (`src/clis/bilibili/utils.ts`)

| 函数 | 用途 | 何时使用 |
|------|------|----------|
| `fetchJson(page, url)` | 带 Cookie 的 fetch + JSON 解析 | 普通 Cookie-tier API |
| `apiGet(page, path, {signed, params})` | 带 Wbi 签名的 API 调用 | URL 含 `/wbi/` 的接口 |
| `getSelfUid(page)` | 获取当前登录用户的 UID | "我的xxx" 类命令 |
| `resolveUid(page, input)` | 解析用户输入的 UID(支持数字/URL) | `--uid` 参数处理 |
| `wbiSign(page, params)` | 底层 Wbi 签名生成 | 通常不直接用，`apiGet` 已封装 |
| `stripHtml(s)` | 去除 HTML 标签 | 清理富文本字段 |

**如何判断需不需要 `apiGet`**？看 Network 请求 URL：
- 含 `/wbi/` 或 `w_rid=` → 必须用 `apiGet(..., { signed: true })`
- 不含 → 直接用 `fetchJson`

> 其他站点（Twitter、小红书等）暂无专用 SDK，直接用 `page.evaluate` + `fetch` 即可。

---

## Step 3: 编写适配器

### YAML vs TS？先看决策树

```
你的 pipeline 里有 evaluate 步骤（内嵌 JS 代码）？
  → ✅ 用 TypeScript (src/clis/<site>/<name>.ts)，保存即自动动态注册
  → ❌ 纯声明式（navigate + tap + map + limit）？
       → ✅ 用 YAML (src/clis/<site>/<name>.yaml)，保存即自动注册
```

| 场景 | 选择 | 示例 |
|------|------|------|
| 纯 fetch/select/map/limit | YAML | `v2ex/hot.yaml`, `hackernews/top.yaml` |
| navigate + evaluate(fetch) + map | YAML（评估复杂度） | `zhihu/hot.yaml` |
| navigate + tap + map | YAML ✅ | `xiaohongshu/feed.yaml`, `xiaohongshu/notifications.yaml` |
| 有复杂 JS 逻辑（Pinia state 读取、条件分支） | TS | `xiaohongshu/me.ts`, `bilibili/me.ts` |
| XHR 拦截 + 签名 | TS | `xiaohongshu/search.ts` |
| GraphQL / 分页 / Wbi 签名 | TS | `bilibili/search.ts`, `twitter/search.ts` |

> **经验法则**：如果你发现 YAML 里嵌了超过 10 行 JS，改用 TS 更可维护。

### 通用模式：分页 API

很多 API 使用 `pn`（页码）+ `ps`（每页数量）分页。标准处理模式：

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

> 大多数站点的 `ps` 上限是 20~50。超过会被静默截断或返回错误。

### 方式 A: YAML Pipeline（声明式，推荐）

文件路径: `src/clis/<site>/<name>.yaml`，放入即自动注册。

#### Tier 1 — 公开 API 模板

```yaml
# src/clis/v2ex/hot.yaml
site: v2ex
name: hot
description: V2EX 热门话题
domain: www.v2ex.com
strategy: public
browser: false

args:
  limit:
    type: int
    default: 20

pipeline:
  - fetch:
      url: https://www.v2ex.com/api/topics/hot.json

  - map:
      rank: ${{ index + 1 }}
      title: ${{ item.title }}
      replies: ${{ item.replies }}

  - limit: ${{ args.limit }}

columns: [rank, title, replies]
```

#### Tier 2 — Cookie 认证模板（最常用）

```yaml
# src/clis/zhihu/hot.yaml
site: zhihu
name: hot
description: 知乎热榜
domain: www.zhihu.com

pipeline:
  - navigate: https://www.zhihu.com       # 先加载页面建立 session

  - evaluate: |                            # 在浏览器内发请求，自动带 Cookie
      (async () => {
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
      })()

  - map:
      rank: ${{ index + 1 }}
      title: ${{ item.title }}
      heat: ${{ item.heat }}
      answers: ${{ item.answers }}

  - limit: ${{ args.limit }}

columns: [rank, title, heat, answers]
```

> **关键**: `evaluate` 步骤内的 `fetch` 运行在浏览器页面内，自动携带 `credentials: 'include'`，无需手动处理 Cookie。

#### 进阶 — 带搜索参数

```yaml
# src/clis/zhihu/search.yaml
site: zhihu
name: search
description: 知乎搜索

args:
  query:
    type: str
    required: true
    positional: true
    description: Search query
  limit:
    type: int
    default: 10

pipeline:
  - navigate: https://www.zhihu.com

  - evaluate: |
      (async () => {
        const q = encodeURIComponent('${{ args.query }}');
        const res = await fetch('/api/v4/search_v3?q=' + q + '&t=general&limit=${{ args.limit }}', {
          credentials: 'include'
        });
        const d = await res.json();
        return (d?.data || [])
          .filter(item => item.type === 'search_result')
          .map(item => ({
            title: (item.object?.title || '').replace(/<[^>]+>/g, ''),
            type: item.object?.type || '',
            author: item.object?.author?.name || '',
            votes: item.object?.voteup_count || 0,
          }));
      })()

  - map:
      rank: ${{ index + 1 }}
      title: ${{ item.title }}
      type: ${{ item.type }}
      author: ${{ item.author }}
      votes: ${{ item.votes }}

  - limit: ${{ args.limit }}

columns: [rank, title, type, author, votes]
```

#### Tier 4 — Store Action Bridge（`tap` 步骤，intercept 策略推荐）

适用于 Vue + Pinia/Vuex 的网站（如小红书），无须手动写 XHR 拦截代码：

```yaml
# src/clis/xiaohongshu/notifications.yaml
site: xiaohongshu
name: notifications
description: "小红书通知"
domain: www.xiaohongshu.com
strategy: intercept
browser: true

args:
  type:
    type: str
    default: mentions
    description: "Notification type: mentions, likes, or connections"
  limit:
    type: int
    default: 20

columns: [rank, user, action, content, note, time]

pipeline:
  - navigate: https://www.xiaohongshu.com/notification
  - wait: 3
  - tap:
      store: notification       # Pinia store name
      action: getNotification   # Store action to call
      args:                     # Action arguments
        - ${{ args.type | default('mentions') }}
      capture: /you/            # URL pattern to capture response
      select: data.message_list # Extract sub-path from response
      timeout: 8
  - map:
      rank: ${{ index + 1 }}
      user: ${{ item.user_info.nickname }}
      action: ${{ item.title }}
      content: ${{ item.comment_info.content }}
  - limit: ${{ args.limit | default(20) }}
```

> **`tap` 步骤自动完成**：注入 fetch+XHR 双拦截 → 查找 Pinia/Vuex store → 调用 action → 捕获匹配 URL 的响应 → 清理拦截。  
> 如果 store 或 action 找不到，会返回 `hint` 列出所有可用的 store actions，方便调试。

| tap 参数 | 必填 | 说明 |
|---------|------|------|
| `store` | ✅ | Pinia store 名称（如 `feed`, `search`, `notification`） |
| `action` | ✅ | Store action 方法名 |
| `capture` | ✅ | URL 子串匹配（匹配网络请求 URL） |
| `args` | ❌ | 传给 action 的参数数组 |
| `select` | ❌ | 从 captured JSON 中提取的路径（如 `data.items`） |
| `timeout` | ❌ | 等待网络响应的超时秒数（默认 5s） |
| `framework` | ❌ | `pinia` 或 `vuex`（默认自动检测） |

### 方式 B: TypeScript 适配器（编程式）

适用于需要嵌入 JS 代码读取 Pinia state、XHR 拦截、GraphQL、分页、复杂数据转换等场景。

文件路径: `src/clis/<site>/<name>.ts`。文件将会在运行时被动态扫描并注册（切勿在 `index.ts` 中手动 `import`）。

#### Tier 3 — Header 认证（Twitter）

```typescript
// src/clis/twitter/search.ts
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'twitter',
  name: 'search',
  description: 'Search tweets',
  strategy: Strategy.HEADER,
  args: [{ name: 'query', required: true, positional: true }],
  columns: ['rank', 'author', 'text', 'likes'],
  func: async (page, kwargs) => {
    await page.goto('https://x.com');
    const data = await page.evaluate(`
      (async () => {
        // 从 Cookie 提取 CSRF token
        const ct0 = document.cookie.split(';')
          .map(c => c.trim())
          .find(c => c.startsWith('ct0='))?.split('=')[1];
        if (!ct0) return { error: 'Not logged in' };

        const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D...';
        const headers = {
          'Authorization': 'Bearer ' + decodeURIComponent(bearer),
          'X-Csrf-Token': ct0,
          'X-Twitter-Auth-Type': 'OAuth2Session',
        };

        const variables = JSON.stringify({ rawQuery: '${kwargs.query}', count: 20 });
        const url = '/i/api/graphql/xxx/SearchTimeline?variables=' + encodeURIComponent(variables);
        const res = await fetch(url, { headers, credentials: 'include' });
        return await res.json();
      })()
    `);
    // ... 解析 data
  },
});
```

#### Tier 4 — XHR/Fetch 双重拦截 (Twitter/小红书 通用模式)

```typescript
// src/clis/xiaohongshu/user.ts
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'xiaohongshu',
  name: 'user',
  description: '获取用户笔记',
  strategy: Strategy.INTERCEPT,
  args: [{ name: 'id', required: true }],
  columns: ['rank', 'title', 'likes', 'url'],
  func: async (page, kwargs) => {
    await page.goto(`https://www.xiaohongshu.com/user/profile/${kwargs.id}`);
    await page.wait(5);

    // XHR/Fetch 底层拦截：捕获所有包含 'v1/user/posted' 的请求
    await page.installInterceptor('v1/user/posted');

    // 触发后端 API：模拟人类用户向底部滚动2次
    await page.autoScroll({ times: 2, delayMs: 2000 });

    // 提取所有被拦截捕获的 JSON 响应体
    const requests = await page.getInterceptedRequests();
    if (!requests || requests.length === 0) return [];

    let results = [];
    for (const req of requests) {
      if (req.data?.data?.notes) {
        for (const note of req.data.data.notes) {
           results.push({
             title: note.display_title || '',
             likes: note.interact_info?.liked_count || '0',
             url: `https://explore/${note.note_id || note.id}`
           });
        }
      }
    }

    return results.slice(0, 20).map((item, i) => ({
      rank: i + 1, ...item,
    }));
  },
});
```

> **拦截核心思路**：不自己构造签名，而是利用 `installInterceptor` 劫持网站自己的 `XMLHttpRequest` 和 `fetch`，让网站发请求，我们直接在底层取出解析好的 `response.json()`。

> **级联请求**（如 BVID→CID→字幕）的完整模板和要点见下方[进阶模式: 级联请求](#进阶模式-级联请求-cascading-requests)章节。

---

## Step 4: 测试

> **构建通过 ≠ 功能正常**。`npm run build` 只验证 TypeScript / YAML 语法，不验证运行时行为。  
> 每个新命令 **必须实际运行** 并确认输出正确后才算完成。

### 必做清单

```bash
# 1. 构建（确认语法无误）
npm run build

# 2. 确认命令已注册
opencli list | grep mysite

# 3. 实际运行命令（最关键！）
opencli mysite hot --limit 3 -v        # verbose 查看每步数据流
opencli mysite hot --limit 3 -f json   # JSON 输出确认字段完整
```

### tap 步骤调试（intercept 策略专用）

> **不要猜 store name / action name**。先用 evaluate 探索，再写 YAML。

#### Step 1: 列出所有 Pinia store

在浏览器中打开目标网站后：

```bash
opencli evaluate "(() => {
  const app = document.querySelector('#app')?.__vue_app__;
  const pinia = app?.config?.globalProperties?.\$pinia;
  return [...pinia._s.keys()];
})()"
# 输出: ["user", "feed", "search", "notification", ...]
```

#### Step 2: 查看 store 的 action 名称

故意写一个错误 action 名，tap 会返回所有可用 actions：

```
⚠  tap: Action not found: wrongName on store notification
💡 Available: getNotification, replyComment, getNotificationCount, reset
```

#### Step 3: 用 network requests 确认 capture 模式

```bash
# 在浏览器打开目标页面，查看网络请求
# 找到目标 API 的 URL 特征（如 "/you/mentions"、"homefeed"）
```

#### 完整流程

```
 ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌────────┐
 │ 1. navigate  │ ──▶ │ 2. 探索 store │ ──▶ │ 3. 写 YAML   │ ──▶ │ 4. 测试 │
 │    到目标页面  │     │ name/action  │     │    tap 步骤   │     │ 运行验证 │
 └──────────────┘     └──────────────┘     └──────────────┘     └────────┘
```

### Verbose 模式 & 输出验证

```bash
opencli bilibili hot --limit 1 -v          # 查看 pipeline 每步数据流
opencli mysite hot -f json | jq '.[0]'     # 确认 JSON 可被解析
opencli mysite hot -f csv > data.csv       # 确认 CSV 可导入
```

---

## Step 5: 提交发布

文件放入 `src/clis/<site>/` 即自动注册（YAML 或 TS 无需手动 import），然后：

```bash
opencli list | grep mysite                            # 确认注册
git add src/clis/mysite/ && git commit -m "feat(mysite): add hot" && git push
```

> **架构理念**：OpenCLI 内建 **Zero-Dependency jq** 数据流 — 所有解析在 `evaluate` 的原生 JS 内完成，外层 YAML 用 `select`/`map` 提取，无需依赖系统 `jq` 二进制。

---

## 进阶模式: 级联请求 (Cascading Requests)

当目标数据需要多步 API 链式获取时（如 `BVID → CID → 字幕列表 → 字幕内容`），必须使用 **TS 适配器**。YAML 无法处理这种多步逻辑。

### 模板代码

```typescript
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { apiGet } from './utils.js'; // 复用平台 SDK

cli({
  site: 'bilibili',
  name: 'subtitle',
  strategy: Strategy.COOKIE,
  args: [{ name: 'bvid', required: true }],
  columns: ['index', 'from', 'to', 'content'],
  func: async (page: IPage | null, kwargs: any) => {
    if (!page) throw new Error('Requires browser');

    // Step 1: 建立 Session
    await page.goto(`https://www.bilibili.com/video/${kwargs.bvid}/`);

    // Step 2: 从页面提取中间 ID (__INITIAL_STATE__)
    const cid = await page.evaluate(`(async () => {
      return window.__INITIAL_STATE__?.videoData?.cid;
    })()`);
    if (!cid) throw new Error('无法提取 CID');

    // Step 3: 用中间 ID 调用下一级 API (自动 Wbi 签名)
    const payload = await apiGet(page, '/x/player/wbi/v2', {
      params: { bvid: kwargs.bvid, cid },
      signed: true, // ← 自动生成 w_rid
    });

    // Step 4: 检测风控降级 (空值断言)
    const subtitles = payload.data?.subtitle?.subtitles || [];
    const url = subtitles[0]?.subtitle_url;
    if (!url) throw new Error('subtitle_url 为空，疑似风控降级');

    // Step 5: 拉取最终数据 (CDN JSON)
    const items = await page.evaluate(`(async () => {
      const res = await fetch(${JSON.stringify('https:' + url)});
      const json = await res.json();
      return { data: json.body || json };
    })()`);

    return items.data.map((item, idx) => ({ ... }));
  },
});
```

### 关键要点

| 步骤 | 注意事项 |
|------|----------|
| 提取中间 ID | 优先从 `__INITIAL_STATE__` 拿，避免额外 API 调用 |
| Wbi 签名 | B 站 `/wbi/` 接口**强制校验** `w_rid`，纯 `fetch` 会被 403 |
| 空值断言 | 即使 HTTP 200，核心字段可能为空串（风控降级） |
| CDN URL | 常以 `//` 开头，记得补 `https:` |
| `JSON.stringify` | 拼接 URL 到 evaluate 时必须用它转义，避免注入 |

---

## 常见陷阱

| 陷阱 | 表现 | 解决方案 |
|------|------|---------|
| 缺少 `navigate` | evaluate 报 `Target page context` 错误 | 在 evaluate 前加 `navigate:` 步骤 |
| 嵌套字段访问 | `${{ item.node?.title }}` 不工作 | 在 evaluate 中 flatten 数据，不在模板中用 optional chaining |
| 缺少 `strategy: public` | 公开 API 也启动浏览器，7s → 1s | 公开 API 加上 `strategy: public` + `browser: false` |
| evaluate 返回字符串 | map 步骤收到 `""` 而非数组 | pipeline 有 auto-parse，但建议在 evaluate 内 `.map()` 整形 |
| 搜索参数被 URL 编码 | `${{ args.query }}` 被浏览器二次编码 | 在 evaluate 内用 `encodeURIComponent()` 手动编码 |
| Cookie 过期 | 返回 401 / 空数据 | 在浏览器里重新登录目标站点 |
| Extension tab 残留 | Chrome 多出 `chrome-extension://` tab | 已自动清理；若残留，手动关闭即可 |
| TS evaluate 格式 | `() => {}` 报 `result is not a function` | TS 中 `page.evaluate()` 必须用 IIFE：`(async () => { ... })()` |
| 页面异步加载 | evaluate 拿到空数据（store state 还没更新） | 在 evaluate 内用 polling 等待数据出现，或增加 `wait` 时间 |
| YAML 内嵌大段 JS | 调试困难，字符串转义问题 | 超过 10 行 JS 的命令改用 TS adapter |
| **风控被拦截(伪200)** | 获取到的 JSON 里核心数据是 `""` (空串) | 极易被误判。必须添加断言！无核心数据立刻要求升级鉴权 Tier 并重新配置 Cookie |
| **API 没找见** | `explore` 工具打分出来的都拿不到深层数据 | 点击页面按钮诱发懒加载数据，再结合 `getInterceptedRequests` 获取 |

---

## 用 AI Agent 自动生成适配器

最快的方式是让 AI Agent 完成全流程：

```bash
# 一键：探索 → 分析 → 合成 → 注册
opencli generate https://www.example.com --goal "hot"

# 或分步执行：
opencli explore https://www.example.com --site mysite           # 发现 API
opencli explore https://www.example.com --auto --click "字幕,CC"  # 模拟点击触发懒加载 API
opencli synthesize mysite                                        # 生成候选 YAML
opencli verify mysite/hot --smoke                                # 冒烟测试
```

生成的候选 YAML 保存在 `.opencli/explore/mysite/candidates/`，可直接复制到 `src/clis/mysite/` 并微调。

## Record Workflow

`record` 是为「无法用 `explore` 自动发现」的页面（需要登录操作、复杂交互、SPA 内路由）准备的手动录制方案。

### 工作原理

```
opencli record <url>
  → 打开 automation window 并导航到目标 URL
  → 向所有 tab 注入 fetch/XHR 拦截器（幂等，可重复注入）
  → 每 2s 轮询一次：发现新 tab 自动注入，drain 所有 tab 的捕获缓冲区
  → 超时（默认 60s）或按 Enter 停止
  → 分析捕获到的 JSON 请求：去重 → 评分 → 生成候选 YAML
```

**拦截器特性**：
- 同时 patch `window.fetch` 和 `XMLHttpRequest`
- 只捕获 `Content-Type: application/json` 的响应
- 过滤纯对象少于 2 个 key 的响应（避免 tracking/ping）
- 跨 tab 隔离：每个 tab 独立缓冲区，轮询时分别 drain
- 幂等注入：同一 tab 二次注入时先 restore 原始函数再重新 patch，不丢失已捕获数据

### 使用步骤

```bash
# 1. 启动录制（建议 --timeout 给足操作时间）
opencli record "https://example.com/page" --timeout 120000

# 2. 在弹出的 automation window 里正常操作页面：
#    - 打开列表、搜索、点击条目、切换 Tab
#    - 凡是触发网络请求的操作都会被捕获

# 3. 完成操作后按 Enter 停止（或等超时自动停止）

# 4. 查看结果
cat .opencli/record/<site>/captured.json        # 原始捕获
ls  .opencli/record/<site>/candidates/          # 候选 YAML
```

### 页面类型与捕获预期

| 页面类型 | 预期捕获量 | 说明 |
|---------|-----------|------|
| 列表/搜索页 | 多（5~20+） | 每次搜索/翻页都会触发新请求 |
| 详情页（只读） | 少（1~5） | 首屏数据一次性返回，后续操作走 form/redirect |
| SPA 内路由跳转 | 中等 | 路由切换会触发新接口，但首屏请求在注入前已发出 |
| 需要登录的页面 | 视操作而定 | 确保 Chrome 已登录目标网站 |

> **注意**：如果页面在导航完成前就发出了大部分请求（服务端渲染 / SSR 注水），拦截器会错过这些请求。
> 解决方案：在页面加载完成后，手动触发能产生新请求的操作（搜索、翻页、切 Tab、展开折叠项等）。

### 候选 YAML → TS CLI 转换

生成的候选 YAML 是起点，通常需要转换为 TypeScript（尤其是 tae 等内部系统）：

**候选 YAML 结构**（自动生成）：
```yaml
site: tae
name: getList          # 从 URL path 推断的名称
strategy: cookie
browser: true
pipeline:
  - navigate: https://...
  - evaluate: |
      (async () => {
        const res = await fetch('/approval/getList.json?procInsId=...', { credentials: 'include' });
        const data = await res.json();
        return (data?.content?.operatorRecords || []).map(item => ({ ... }));
      })()
```

**转换为 TS CLI**（参考 `src/clis/tae/add-expense.ts` 风格）：
```typescript
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'tae',
  name: 'get-approval',
  description: '查看报销单审批流程和操作记录',
  domain: 'tae.alibaba-inc.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'proc_ins_id', type: 'string', required: true, positional: true, help: '流程实例 ID（procInsId）' },
  ],
  columns: ['step', 'operator', 'action', 'time'],
  func: async (page, kwargs) => {
    await page.goto('https://tae.alibaba-inc.com/expense/pc.html?_authType=SAML');
    await page.wait(2);
    const result = await page.evaluate(`(async () => {
      const res = await fetch('/approval/getList.json?taskId=&procInsId=${kwargs.proc_ins_id}', {
        credentials: 'include'
      });
      const data = await res.json();
      return data?.content?.operatorRecords || [];
    })()`);
    return (result as any[]).map((r, i) => ({
      step: i + 1,
      operator: r.operatorName || r.userId,
      action: r.operationType,
      time: r.operateTime,
    }));
  },
});
```

**转换要点**：
1. URL 中的动态 ID（`procInsId`、`taskId` 等）提取为 `args`
2. `captured.json` 里的真实 body 结构用于确定正确的数据路径（如 `content.operatorRecords`）
3. tae 系统统一用 `{ success, content, errorCode, errorMsg }` 外层包裹，取数据要走 `content.*`
4. 认证方式：cookie（`credentials: 'include'`），不需要额外 header
5. 文件放入 `src/clis/<site>/`，无需手动注册，`npm run build` 后自动发现

### 故障排查

| 现象 | 原因 | 解法 |
|------|------|------|
| 捕获 0 条请求 | 拦截器注入失败，或页面无 JSON API | 检查 daemon 是否运行：`curl localhost:19825/status` |
| 捕获量少（1~3 条） | 页面是只读详情页，首屏数据已在注入前发出 | 手动操作触发更多请求（搜索/翻页），或换用列表页 |
| 候选 YAML 为 0 | 捕获到的 JSON 都没有 array 结构 | 直接看 `captured.json` 手写 TS CLI |
| 新开的 tab 没有被拦截 | 轮询间隔内 tab 已关闭 | 缩短 `--poll 500` |
| 二次运行 record 时数据不连续 | 正常，每次 `record` 启动都是新的 automation window | 无需处理 |
