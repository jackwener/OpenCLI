# Advanced Patterns

---

## 级联请求 (Cascading Requests)

当目标数据需要多步 API 链式获取时（如 `BVID → CID → 字幕列表 → 字幕内容`），在 `func()` 内按步骤串联。

### 模板代码

```typescript
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
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

    // Step 2: 从页面提取中间 ID（优先用 __INITIAL_STATE__，免一次 API 调用）
    const cid = await page.evaluate(`(async () => {
      return window.__INITIAL_STATE__?.videoData?.cid;
    })()`);
    if (!cid) throw new Error('无法提取 CID');

    // Step 3: 用中间 ID 调用下一级 API（自动 Wbi 签名）
    const payload = await apiGet(page, '/x/player/wbi/v2', {
      params: { bvid: kwargs.bvid, cid },
      signed: true,
    });

    // Step 4: 断言风控降级（空值断言）
    const subtitles = payload.data?.subtitle?.subtitles || [];
    const url = subtitles[0]?.subtitle_url;
    if (!url) return [{ error: 'subtitle_url is empty — possible risk-control block', remedy: 'Re-login to Bilibili, then retry' }];

    // Step 5: 拉取最终数据（CDN JSON）
    const items = await page.evaluate(`(async () => {
      const res = await fetch(${JSON.stringify('https:' + url)});
      const json = await res.json();
      return json.body || json;
    })()`);

    return (items as any[]).map((item, idx) => ({
      index: idx + 1,
      from: item.from,
      to: item.to,
      content: item.content,
    }));
  },
});
```

### 关键要点

| 步骤 | 注意事项 |
|------|----------|
| 提取中间 ID | 优先从 `__INITIAL_STATE__` 拿，避免额外 API 调用 |
| Wbi 签名 | B 站 `/wbi/` 接口强制校验 `w_rid`，纯 `fetch` 会被 403 |
| 空值断言 | 即使 HTTP 200，核心字段可能为空串（风控降级） |
| CDN URL | 常以 `//` 开头，补 `https:` |
| `JSON.stringify` | 拼接 URL 到 evaluate 时必须用它转义，避免注入 |

---

## tap 步骤调试（intercept 策略专用）

> **不要猜 store name / action name**。先用 `browser eval` 探索，再写 TS 适配器。

### Step 1: 列出所有 Pinia store

```bash
opencli browser eval "(() => {
  const app = document.querySelector('#app')?.__vue_app__;
  const pinia = app?.config?.globalProperties?\$pinia;
  return JSON.stringify([...pinia._s.keys()]);
})()"
# 输出: ["user", "feed", "search", "notification", ...]
```

### Step 2: 查看 store 的 action 名称

故意写一个错误 action 名，tap 会返回所有可用 actions：

```
⚠  tap: Action not found: wrongName on store notification
💡 Available: getNotification, replyComment, getNotificationCount, reset
```

### Step 3: 确认 URL 特征（用于 installInterceptor）

```bash
opencli browser network                  # 列出捕获的 API 请求
opencli browser network --detail <N>     # 查看第 N 条的完整响应
# 找到目标 API 的 URL 子串（如 "/you/mentions"、"homefeed"）
```

### 完整流程

```
 ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌────────┐
 │ 1. navigate  │ ──▶ │ 2. 探索 store │ ──▶ │ 3. 写 TS      │ ──▶ │ 4. 测试 │
 │    到目标页面  │     │ name/action  │     │  interceptor  │     │ 运行验证 │
 └──────────────┘     └──────────────┘     └──────────────┘     └────────┘
```

---

## Verbose 模式 & 输出验证

```bash
opencli bilibili hot --limit 1 -v          # 查看 pipeline 每步数据流
opencli mysite hot -f json | jq '.[0]'     # 确认 JSON 可被解析
opencli mysite hot -f csv > data.csv       # 确认 CSV 可导入
```

---

## 抗变更模式 (Anti-Change Patterns)

网站会频繁修改 CSS class、webpack module ID、GraphQL queryId，导致 adapter 失效。以下是 opencli 生产验证的写法。

### 模式 1：动态 queryId 发现（替代硬编码）

**问题**：Twitter/X 每次部署都会更新 GraphQL queryId，硬编码很快失效。

