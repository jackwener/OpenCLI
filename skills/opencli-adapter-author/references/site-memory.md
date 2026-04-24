# Site Memory

站点记忆分两层：**in-repo 种子**（skill 自带的已知站点公共知识）+ **本地工作目录**（每台机器跑过的站点累积产物）。

---

## 两层结构

```
skills/opencli-adapter-author/references/site-memory/<site>.md
    — 公共种子。手写 + PR 审核进入。多 agent 共享的第一批起点。
    — 已铺：eastmoney / xueqiu / bilibili / tonghuashun

~/.opencli/sites/<site>/
    — 本地累积。agent 跑 adapter 过程里自动写入，跨 session 复用。
    — 不进 git，不进 PR。
```

用法：开头先读本地，命中 **不跳写 adapter**，仍要跑 Step 5 endpoint 验证 + Step 7 字段抽查（memory 可能过期或站点换版）；没命中读 in-repo；都没有走完整 recon。

---

## Layer 1 — In-repo 种子（`references/site-memory/<site>.md`）

每个覆盖站点一个 `.md`，结构固定：

```markdown
# <site>

## 域名
主 API / 备 API / 登录 / 静态资源

## 默认鉴权
`Strategy.XXX` + 必需 cookie/header + 获取方式

## 已知 endpoint（选最常用的 5-10 条）
- `GET <url>` — 返回 X，分页参数 Y
- ...

## 字段（指向 `field-conventions.md` 的某一节）

## 坑 / 陷阱
- fltt=2 必传
- 单位是"万"不是"元"
- ...

## 可参考的 adapter
`clis/<site>/<name>.js` × N
```

审核门槛高，里面写的东西必须是"多数人都会踩到"的共识。一次性试错、站点局部怪癖放 Layer 2。

---

## Layer 2 — 本地工作目录（`~/.opencli/sites/<site>/`）

agent 每跑一次相关 adapter 就可以自动写/读：

```
~/.opencli/sites/<site>/
  notes.md               — 累积笔记（时间戳 + 写入人 + 发现）
  endpoints.json         — 已验证的 endpoint 目录
  field-map.json         — 字段代号 → 含义（key 为字段代号，value 为 {meaning, verified_at, source}）
  verify/                — `opencli browser verify` 期望值（值级校验锚点，每个 adapter 一份）
    <cmd>.json
  fixtures/              — 完整响应样本（给字段对比 / 离线 replay；**调试时的原始 dump 也只能落在这里或 /tmp/**）
    <cmd>-<ts>.json
  last-probe.log         — 最近一次侦察输出（下次接着用）
```

`verify/` vs `fixtures/` 别混：
- `verify/<cmd>.json` 是**结构期望**（rowCount / columns / types / patterns / notEmpty），每 adapter 一份、会被 verify 读。
- `fixtures/<cmd>-<ts>.json` 是**原始响应样本**，给人 / 下一个 agent 做字段比对用，verify 不会读。

### `endpoints.json` 格式（schema 锁死）

key = endpoint 的短名（`clist` / `kline` / `search` 等），不要用全 URL 当 key。

```json
{
  "clist": {
    "url": "https://push2.eastmoney.com/api/qt/clist/get",
    "method": "GET",
    "params": {
      "required": ["fs", "fields"],
      "optional": ["pn", "pz", "fid", "po", "fltt"]
    },
    "response": "data.diff[] 数组",
    "verified_at": "2026-04-20",
    "notes": "fltt=2 必传"
  }
}
```

字段说明：

- `url` / `method`：原样存，query string 不入 `url`，都归 `params`
- `params.required` / `params.optional`：参数名列表。**不存具体值**（值会变，记例子放 `notes`）
- `response`：一句话写清响应形状入口（`data.diff[] 数组` / `result.data.items` / `纯数组`），而不是把整个响应贴进来
- `verified_at`：`YYYY-MM-DD`。超过 30 天下次读到当作过期重验
- `notes`：一两句关键坑（`fltt=2 必传` / `ms 单位 begin` 之类），不要写长文

### `field-map.json` 格式（schema 锁死）

key = 字段代号（`f237` / `f152`），value 三件套：

```json
{
  "f237": {
    "meaning": "convertible premium rate (%)",
    "verified_at": "2026-04-20",
    "source": "field-decode-playbook sort-key comparison vs page"
  }
}
```

- `meaning`：人话 + 单位/精度（`%` / `元` / `万元` / `× 10^f152` 等）
- `verified_at`：`YYYY-MM-DD`
- `source`：怎么推出来的，让下次能复查（`field-decode-playbook sort-key` / `网页标签对照` / `bundle 搜索 var pricePct =`）
- **已存在的 key 不要默默覆盖**。有冲突时先用 `fixtures/` 里的真实样本 + 网页肉眼值再确认一遍

### `verify/<cmd>.json` 格式（schema 锁死）

每个 adapter 一份，`opencli browser verify <site>/<cmd>` 会自动读。**没有这份 = verify 只能证"能跑"，证不出数据对**——所以是必填产物。

```json
{
  "args": { "limit": 3 },
  "expect": {
    "rowCount": { "min": 1, "max": 3 },
    "columns": ["rank", "tid", "title", "url"],
    "types": {
      "rank": "number",
      "tid": "string|number",
      "title": "string",
      "url": "string"
    },
    "patterns": {
      "url": "^https://www\\.1point3acres\\.com/bbs/thread-"
    },
    "notEmpty": ["title", "url"]
  }
}
```

字段说明：

