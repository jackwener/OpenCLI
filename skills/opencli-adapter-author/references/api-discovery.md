# API Discovery

**Layer 2：这个站的目标数据 endpoint 是什么？** 已经分完类（`site-recon.md`）再进来。

五种手段。按优先级降级用，命中即走。

---

## §1 network 精读（首选，Pattern A / D 命中率最高）

### 拿候选

```bash
opencli browser network
```

默认输出是 JSON，每个候选都带：
- `key` — 稳定引用（GraphQL 的 `operationName` 或 `METHOD host+pathname`）
- `shape` — response body 的路径→类型映射（不含原 body，省 token）
- `status / url / method / ct / size`

静态资源 / 埋点 / 追踪默认已过滤；需要全量看用 `--all`。

### 按 shape 初筛

挑 `key` 里含业务词（`list / detail / Timeline / User / Tweets / Quote`）的优先看 `shape`：

- `$.data` 是 `object` 且下面出现 `array(N)` / `total` / `page` → 基本是它
- 路径里出现 `nickname / avatar / title / price / tweets / items` → 就是它
- shape 只有 `$: string` 或全是 HTML 噪音 → 下一条

### 按期望字段反查（`--filter`）

已经知道目标 body 该含哪些字段就直接让 CLI 把列表筛到只剩候选，不用自己 scroll 翻 shape：

```bash
opencli browser network --filter author,text,likes
```

- 字段以英文逗号分隔；AND 语义，必须每个字段都作为 shape 路径的**任意一段**出现才保留（`$.data.items[0].author` 命中 `author`、`items`、`data` 都算）
- 区分大小写（JSON key 本来就 case-sensitive）
- 输出 envelope 新增 `filter` / `filter_dropped`，`count` 是过滤后数量
- 0 命中不是 error，返回 `entries: []`；说明字段组合不对，换一组或去掉约束再试
- 不要跟 `--detail` 一起用——`--detail` 按 key 取单条、`--filter` 是列表缩窄，组合会报 `invalid_args`
- 空值 / `,,,` → `invalid_filter` 结构化错误
- capture 依然按全量持久化，后续 `--detail <key>` 能找到被过滤掉的条目

### 拉完整 body

候选定了再拉完整 body（by key，不是 index — 数组顺序会随每次 capture 变）：

```bash
opencli browser network --detail <key>
```

capture 会持久化到 `~/.opencli/cache/browser-network/<workspace>.json`（默认 TTL 24h），所以 `--detail` 即使跨多条其他命令也还在。

### 关键 request headers

`browser network` 当前只抓响应（body + status + ct），抓不到请求头。要看请求头就在 DevTools Network 面板里点这条 request，或用 `browser eval` 手动 `fetch(url)` 复现一次观察浏览器发出去的头：

| 看到 | 含义 | 对应策略 |
|------|------|---------|
| 只有 `Cookie` | 登录态靠 cookie | `Strategy.COOKIE` |
| `Authorization: Bearer xxx` | token 鉴权 | 先找 token 来源（localStorage / cookie / bundle 硬编码） |
| `X-Csrf-Token: xxx` 同时存在 cookie 里 | CSRF 防护 | `Strategy.HEADER`，从 cookie 读 ct0 类字段拼头 |
| `X-Workspace-Id / X-Tenant-Id` | 多租户业务头 | 先调 `/workspaces` 拿 ID，缓存下来 |
| 啥自定义头都没有 | 匿名接口 | `Strategy.PUBLIC` |

### 触发懒加载接口

默认页加载完后滚动 / 点击才会出的接口不在首屏 network 里。需要：

```bash
# 滚到底（虚拟列表）
opencli browser eval "window.scrollTo(0, document.body.scrollHeight)"
opencli browser wait time 2
opencli browser network

# 点某个按钮
opencli browser click <N>
opencli browser wait time 2
opencli browser network
```

---

## §2 `__INITIAL_STATE__` / inline HTML（Pattern B）

首屏数据常挂在这几个全局变量上：

```bash
opencli browser eval "Object.keys(window).filter(k=>k.startsWith('__'))"
```

命中的常见名：

| 全局 | 框架 |
|------|-----|
| `__NEXT_DATA__` | Next.js |
| `__NUXT__` | Nuxt.js |
| `__INITIAL_STATE__` | 自定义 Vue / React SSR |
| `__PRELOADED_STATE__` | Redux SSR |
| `__REMIX_CONTEXT__` | Remix |

取数据：

```bash
opencli browser eval "JSON.stringify(window.__NEXT_DATA__).slice(0, 3000)"
```

**关键**：inline state 只覆盖首屏的一部分（通常是 SEO 相关字段）。分页 / 评论 / 懒加载还是得回 §1 抓 API。

把首屏 state 当作 adapter 的兜底数据源：公开访问时 state 里有 → 直接 parse；数据更新快 / 分页 → 回到 API。

---

## §3 JS bundle / script src 搜索（Pattern C，也是 A/D 的降级）

