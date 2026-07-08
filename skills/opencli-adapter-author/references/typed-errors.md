# Typed Error Conventions

OpenCLI 用 5 类 typed error 让 agent 能从 exit code 直接分辨"参数错 / 没数据 / 接口挂 / 要登录 / 超时"。silent `return []` / silent `return [{sentinel}]` / scalar sentinel (`'-'`) / `Math.max/min` silent clamp / `CliError('HTTP_ERROR')` 这些"绿但错"的写法都被 audit gate 抓得越来越紧（[`scripts/check-typed-error-lint.mjs`](../../../scripts/check-typed-error-lint.mjs) 的 baseline JSON 只能减不能加，新违例必须立刻收掉）。

每条 rule 都挂了真实 anti-pattern 反例（PR #1329 三轮迭代是主要素材库）。

---

## 1. 5-classification 落点表

| 场景 | 抛 | code | exit |
|------|-----|------|------|
| 参数不合法（包括越界、格式错、缺主语 positional） | `ArgumentError(message)` | `ARGUMENT` | 2 |
| 业务无数据 / 资源不存在 | `EmptyResultError(command, hint?)` | `EMPTY_RESULT` | 66 |
| HTTP 非 2xx / fetch throw / JSON parse 错 / 接口业务报错 | `CommandExecutionError(message)` | `COMMAND_EXEC` | 1 |
| 需要登录（cookie 缺 / 401 / 302 → /login / "请登录" 页） | `AuthRequiredError(domain, message?)` | `AUTH_REQUIRED` | 77 |
| 等响应超时（CDP / page.evaluate / 流式回复） | `TimeoutError(label, seconds)` | `TIMEOUT` | 75 |

类签名定义见 [`src/errors.ts`](../../../src/errors.ts)。

**禁止泛用 `CliError('HTTP_ERROR' / 'NO_DATA' / 'USER_NOT_FOUND' / 'FETCH_ERROR' / 'INVALID_ARGUMENT' / 'API_ERROR' / 'THREAD_NOT_FOUND')`** —— 这些都对应到 5 类里其中一个，没有不能映射的场景（PR #1329 R3 commit `c40daf7` 把 7 处 `CliError(...)` 全部替换成了上面 5 类）。`CliError` 基类只用作子类的实现细节，adapter 代码不应直接 new。

---

## 2. Anti-pattern A：silent-clamp 不止 limit

**反例**（PR #1329 R3 codex-mini0 直接修，commit `c40daf7`；pre-fix lines: [`thread page/limit/contentLimit`](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/1point3acres/thread.js#L37-L39), [`notifications limit`](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/1point3acres/notifications.js#L41), [`qwen ask timeout`](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/qwen/ask.js#L42), [`qwen image timeout`](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/qwen/image.js#L119), [`qwen history API page_size`](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/qwen/utils.js#L311)）：

```js
// ❌ silent clamp — 200 当 100，0/-1 当 1，timeout=5 当 15
const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));
const timeout = Math.max(15, parseInt(kwargs.timeout, 10) || 120);
const contentLimit = Math.max(50, Number(args.contentLimit) || 400);
const page = Math.max(1, Number(args.page) || 1);
```

**修法**（[`clis/1point3acres/utils.js`](../../../clis/1point3acres/utils.js) 的 `normalizePositiveInteger` / `normalizeLimit`）：

```js
import { ArgumentError } from '@jackwener/opencli/errors';

/** Validate a positive integer arg without silently flooring/clamping. */
export function normalizePositiveInteger(value, defaultValue, label = 'value', { min = 1 } = {}) {
    const raw = value ?? defaultValue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new ArgumentError(`${label} must be a positive integer`);
    if (n < min) throw new ArgumentError(`${label} must be >= ${min}`);
    return n;
}

/** With both lower bound and an explicit ceiling. */
export function normalizeLimit(value, defaultValue, maxValue, label = 'limit') {
    const n = normalizePositiveInteger(value, defaultValue, label);
    if (n > maxValue) throw new ArgumentError(`${label} must be <= ${maxValue}`);
    return n;
}
```

**用法**（[`clis/1point3acres/thread.js#L37-L39`](../../../clis/1point3acres/thread.js)）：

```js
const page = normalizePositiveInteger(args.page, 1, 'page');
const limit = normalizePositiveInteger(args.limit, 10, 'limit');
const contentLimit = normalizePositiveInteger(args.contentLimit, 400, 'contentLimit', { min: 50 });
```