**方案**：优先从 JS bundle 动态扫描，用 `operationName`（稳定）查 `queryId`（易变）。参考 `clis/twitter/shared.ts`：

```typescript
const resolved = await page.evaluate(`async () => {
  const operationName = 'ListsManagePinTimeline';

  // Tier A: 社区维护的配置文件（更新快）
  try {
    const data = await fetch('https://raw.githubusercontent.com/.../placeholder.json')
      .then(r => r.json());
    if (data?.[operationName]?.queryId) return data[operationName].queryId;
  } catch {}

  // Tier B: 扫描已加载的 client-web JS bundle
  const scripts = performance.getEntriesByType('resource')
    .filter(r => r.name.includes('client-web') && r.name.endsWith('.js'))
    .map(r => r.name);
  for (const url of scripts.slice(0, 15)) {
    const text = await fetch(url).then(r => r.text());
    const m = text.match('queryId:"([A-Za-z0-9_-]+)"[^}]{0,200}operationName:"' + operationName + '"');
    if (m) return m[1];
  }
  return null;  // 调用方使用 hardcoded fallback
}`);
```

**原则**：用业务语义字符串（`operationName`）定位，不用 module ID；多特征组合减少误匹配。

### 模式 2：语义 DOM 优先级降级（替代 CSS class 硬选）

**问题**：CSS class 随前端重构随时变化。

**方案**：按语义元素优先级逐级降级，只在最后才用 class hint。参考 `clis/web/read.ts`：

```typescript
// 优先级 1: <article>（标准语义）
const articles = document.querySelectorAll('article');
contentEl = articles.length === 1 ? articles[0]
  : [...articles].reduce((max, a) =>
      (a.textContent?.length || 0) > (max.textContent?.length || 0) ? a : max
    );

// 优先级 2: [role="main"]（ARIA 语义）
if (!contentEl) contentEl = document.querySelector('[role="main"]');

// 优先级 3: <main>（HTML5 语义）
if (!contentEl) contentEl = document.querySelector('main');

// 优先级 4: class-based hint（最后手段）
if (!contentEl) {
  const candidates = document.querySelectorAll(
    'div[class*="content"], div[class*="article"], div[class*="post"]'
  );
  contentEl = [...candidates].reduce((max, c) =>
    (c.textContent?.length || 0) > (max.textContent?.length || 0) ? c : max
  );
}
```

多元素时用**文本长度启发式**选最大块，不假设固定 index。

### 模式 3：多选择器有序数组 + 时间戳注释

**问题**：UI 迭代频繁，同一个输入框的选择器在新版本可能完全不同。

**方案**：把选择器按优先级列成有序数组，注释变更日期和观察依据。参考 `clis/xiaohongshu/publish.ts`：

```typescript
// New creator center (2026-03) uses contenteditable for the title field.
// Placeholder observed: "填写标题会有更多赞哦"
const TITLE_SELECTORS = [
  '[contenteditable="true"][placeholder*="标题"]',  // 新版（2026-03）
  '[contenteditable="true"][placeholder*="赞"]',    // 新版备选
  '[contenteditable="true"][class*="title"]',       // 通用
  'input[maxlength="20"]',                          // 旧版特征值
  'input[placeholder*="标题"]',                     // 旧版语义
];
for (const sel of TITLE_SELECTORS) {
  const el = document.querySelector(sel);
  if (el) { /* 使用 el */ break; }
}
```

**注释规范**：写下 UI 版本（年月）+ 观察到的具体属性值，维护者能快速判断注释是否还有效。

### 模式 4：API 字段多路映射

**问题**：后端 API 经常在驼峰/蛇形之间切换，或加入新字段名兼容旧客户端。

**方案**：用 nullish coalescing 链覆盖所有可能字段名。参考 `clis/xiaohongshu/user-helpers.ts`：

```typescript
// noteId 可能是 noteId / note_id / id，都要覆盖
const noteId = noteCard.noteId ?? noteCard.note_id ?? entry?.noteId ?? entry?.note_id ?? entry?.id;
const token  = entry?.xsecToken ?? entry?.xsec_token ?? noteCard.xsecToken ?? noteCard.xsec_token;
```

**何时使用**：API 字段名有下划线/驼峰混用时，或明确知道 API 历史上改过字段名时。
