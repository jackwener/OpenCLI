# Adapter Template

一份 adapter 就是一次 `cli({...})` 调用。文件结构固定，三段：declaration、args、func。

拿 `clis/eastmoney/convertible.js` 当活例子，对照拆解。

---

## 活例子：convertible.js

```javascript
// eastmoney convertible — on-market convertible bond listing.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const SORTS = {
  change:   { fid: 'f3',   order: 'desc' },
  drop:     { fid: 'f3',   order: 'asc' },
  turnover: { fid: 'f6',   order: 'desc' },
  price:    { fid: 'f2',   order: 'desc' },
  premium:  { fid: 'f237', order: 'desc' },
  value:    { fid: 'f236', order: 'desc' },
  ytm:      { fid: 'f239', order: 'desc' },
};

cli({
  site: 'eastmoney',
  name: 'convertible',
  description: '可转债行情列表（默认按成交额排序）',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'sort',  type: 'string', default: 'turnover', help: '排序：turnover / change / drop / price / premium' },
    { name: 'limit', type: 'int',    default: 20,         help: '返回数量 (max 100)' },
  ],
  columns: ['rank', 'bondCode', 'bondName', 'bondPrice', 'bondChangePct',
            'stockCode', 'stockName', 'stockPrice', 'stockChangePct',
            'convPrice', 'convValue', 'convPremiumPct', 'remainingYears', 'ytm', 'listDate'],
  func: async (args) => {
    const sortKey = String(args.sort ?? 'turnover').toLowerCase();
    const sort = SORTS[sortKey];
    if (!sort) throw new CliError('INVALID_ARGUMENT', `Unknown sort "${sortKey}". Valid: ${Object.keys(SORTS).join(', ')}`);
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));

    const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
    url.searchParams.set('pn', '1');
    url.searchParams.set('pz', String(limit));
    url.searchParams.set('po', sort.order === 'desc' ? '1' : '0');
    url.searchParams.set('np', '1');
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    url.searchParams.set('fid', sort.fid);
    url.searchParams.set('fs', 'b:MK0354');
    url.searchParams.set('fields', 'f12,f14,f2,f3,f6,f229,f230,f232,f234,f235,f236,f237,f238,f239,f243');
    url.searchParams.set('ut', 'bd1d9ddb04089700cf9c27f6f7426281');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `convertible failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no convertible data');

    return diff.slice(0, limit).map((it, i) => ({
      rank: i + 1,
      bondCode: it.f12,
      bondName: it.f14,
      bondPrice: it.f2,
      bondChangePct: it.f3,
      stockCode: it.f232,
      stockName: it.f234,
      stockPrice: it.f229,
      stockChangePct: it.f230,
      convPrice: it.f235,
      convValue: it.f236,
      convPremiumPct: it.f237,
      remainingYears: it.f238,
      ytm: it.f239,
      listDate: String(it.f243 ?? ''),
    }));
  },
});
```

---

## 三段解剖

### 1. Declaration — 标头

```javascript
cli({
  site: 'eastmoney',          // 第一级命名空间，目录名一致
  name: 'convertible',        // 第二级，CLI 上的子命令
  description: '...',         // 一句话，出现在 `opencli list` 和 `opencli <site> -h`
  domain: 'push2.eastmoney.com',  // 主要请求域名（诊断面板用）
  strategy: Strategy.PUBLIC,  // PUBLIC / COOKIE / HEADER / INTERCEPT / UI
  browser: false,             // PUBLIC 几乎总是 false；COOKIE/HEADER 一律 true
  ...
});
```

### 2. Args & Columns

```javascript
args: [
  { name: 'sort',  type: 'string', default: 'turnover', help: '...' },
  { name: 'limit', type: 'int',    default: 20,         help: '...' },
],
columns: ['rank', 'bondCode', 'bondName', /* ... */ ],
```

**规则**：

- `type`: `string` / `int` / `float` / `bool`
- `default` 必填（缺失的命令会拒绝启动）
- `columns` 数组必须跟 `func` 返回的 object keys 完全对上，顺序也一致（决定表格列顺序）
- 列名 camelCase，跟 `cli({...})` 其他 adapter 保持统一

### 3. func — 主体

```javascript
func: async (args) => {
  // 1. 解析参数
  const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));

  // 2. 构造 URL / 请求
  const url = new URL(...);
  url.searchParams.set(...);

  // 3. 发请求
  const resp = await fetch(url, { headers: {...} });
  if (!resp.ok) throw new CliError('HTTP_ERROR', `... HTTP ${resp.status}`);

  // 4. 解析 + 业务校验
  const data = await resp.json();
  const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
  if (diff.length === 0) throw new CliError('NO_DATA', '...');

  // 5. map 到 columns 同名 keys
  return diff.slice(0, limit).map((it, i) => ({
    rank: i + 1,
    bondCode: it.f12,
    // ...
  }));
},
```

**参数形态**：

- `browser: false`：`func: async (args, debug?) => { ... }`，不会收到 `page`
- `browser: true`：`func: async (page, args, debug?) => { ... }`，`page` 是浏览器上下文
- `args`：所有 `args[]` 声明的参数解析后的 object

**错误处理**：

| 场景 | 写法 |
|------|------|
| 参数不合法 | `throw new CliError('INVALID_ARGUMENT', '...')` |
| HTTP 非 2xx | `throw new CliError('HTTP_ERROR', 'HTTP <status>')` |
| 业务返回空 | `throw new CliError('NO_DATA', '...')` 或 `'EMPTY_RESULT'` |
| 需要登录 | `throw new AuthRequiredError(domain)`（从 `@jackwener/opencli/errors` 引） |
| 接口约束失败 | `throw new CliError('API_ERROR', '...')` |

不要 `return []` 了事。autofix skill 靠 CliError 的 code 决定要不要重试。

---

## COOKIE adapter 骨架（需要登录态）

PUBLIC 模式不够（接口 401 / 302 到 login / 响应是"请登录"页）就走这里。要点三条：

1. 读 cookie 走 `page.getCookies(...)`，**不要读 `document.cookie`**。
2. 拿 HTML 走 Node 端 `fetch` + 手动解码，**不要塞进 `page.evaluate` 里**。
3. Declaration 加 `browser: true`；不需要真的打开目标页时 `navigateBefore: false`。

```javascript
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

