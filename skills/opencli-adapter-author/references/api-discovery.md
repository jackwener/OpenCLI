# API Discovery

**Layer 2：这个站的目标数据 endpoint 是什么？** 已经分完类（`site-recon.md`）再进来。

五种手段。按优先级降级用；命中只代表“进入验证”，不代表可以直接写 adapter。复杂/私有/写入候选还要过 [`deep-recon.md`](./deep-recon.md) 的 contract gate。

---

## §0 进入 §1 之前：先看两条红线

这两条不看清楚，后面的 endpoint 验证会一直在错的前提下兜圈子。

### 0.1 反爬厂商 → 决定 fetch 能不能从 Node 走

`opencli browser analyze <url>` 的 `anti_bot` 字段给答案；手查看 cookies 也行：

| cookie / body 信号 | 厂商 | 裸 Node fetch / curl 结果 | 策略 |
|------------------|------|-----|-----|
| `acw_sc__v2` / `acw_tc` / `ssxmod_itna`；body 含 `arg1 = '32-HEX'` 或 `/ntc_captcha/` | **Aliyun WAF** | 返回 slider HTML，不是真数据 | 先在浏览器上下文里验证 endpoint；HTML 型 COOKIE adapter 最终仍走 Node-side fetch + `page.getCookies()` |
| `__cf_bm` / `cf_clearance` / `__cfduid`；body 含 `Cloudflare Ray ID` / `Checking your browser` | **Cloudflare** | TLS 指纹被标记，失败 | 同上：先 browser-context probe，最终 adapter 仍按模板选 fetch 路线 |
| `_abck` / `bm_sz` / `bm_sv` | **Akamai** | 即使带 cookie 也常被挡 | 同上 |
| body 含 `geetest` / `gt_captcha` | **Geetest** | 滑块/拼图，程序无解 | 超出 skill 范围，放弃或 UI 策略 |

**规则**：看到上面四种任一个，先不要拿**裸** Node fetch 做 endpoint 验证。先用 browser-context probe 或目标 origin 页面确认接口能通；最终 adapter 的 fetch 路线仍按 `adapter-template.md` 选，HTML 型 COOKIE adapter 继续走 Node-side fetch + `page.getCookies()`。

### 0.2 跨 subdomain = CORS 默认关

`jobs.51job.com` 页面 fetch `cupid.51job.com` 的 API，默认会被浏览器 CORS 预检挡住——除非目标接口回了 `Access-Control-Allow-Origin`。

判断：

```bash
opencli browser eval "fetch('https://<target-subdomain>/api/...', {credentials:'include'}).then(r=>r.status).catch(e=>'cors:'+e.message)"
```

- 返回 status 数字 → CORS 通，继续
- 返回 `cors:...` 或 `TypeError: Failed to fetch` → 挡住了

**挡住时**：不要把 `credentials:'include'` 当万能药——这只解决"带 cookie"，不解决"跨 origin"。降级路径：

1. 换同 origin 的 endpoint（同一个 subdomain 下的 API 往往更宽松）
2. 用 `opencli browser open https://<target-subdomain>/`，让页面在目标 subdomain 本身打开，再 fetch 相对路径
3. 真跨域且无替代 → 走 `§5 intercept`，从页面自身发的请求里抓响应

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

静态资源 / 埋点 / 追踪默认已过滤。默认会保留 JSON / XML / plain text / `text/javascript`，也会识别 `text/x-component` 与明确的 `/rsc-action/` React Server Component 流。如果你确定浏览器 DevTools 里有目标请求但这里缺失，用 `--all` 查一遍是否被其他 content-type 或 URL 噪音过滤挡掉。capture queue 是破坏性读取；Core 会先缓存本批原始条目再做展示过滤，所以紧接着的空 `--all` 仍可复用该 session 的 raw cache，而不是永久丢掉被隐藏的条目。

如果是冷启动，先看 `opencli browser analyze <url>` 里的 `api_candidates`：