**注意**：当前 silent-clamp 检测的 regex（在 [`src/convention-audit.ts`](../../../src/convention-audit.ts) 的 `auditTypedErrorPatterns` 节，由 [`scripts/check-typed-error-lint.mjs`](../../../scripts/check-typed-error-lint.mjs) 调）只抓 `Math.min(...limit...)`。`Math.max(1, ...)` 单边 floor 和非-`limit` 命名（`page` / `timeout` / `contentLimit`）都不在 regex 里，所以 #1329 R3 时被 F-P-0 review 而不是 gate 挡下来 → 必须靠**人审 checklist** 兜：**任何外部参数（args.\* / kwargs.\*）做 Math.max / Math.min / `|| N` 当兜底都是 silent-clamp**。

### 何时抽 site-level helper

≥ 2 个同站 adapter 都要做同样的 limit / page 校验时，把 `normalizeLimit` / `normalizePositiveInteger` 抽到 `clis/<site>/utils.js`。1 个 adapter 用就直接 inline，别为 1 处单点抽 helper。

---

## 3. Anti-pattern B：sentinel row / scalar sentinel 吞 empty / unknown / failure

**反例 1**（PR #1329 R3 修掉的，[`clis/1point3acres/notifications.js` before](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/1point3acres/notifications.js#L35-L37)）：

```js
// ❌ "暂时没有提醒内容" 是 empty result，不是一行业务数据
if (/暂时没有提醒内容/.test(html)) {
    return [{ index: 0, from: '', summary: '暂时没有提醒内容', time: '', threadUrl: '' }];
}
```