const BASE = 'https://www.example.com';
const HOST = 'www.example.com';
const ROOT = '.example.com';  // 根域（auth 常在这里）

async function readCookie(page) {
    const seen = new Map();
    for (const opts of [{ domain: HOST }, { domain: ROOT }]) {
        try {
            const cookies = await page.getCookies(opts);
            for (const c of cookies || []) {
                if (!seen.has(c.name)) seen.set(c.name, c.value);
            }
        } catch { /* try next domain */ }
    }
    return [...seen].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchHtml(url, { cookie, encoding = 'utf-8', headers = {} } = {}) {
    const resp = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            Referer: `${BASE}/`,
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
        },
        redirect: 'follow',
    });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    return new TextDecoder(encoding).decode(buf);
}

cli({
    site: 'example',
    name: 'me',
    description: '示例：需要登录的私有页面',
    domain: HOST,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,    // 本命令不需要先开目标页
    args: [{ name: 'limit', type: 'int', default: 20, help: '返回条数' }],
    columns: ['index', 'title', 'time'],
    func: async (page, args) => {
        const cookie = await readCookie(page);
        const html = await fetchHtml(`${BASE}/inbox`, { cookie, encoding: 'gbk' });

        if (/请登录|需要登录|<title>Login/i.test(html)) {
            throw new AuthRequiredError(HOST);
        }

        // parse html → rows
        return rows.slice(0, Math.max(1, Number(args.limit) || 20));
    },
});
```

### JSON API 用 `page.fetchJson()`，不要手写 `page.evaluate(fetch(...))`

如果接口必须在浏览器上下文里请求（依赖当前页面 cookie / CORS / origin），用内置 primitive：

```javascript
const data = await page.fetchJson(`${BASE}/api/list`, {
  method: 'POST',
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
  body: { page: 1, size: Number(args.limit) || 20 },
});
```

它固定 `credentials: 'include'`，带 timeout，HTTP 非 2xx / 非 JSON 会抛统一 `CliError`。

### HTML 不走 browser fetch

三个坑，踩一个就重写：

- **HttpOnly cookie 看不见**：绝大多数登录站点把 auth cookie 标 `HttpOnly`，`document.cookie` 永远读不到它，只能通过 CDP 的 cookie jar 拿（`page.getCookies`）。塞到 `page.evaluate` 里就等于回到 `document.cookie` 那条路，必挂。
- **`navigateBefore: false` 时当前 tab 不在目标站**：页面 origin 可能是 `about:blank` 或上一条命令留下的别处，从那儿发 fetch 到目标域就是 cross-origin，浏览器 CORS 一挡就是 "Failed to fetch"。
- **非 UTF-8 编码解码麻烦**：GBK / Big5 / Shift-JIS 的站（Discuz / phpBB 老版 / 日站）在 `page.evaluate` 里用 `response.text()` 拿到的是乱码，`TextDecoder('gbk').decode(buf)` 的写法只在 Node 侧干净。

**规则**：JSON 型浏览器接口用 `page.fetchJson()`；HTML 型 COOKIE adapter 一律 Node 侧 `fetch`，浏览器只当 cookie jar 用。

### Cookie 域的双查

```javascript
for (const opts of [{ domain: HOST }, { domain: ROOT }]) { ... }
```

不是所有站都这么玄学，但下面这几类踩坑最多：

| 站点类型 | 坑 |
|---------|----|
| Discuz!X / phpBB / vBulletin 论坛 | Auth cookie 设在 `.<root>.com`，HttpOnly；业务页在 `www.<root>.com`。只查 `www.` 会漏 |
| 多子域账户体系（`account.x.com` vs `api.x.com`） | 登录时写在 account 域，API 域读取时拿不到 |
| 新版 Chrome SameSite=Lax 默认 | 某些 cookie 查 `url:` 才给返，查 `domain:` 不给 |

双查成本很低，不确定就两个都查，用 Map 去重第一次出现的 name。

### 明确的空态要返回哨兵行，不要 `[]`

空态（"暂时没有提醒内容" / "暂无通知" / "No results"）返回 `[]`，下游 agent 会当成"接口挂了"而重试。正确做法是返回**一行明确写着当前状态的数据**：

```javascript
if (/暂时没有提醒内容/.test(html)) {
    return [{ index: 0, from: '', summary: '暂时没有提醒内容', time: '', threadUrl: '' }];
}
```

---

## 同类型 adapter 对照

| 类型 | 代表 | 参考 |
|------|------|-----|
| clist 分页排行 | `convertible.js` / `rank.js` / `etf.js` / `sectors.js` | 都共享 `fs` + `fid` + `po` 结构 |
| ulist 批量报价 | `quote.js` | `secids` 逗号拼接 |
| K 线历史 | `kline.js` | `fields1 / fields2` 控列，CSV 解析 |
| 报表（datacenter-web） | `longhu.js` / `holders.js` | `reportName` 驱动 |
| 7x24 新闻 | `kuaixun.js` | `np-listapi` 栏目 id |
| 公司公告 | `announcement.js` | `np-anotice-stock` |
| 指数/北上 | `index-board.js` / `northbound.js` | push2 专用端点 |

新写一条时，选最像的那类，复制后改 `name` / URL / fields / column 映射三处。

---

## Verify fixture（每个 adapter 配一份 `~/.opencli/sites/<site>/verify/<name>.json`）

verify fixture 是"adapter 产出长什么样"的结构锚点。没有它，`opencli browser verify` 只能证"adapter 能跑完不抛"，证不出数据没错位。**必写**。

详细 schema 见 `site-memory.md` 的 `verify/<cmd>.json` 节。这里只讲两个容易踩的地方：

### args 形态：object vs array

`args` 字段决定 verify 怎么调你的 adapter：

- **对象形态** `{ "limit": 3 }` → 展开成 `--limit 3`，标准 named-flag adapter 用这个
- **数组形态** `["123", "--limit", "3"]` → 原样 append 到命令后，**positional 主语型** adapter 必须用这个

repo 约定"主语优先 positional"——thread 详情型、url 解析型、关键词搜索型都用 positional：

```js
// clis/1point3acres/thread.js — 接收 <tid> 作为主语
cli({
  site: '1point3acres',
  name: 'thread',
  args: [
    { name: 'tid',   type: 'string', required: true, positional: true },
    { name: 'limit', type: 'int',    default: 20 },
  ],
  // ...
});
```

对应 fixture：

```json
{
  "args": ["1234567", "--limit", "3"],
  "expect": { "rowCount": { "min": 1, "max": 3 }, "...": "..." }
}
```

**不要写成** `{ "tid": "1234567", "limit": 3 }`——这会被展开成 `--tid 1234567 --limit 3`，commander 把 `--tid` 当未知 flag 报错，或者 adapter 根本不认。

### 种子 → 手改

named-flag adapter（`hot` / `latest` 类）可以直接让工具生成种子：

```bash
# 1. 让 verify 先跑一遍，--write-fixture 生成种子（默认追加 --limit 3）
opencli browser verify 1point3acres/hot --write-fixture