- `verdict: "likely_data"`：优先 replay 这条，拿 status / content-type / sample shape 填 strategy note
- `verdict: "maybe_data"`：可以试，但必须人工核对字段是否是目标业务数据
- `verdict: "noise"`：多半是 analytics / beacon / personalization，不要因为 XHR 数量多就判 Pattern A
- `verdict: "blocked"`：401/403；先排 cookie / token / CSRF，别直接退到 selector

`real_data_score` 是证据，不是自动 strategy。最终仍要在 strategy note 里写 replay 结果和降级理由。

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

capture 会持久化到 `~/.opencli/cache/browser-network/<session>.json`（默认 TTL 24h），所以 `--detail` 即使跨多条其他命令也还在。

`--detail` 还会在 capture provider 支持时返回 `request`：method 仍在顶层；headers 中 cookie、Authorization、CSRF/XSRF、token/key/secret/session 等值会替换为 `<redacted>`；可安全识别的 JSON object / URL-encoded form 会保留结构，位置数组、opaque 或截断 body 只保留 kind、shape、full size、truncated/omitted 状态。不要因为 body 被安全省略就拿 URL 单独 replay——这说明请求合同仍不完整。

这也意味着私有页面的 response 可能落在本地 cache。侦察结束要删除相关 session capture 并释放 browser session；不要依赖 24h TTL 代替清理。

### 关键 request headers

先用 `browser network --detail <key>` 看脱敏后的 request headers / body shape；不要打印或复制 credential 原值。旧 capture provider 若没有返回 `request`，再去 DevTools Network 面板核字段名，或用页面自然动作重新 capture，不能用 `browser eval` 猜造一份缺 header/body 的 URL-only 请求：

| 看到 | 含义 | 对应策略 |
|------|------|---------|
| 只有 `Cookie` | 登录态靠 cookie | `Strategy.COOKIE` |
| `Authorization: Bearer xxx` | token 鉴权 | 先找 token 来源（localStorage / cookie / bundle 硬编码） |
| `X-Csrf-Token: xxx` 同时存在 cookie 里 | CSRF 防护 | `Strategy.COOKIE`，从 cookie 读 ct0 类字段拼头 |
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

### 用 jsluice 扩大候选面（可选）