**反例 2**（[`clis/1point3acres/search.js` before](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/1point3acres/search.js#L52-L60)）：

```js
// ❌ "抱歉" hint 是搜索无结果，不是 rank=0 的伪结果行
if (items.length === 0) {
    const hint = html.match(/<p>([^<]*?抱歉[^<]*?)<\/p>/);
    if (hint) {
        return [{ rank: 0, tid: '', title: hint[1].trim(), forum: '', author: '', replies: 0, views: 0, postTime: '', url: '' }];
    }
    return [];
}
```

**反例 3**（[`clis/qwen/history.js` before](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/qwen/history.js#L44-L51)）：

```js
// ❌ API failure 不是 conversation 的一行
if (!result.ok && !result.sessions.length) {
    return [{ Index: 0, Title: `API failed (status=${result.status})`, Updated: '', Url: '' }];
}
```

**反例 4**（[`clis/qwen/image.js` before](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/qwen/image.js#L160-L164)）：

```js
// ❌ 单张图片 fetch 失败，伪装成 "⚠️ fetch-failed" 状态行继续
if (!asset?.ok) {
    results.push({ Status: `⚠️ fetch-failed(${asset?.status || '?'})`, File: '-', Link: link });
    continue;
}
```

**修法**：

```js
import { EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

if (/暂时没有提醒内容/.test(html)) {
    throw new EmptyResultError('1point3acres notifications', '暂时没有提醒内容');
}
if (items.length === 0) {
    throw new EmptyResultError('1point3acres search', `No results for "${query}"`);
}
if (!result.ok && !result.sessions.length) {
    throw new CommandExecutionError(`Qianwen history API failed (status=${result.status})`);
}
if (!asset?.ok) {
    throw new CommandExecutionError(`Failed to fetch image: status=${asset?.status || '?'}`);
}
```

**反例 5：scalar sentinel**（PR #1329 R2 修掉的，[`clis/qwen/status.js` before](https://github.com/jackwener/OpenCLI/blob/42e5303c792d9f71d9a30dde2e391405e03661e7/clis/qwen/status.js#L24-L29)）：

```js
// ❌ '-' 会被下游当成真实 model/session id 字符串
return [{
    Status: 'Connected',
    Login: loggedIn ? 'Yes' : 'No (guest mode)',
    Model: model || '-',
    SessionId: sessionId || '-',
}];

// ✅ unknown 用 null，agent 可以 if (row.Model === null) 干净分支
return [{
    Status: 'Connected',
    Login: loggedIn ? 'Yes' : 'No (guest mode)',
    Model: model ? model : null,
    SessionId: sessionId ? sessionId : null,
}];
```

**根因**：success row 是"业务数据"的合同。把 empty / failure 塞进 row 会破坏：

1. **round-trip pipeline**：listing → detail 类下游 adapter 拿到 `tid: ''` 会去查 `thread `（""），白跑一轮
2. **exit code semantics**：empty 应该 exit 66、API fail 应该 exit 1，混进 row 后两者都 exit 0，agent 没法 branch
3. **fixture rowCount.min=1**：sentinel row 让 verify 永远过 → 真的接口挂了也看不见

**对比 #1290 twitter trending**：当时也踩过 silent N/A row 的坑，drop 掉那行比留个 silent-wrong 字段诚实——这是 2026-05-04 的早期教训。typed-errors 把"drop"升级成"throw EmptyResultError"，下游 agent 能直接从 exit code 66 分辨 empty vs 真实数据错位。

---

## 4. Anti-pattern C：`return []` 当 silent fallback

`adapter` 跑完什么都没拿到不能 `return []`：

```js
// ❌
if (items.length === 0) return [];

// ✅
if (items.length === 0) throw new EmptyResultError('site command', `optional context`);
```

`EmptyResultError` 的 hint 默认是 `'The page structure may have changed, or you may need to log in'`（见 [`src/errors.ts#L134`](../../../src/errors.ts)），自己传 message 比默认更有用：写**为什么空了**（"No results for '<query>'" / "uid=<X> 在该论坛没有发过帖子"）。

---

## 5. Anti-pattern D：generic `CliError('CODE')` 隐藏分类

**反例**（PR #1329 R3 修掉的，[`clis/coingecko/top.js` before](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/coingecko/top.js#L36-L38), [`clis/1point3acres/thread.js` before](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/1point3acres/thread.js#L45-L46), [`clis/1point3acres/user.js` before](https://github.com/jackwener/OpenCLI/blob/2b8609b82fccaf98505c5b1b1859e3ffdaa1a55c/clis/1point3acres/user.js#L35-L36)）：

```js
// ❌ 都是 exit 1，agent 无法区分服务失败 vs 空结果 vs bad args
if (!resp.ok) throw new CliError('HTTP_ERROR', `HTTP ${resp.status}`);
if (!Array.isArray(data) || data.length === 0) throw new CliError('NO_DATA', 'no data');
if (!/id="postlist"/.test(html)) throw new CliError('THREAD_NOT_FOUND', `帖子 ${tid} 不存在`);
```

**修法**：

```js
// HTTP / fetch / JSON / in-band API error → runtime failure
if (!resp.ok) throw new CommandExecutionError(`request failed: HTTP ${resp.status}`);
if (!Array.isArray(data)) throw new CommandExecutionError('unexpected response shape');

// valid empty / resource missing → empty result
if (data.length === 0) throw new EmptyResultError('coingecko top', 'no market data');
if (!/id="postlist"/.test(html)) throw new EmptyResultError('1point3acres thread', `帖子 ${tid} 不存在`);
```

`CliError` is still the base class underneath every typed error, and core runtime primitives may throw it internally. Adapter code should not directly `new CliError(...)`; pick one of the five classes in §1 so scripts and agents can branch on stable exit codes.

---

## 6. Verify fixture 怎么挡这三类

新写 fixture 时（`~/.opencli/sites/<site>/verify/<cmd>.json`）：

- **rowCount.min ≥ 1**：保证 sentinel-row 不能伪装通过
- **patterns**：核心 id 列加 `^\d+$` 类正则，挡 `tid: ''` / `pid: ''` 之类空字符串污染
- **mustBeTruthy**：业务数值列（`replies` / `views` / `count`）必须 truthy，挡 `|| 0` silent fallback
- **预期 EmptyResultError 是合法返回时**（例如某条 fixture 故意搜不出来）用 `expect.exitCode: 66` 让"空态合法"和"adapter 崩了"在 fixture 层就分开（参见 [`site-memory.md`](./site-memory.md) verify schema）

---

## 7. 已经 grandfathered 的旧 adapter

repo 里仍有相当数量的 `CliError('HTTP_ERROR')` / `Math.max(1, Math.min(...))` 式的旧写法，被 [`scripts/typed-error-lint-baseline.json`](../../../scripts/typed-error-lint-baseline.json) 圈住（baseline 只允许减、不允许加）。**新写 adapter 必须按本文档**；旧 adapter 不强制立刻迁移，但碰到时顺手收一条是欢迎的——清掉一条 baseline 自然下降一条，gate 不会卡。

---

## 8. 自查清单（PR push 前）

- [ ] adapter 没有 `Math.max(1, Math.min(...))` / `Math.max(N, ...)` clamp 在外部参数上
- [ ] adapter 没有 `return []` / `return [{...sentinel...}]` 当 empty / failure 兜底
- [ ] adapter 没有 `'-'` / `'N/A'` 这类 scalar sentinel 冒充 real value；语义可空就返回 `null`
- [ ] adapter 抛的不是 `CliError('XXX')`，而是 5 类 typed error 之一
- [ ] verify fixture 的 `rowCount.min ≥ 1`，sentinel row 过不了
- [ ] `npm run check:typed-error-lint` 跑过 → baseline 没增加