# 2. 手改 ~/.opencli/sites/1point3acres/verify/hot.json
#    - patterns: 加 URL / 日期 / ID 正则
#    - notEmpty: 加核心字段（title / author / url）
#    - rowCount: 收紧到业务合理区间

# 3. 再跑 verify，fixture 吃得动就 OK
opencli browser verify 1point3acres/hot
```

positional adapter 目前 `--write-fixture` 没法表达主语，**首份 fixture 要手写**：

```bash
# 1. 先直跑 adapter 看输出长啥样
opencli 1point3acres thread 1173710 --limit 2 --format json | head

# 2. 照着响应手写 ~/.opencli/sites/1point3acres/verify/thread.json
#    （args 一定用数组: ["1173710", "--limit", "2"]）

# 3. 跑 verify 核对
opencli browser verify 1point3acres/thread
```

机器生成的种子只有 rowCount.min=1 / columns / types，挡不住字段值错位。**patterns + notEmpty 无论哪种情形都是肉写的**。

---

## 私人 adapter vs repo 贡献

```
~/.opencli/clis/<site>/<name>.js    # 私人
clis/<site>/<name>.js               # repo 贡献
```

**两者在 `cli({...})` 层面完全一样**。差别只在运行入口：

- 私人：写完立即可跑（`opencli <site> <name>`）
- repo：要 `npm run build` 才被注册

先在 `~/.opencli/clis/` 调通再拷贝到 `clis/`。