### 扫 script src

```bash
opencli browser eval "[...document.querySelectorAll('script[src]')].map(s=>s.src).filter(s=>!/\\.(css|png|jpg|svg|woff|mp4)$/.test(s)&&!/googletagmanager|crazyegg|sentry|doubleclick|amazon-adsystem|cloudflare/.test(s))"
```

看结果里的 hostname：

- 明显像 API 的域名（`api.xxx / push.xxx / data.xxx / gateway.xxx`）→ 直接去试
- 主 bundle（`main.js / app.js / index.xxx.js`）→ 继续下一步下载 bundle 搜 baseURL

### 搜 bundle 里的 baseURL

```bash
opencli browser eval "(async()=>{const s=[...document.querySelectorAll('script[src]')].map(e=>e.src).find(s=>/main|app|index|bundle|chunk/.test(s));if(!s)return'no bundle';const t=await fetch(s).then(r=>r.text());const patterns=['baseURL','baseUrl','BASE_URL','apiHost','apiBase','API_HOST','API_BASE'];const hits=[];for(const p of patterns){let i=-1;while((i=t.indexOf(p,i+1))>-1&&hits.length<5)hits.push(t.slice(Math.max(0,i-5),i+80));}return hits})()"
```

命中 `baseURL:"https://api.foo.com"` 直接拿 host 拼 endpoint。

### 直接试候选 endpoint

像 eastmoney 这种经验 endpoint 可以直接喂：

```bash
opencli browser eval "fetch('https://push2.eastmoney.com/api/qt/clist/get?fs=m:1+t:2&pn=1&pz=5&fltt=2&fid=f3&po=1&fields=f2,f3,f12,f14').then(r=>r.json())"
```

200 且数据对得上就认。

### URL 后缀探测

有些站直接在 URL 加 `.json` 就是 REST：

- `https://www.reddit.com/r/rust.json` — Reddit 全覆盖
- `https://xueqiu.com/S/SH600000.json` — 雪球部分页

```bash
# 当前页加 .json 试
opencli browser eval "fetch(location.pathname.replace(/\\/$/,'')+'.json').then(r=>r.ok?r.json():'no')"
```

---

## §4 Token / CSRF 来源排查（Pattern D）

已经在 network 里看到请求带自定义头，怎么拿到那个值：

### Cookie 里

```bash
opencli browser eval "document.cookie.split('; ').reduce((o,x)=>{const[k,v]=x.split('=');o[k]=v;return o},{})"
```

常见 token cookie 名：`ct0`（Twitter CSRF）、`xq_a_token`（雪球）、`SESSDATA`（B 站）、`_csrf / csrfToken`（通用）。

### localStorage / sessionStorage 里

```bash
opencli browser eval "Object.keys(localStorage).map(k=>k+' => '+localStorage.getItem(k).slice(0,50))"
```

找 `token / auth / jwt / bearer` 关键字。

### Bundle 硬编码

有些站的 Bearer 是全站一个常量（Twitter 的匿名 Bearer）。在 bundle 里搜：

```bash
opencli browser eval "(async()=>{const s=[...document.querySelectorAll('script[src]')].map(e=>e.src).find(s=>/main|app|bundle/.test(s));const t=await fetch(s).then(r=>r.text());const m=t.match(/Bearer\\s+[\\w-]{20,}/g);return m?.slice(0,3)||'not found'})()"
```

### Store action 绕签名

Vue + Pinia / Redux / React Context 有时直接调 store method 能绕过签名逻辑（method 内部会自己拿签名再发请求）：

```bash
# Pinia
opencli browser eval "typeof __pinia !== 'undefined' ? Object.keys(__pinia.state.value) : 'no pinia'"

# 直接调 store action（每个站点具体 action 名要查）
opencli browser eval "window.__pinia.state.value.someStore.someMethod({...})"
```

---

## §5 installInterceptor（最后降级）

所有手段都试过还拿不到请求签名时，让页面自己发请求，adapter 做 MITM 拦截响应：

```javascript
// func 里
await page.evaluate(installInterceptorCode, { domain: 'api.xxx.com', path: '/foo' });
await page.goto('https://xxx.com/trigger-page');
// 等页面自己发那条请求
const intercepted = await page.evaluate('window.__opencli_intercepted');
return intercepted.response;
```

代价是要等页面真的触发请求，慢、不稳。只在 §1-4 都不行时用。

---

## 诊断不出来怎么办

按这个顺序试到命中：

```
§1 network ──→ 命中？yes → 走
      │        no
      ↓
§2 state  ──→ 命中？yes → 走
      │        no
      ↓
§3 bundle ──→ 命中？yes → 走
      │        no
      ↓
§4 token  ──→ 401 解除？yes → 走
      │        no
      ↓
§5 intercept → 让页面自己发
```

**四条都命不中的站（罕见）**：多半是视觉化渲染（canvas / webgl），数据不以 HTTP/JSON 形式存在。这种放弃或换源。