手工搜 `baseURL` 只适合小 bundle。站点脚本多、压缩重或 endpoint 通过 `fetch` / XHR / 字符串拼接生成时，可以把**已经加载的脚本文本**通过 stdin 交给本机可选的 [jsluice](https://github.com/BishopFox/jsluice) 做语法感知扫描。

```bash
# bundle 只短暂落 /tmp；扫描后删除
jsluice urls < /tmp/example-bundle.js
```

边界：jsluice 输出是 candidate，不是 contract。`EXPR` 表示动态值未知；扫描无法证明 token、签名、CORS、权限、分页、字段语义或副作用。不要把命中 URL 直接写进 adapter，更不要把扫描到的疑似 secret 原值保存到 trace/site memory。

每个候选至少记录：来源 bundle + 代码位置、method/path、触发它的可见动作、动态 network 是否发生、replay status/content-type/shape、选择或拒绝原因。复杂站直接转 [`deep-recon.md`](./deep-recon.md) 的 evidence ledger。

### 直接试候选 endpoint

像 eastmoney 这种经验 endpoint 可以直接喂：

```bash
opencli browser eval "fetch('https://push2.eastmoney.com/api/qt/clist/get?fs=m:1+t:2&pn=1&pz=5&fltt=2&fid=f3&po=1&fields=f2,f3,f12,f14').then(r=>r.json())"
```

200 只是 transport 成功。至少换一个输入再试，并核 content-type、目标 identity、非空 shape、分页和可见页面值；写入或复杂私有协议转 `deep-recon.md`，不能“数据看起来像”就认。

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
opencli browser eval "document.cookie.split('; ').map(x=>x.slice(0,x.indexOf('='))).filter(Boolean)"
```

常见 token cookie 名：`ct0`（Twitter CSRF）、`xq_a_token`（雪球）、`SESSDATA`（B 站）、`_csrf / csrfToken`（通用）。

**`document.cookie` 只能看到 non-HttpOnly 的 cookie。** 上面那条命令侦察阶段够用，真写 adapter 时 auth 经常是 HttpOnly，一定要用 `page.getCookies(...)` 从 CDP cookie jar 拿——见 `adapter-template.md` 的 "COOKIE adapter 骨架"。

论坛 / BBS 引擎（Discuz!X / phpBB / vBulletin）还多一坑：auth cookie 设在**根域** `.example.com`（不是 `www.example.com`），且 HttpOnly。要查 `{ domain: '.<root>' }` **和** `{ domain: 'www.<root>' }` 两次，否则 adapter 在有 cookie 的前提下仍然 401。

### localStorage / sessionStorage 里

```bash
opencli browser eval "Object.keys(localStorage).filter(k=>/token|auth|jwt|bearer|csrf/i.test(k))"
```

先只列 key 名，找 `token / auth / jwt / bearer / csrf`。只有选定 production auth source 后才在页面内使用对应值；不要把值打印进聊天、trace、shell history 或 site memory。

### Bundle 硬编码

有些站的 Bearer 是全站一个常量（Twitter 的匿名 Bearer）。在 bundle 里搜：

```bash
opencli browser eval "(async()=>{const s=[...document.querySelectorAll('script[src]')].map(e=>e.src).find(s=>/main|app|bundle/.test(s));const t=await fetch(s).then(r=>r.text());const m=[...t.matchAll(/Bearer\\s+[\\w-]{20,}/g)];return {count:m.length,positions:m.slice(0,3).map(x=>x.index)}})()"
```

只返回数量/位置，不返回 token 原值。即使 bundle 中是公共匿名 Bearer，也先确认它是否是预期公开合同；不要复制未知 credential-shaped string。

### 调用页面 runtime 让站点自己生成请求（只读、最后手段）

Vue + Pinia / Redux / React Context 有时能调用页面自己的只读 store method，让站点 runtime 自己生成签名和请求：

```bash
# Pinia
opencli browser eval "typeof __pinia !== 'undefined' ? Object.keys(__pinia.state.value) : 'no pinia'"

# 只调用已证明是 read-only 的 store action（每个站点具体 action 名要查）
opencli browser eval "window.__pinia.state.value.someStore.someMethod({...})"
```

这不是“绕签名”，也不是 direct API contract：它仍依赖页面 controller/runtime，production strategy 通常是 `INTERCEPT`。只有动作语义被可见 UI 和动态请求证明为 read-only 才能在侦察中调用。未知 effect 或 write action 禁止自动调用；写入只观察用户明确授权的一次自然操作，按 `deep-recon.md` 处理。

---

## §5 让页面自然发请求并截获 response（最后降级）

所有手段都试过还拿不到请求签名时，让页面自己自然发请求，adapter 用现有 Browser Bridge capture/interceptor 读取响应。优先 CDP network capture；只有已存在站点实现依赖 XHR interceptor 时才复用它，不要再写页面内 fetch/XHR monkey patch。

```javascript
// func 里：capture 必须先于触发动作安装，并先 drain stale entries
await page.startNetworkCapture('/api/foo');
await page.readNetworkCapture();
await page.goto('https://xxx.com/trigger-page');
// 等页面自己发请求，再读取所有相关完整 response
const entries = await page.readNetworkCapture();
```

capture queue 可能是破坏性 drain：过滤 relevant URL 后，只要看到 bodyless/truncated relevant entry 就拒绝 partial；多 response 要按业务 identity 合并，不能只取最后一个。分页、缓存和 no-partial 规则见 `deep-recon.md`。

代价是要等页面真的触发请求，慢且依赖内部合同。只在 §1-4 都不行时用。

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