- `args`：verify 调 adapter 时要带的参数。支持两种形态：
  - **对象**：`{ "limit": 3 }` → 展开成 `--limit 3`，用于标准 named flag 适配器
  - **数组**：`["123", "--limit", "3"]` → **原样**追加到命令后，用于 positional 主语型适配器（`<tid>` / `<url>` / `<query>`）。repo 约定"主语优先 positional"，所以这类适配器只能用数组形态
- `expect.rowCount.{min,max}`：包含边界。稳定列表接口收紧到 `[min, max]`，动态接口给一个宽区间
- `expect.columns`：每行必须都有这些 key（严格要求——漏了就 fail）
- `expect.types`：支持 `|` union（`string|null`）和 `any` 通配。写多少列类型看列的稳定性；波动大的列直接 `any` 比频繁改 fixture 好
- `expect.patterns`：正则表达式 **字符串**（注意 `\\` 转义）。`null` / `undefined` 会被跳过，不要用正则校验可空字段
- `expect.notEmpty`：trim 后不能为空的列。这是"adapter 没吃掉核心业务字段"的最后一道保险
- `expect.mustNotContain`：`Record<col, string[]>`。列值里不允许出现这些子串。用来挡"字段内容污染"——比如 `description` 里混进了 `address:` / `category:` 的邻居节点文字、`title` 前面粘了面包屑前缀。`notEmpty` 挡不住这种软污染
- `expect.mustBeTruthy`：列数组。列值必须是 JS truthy。用来挡"silent `|| 0` / `|| false` 兜底"——数值列返回 0 / 空字符串 / false 都会被 `notEmpty` 放过，但业务上通常是"没抓到"

### 什么时候手写 vs `--write-fixture` 自动生成

- `--write-fixture` 只是种子：生成 `rowCount.min=1` / `columns` / `types`，**没有** `patterns` / `notEmpty` / `mustNotContain` / `mustBeTruthy`——纯类型 fixture 挡不住数值错位 / 字段污染 / silent fallback。
- 拿到种子后**必须手改**，四件套一起上：
  - `patterns`：URL / 日期 / ID 等格式列
  - `notEmpty`：核心业务字段
  - `mustNotContain`：描述类文本列容易被兄弟节点污染时，把禁词（`address:` / `category:` 等）列出来
  - `mustBeTruthy`：数值 / 布尔业务列，挡 `|| 0` / `|| false`
- adapter 是 positional 主语型（`<tid>` / `<url>` / `<query>`）时，`--write-fixture` 的 `args` 要手写成数组形态。工具不会替你决定形态。
- 站点换版导致 fixture 过时：`--update-fixture` 覆盖。改之前**先用肉眼核对一次网页值**，别闭着眼把错的响应固化下来。
- **规避反模式：不要为了让 verify 通过去放松 pattern**。失败的 pattern 说明 adapter 输出有问题，要收紧 adapter，不是收紧 fixture。放松 fixture 等于默认把错数据接受下来。

### `notes.md` 格式

```markdown
## 2026-04-20 by opencli-user
写 `convertible.js` 时遇到：
- f237 推断是溢价率（排序对比法，页面对照）
- `fltt=2` 不加的话价格是整数 × 10^f152
- `fs=b:MK0354` 过滤可转债
```

顶部追加新段落，老的不删。每段有日期 + 写入人。

### `fixtures/<cmd>-<YYYYMMDDHHMM>.json` 格式

一份该 endpoint 的**完整**响应样本。用途：

- 未来字段代号再变时，拿样本和 `field-map.json` 做 regression 对比
- 站点换版时，新响应和旧 fixture 做 diff 看哪个字段结构变了

**存之前脱敏**：去掉 cookie / token / 登录态相关 header、去掉用户自己的 uid / 用户名 / 手机号 / 邮箱。

---

## runbook 里的读/写时机

```
Step 2 开始前 → 读  ~/.opencli/sites/<site>/
                → 读  references/site-memory/<site>.md
                命中后 → 不跳写 adapter，仍要跑 Step 5 (endpoint 验证) + Step 7 (字段抽查)
                        verified_at 超 30 天 → 当作过期，按冷启动走 Step 3 → 4

Step 10 verify 首轮通过后 → 写 ~/.opencli/sites/<site>/verify/<cmd>.json
                            - 先 `--write-fixture` 拿种子，再手改 patterns / notEmpty / rowCount
                            - 没这份后续 verify 挡不住数据错位，**必填**

Step 11 肉眼对比通过后 → 写 ~/.opencli/sites/<site>/
                        - endpoints.json：按 schema 追加或更新 verified_at
                        - field-map.json：只追加新 key，已有的不默默覆盖
                        - notes.md：顶部追加一段
                        - fixtures/：脱敏后存一份完整响应样本（区别于 verify/）
```

**回写是 commit，不是 stash**：不过 Step 10 verify + Step 11 肉眼对比不写，防止把错的映射喂给下一轮。

---

## 不要写进 `~/.opencli/sites/` 的东西

- 真实账户 cookie / token — 不要保存任何鉴权凭据
- 用户私有数据（返回体里有个人敏感字段的 → 脱敏再存 fixtures）
- 过期超过 30 天的 last-probe.log（自动清）

## 不要写进 **repo / adapter 目录** 的东西

调试过程里的临时 dump（`.dbg-*.html` / `raw-*.json` / `sample-*` / `trace-*.txt`）**只能**落在 `~/.opencli/sites/<site>/fixtures/` 或系统 `/tmp/`。PR diff 会把 repo 根目录和 `clis/<site>/` 下的文件一起带走——别人 review 时看到一堆调试副产物会很烦。

---

## 没有 site-memory 时

新站点没对应 `.md`，也没本地目录 → 完整走 recon + discovery，跑完直接写 `~/.opencli/sites/<site>/`，后面就有了。
