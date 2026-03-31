# Testing Guide

> 面向开发者和 AI Agent 的测试参考手册。

## 目录

- [测试架构](#测试架构)
- [当前覆盖范围](#当前覆盖范围)
- [本地运行测试](#本地运行测试)
- [如何添加新测试](#如何添加新测试)
- [CI/CD 流水线](#cicd-流水线)
- [浏览器模式](#浏览器模式)
- [站点兼容性](#站点兼容性)

---

## 测试架构

测试分为三层，全部使用 **vitest** 运行：

```text
tests/
├── e2e/                           # E2E 集成测试（子进程运行真实 CLI）
│   ├── helpers.ts                 # runCli() / parseJsonOutput() 共享工具
│   ├── public-commands.test.ts    # 公开 API 命令
│   ├── browser-public.test.ts     # 浏览器命令（公开数据）
│   ├── browser-auth.test.ts       # 需登录命令（graceful failure）
│   ├── management.test.ts         # 管理命令（list / validate / verify / help）
│   └── output-formats.test.ts     # 输出格式校验
├── smoke/
│   └── api-health.test.ts         # 外部 API、adapter 定义、命令注册健康检查
src/
├── **/*.test.ts                   # 核心单元测试（默认 `unit` project）
└── clis/{zhihu,twitter,reddit,bilibili}/**/*.test.ts  # 聚焦 adapter tests
```

| 层 | 位置 | 当前文件数 | 运行方式 | 用途 |
|---|---|---:|---|---|
| 单元测试 | `src/**/*.test.ts`（排除 `src/clis/**`） | - | `npm test` | 内部模块、pipeline、runtime |
| Adapter 测试 | `src/clis/{zhihu,twitter,reddit,bilibili}/**/*.test.ts` | - | `npm run test:adapter` | 保留 4 个重点站点的 adapter 覆盖 |
| E2E 测试 | `tests/e2e/*.test.ts` | 5 | `npx vitest run tests/e2e/` | 真实 CLI 命令执行 |
| 烟雾测试 | `tests/smoke/*.test.ts` | 1 | `npx vitest run tests/smoke/` | 外部 API 与注册完整性 |

---

## 当前覆盖范围

### 单元测试与 Adapter 测试

| 领域 | 文件 |
|---|---|
| 核心运行时与输出 | `src/browser.test.ts`, `src/browser/dom-snapshot.test.ts`, `src/build-manifest.test.ts`, `src/capabilityRouting.test.ts`, `src/doctor.test.ts`, `src/engine.test.ts`, `src/interceptor.test.ts`, `src/output.test.ts`, `src/plugin.test.ts`, `src/registry.test.ts`, `src/snapshotFormatter.test.ts` |
| pipeline 与下载 | `src/download/index.test.ts`, `src/pipeline/executor.test.ts`, `src/pipeline/template.test.ts`, `src/pipeline/transform.test.ts` |
| 聚焦 adapter 逻辑 | `src/clis/zhihu/download.test.ts`, `src/clis/twitter/timeline.test.ts`, `src/clis/reddit/read.test.ts`, `src/clis/bilibili/dynamic.test.ts` |

这些测试覆盖的重点包括：

- Browser Bridge、DOM snapshot、interceptor、capability routing
- manifest 生成、命令发现、插件安装与注册表
- 输出格式渲染与 snapshot formatting
- pipeline 模板求值、执行器与变换步骤
- 各站点 adapter 的数据归一化、参数处理与容错逻辑

### E2E 测试（5 个文件）

| 文件 | 当前覆盖范围 |
|---|---|
| `tests/e2e/public-commands.test.ts` | `bloomberg`、`apple-podcasts`、`hackernews`、`v2ex`、`xiaoyuzhou`、`google suggest` 等公开命令 |
| `tests/e2e/browser-public.test.ts` | `bbc`、`bloomberg`、`bilibili`、`weibo`、`zhihu`、`reddit`、`twitter`、`xueqiu`、`reuters`、`youtube`、`smzdm`、`boss`、`ctrip`、`coupang`、`xiaohongshu`、`google`、`yahoo-finance`、`v2ex daily` |
| `tests/e2e/browser-auth.test.ts` | `bilibili`、`twitter`、`v2ex`、`xueqiu`、`linux-do`、`xiaohongshu` 的需登录命令 graceful failure |
| `tests/e2e/management.test.ts` | `list`、`validate`、`verify`、`--version`、`--help`、unknown command |
| `tests/e2e/output-formats.test.ts` | `json` / `yaml` / `csv` / `md` 输出格式校验 |

### 烟雾测试（1 个文件）

| 文件 | 当前覆盖范围 |
|---|---|
| `tests/smoke/api-health.test.ts` | `hackernews`、`v2ex` 公开 API 可用性，`validate` 全量 adapter 校验，以及命令注册表基础完整性 |

### 快速核对命令

需要刷新测试清单时，直接以仓库文件为准：

```bash
find src -name '*.test.ts' | sort
find tests/e2e -name '*.test.ts' | sort
find tests/smoke -name '*.test.ts' | sort
```

---

## 本地运行测试

### 前置条件

```bash
npm ci                # 安装依赖
npm run build         # 编译（E2E / smoke 测试需要 dist/main.js）
```

### 运行命令

```bash
# 默认核心单元测试（不含大多数 adapter tests）
npm test

# 聚焦 adapter tests（只保留 4 个重点站点）
npm run test:adapter

# 全部 E2E 测试（会真实调用外部 API / 浏览器）
npx vitest run tests/e2e/

# 全部 smoke 测试
npx vitest run tests/smoke/

# 单个测试文件
npx vitest run src/clis/apple-podcasts/commands.test.ts
npx vitest run tests/e2e/management.test.ts

# 全部测试
npx vitest run

# watch 模式（开发时推荐）
npx vitest src/
```

### 浏览器命令本地测试须知

- opencli 通过 Browser Bridge 扩展连接已运行的 Chrome 浏览器
- E2E 测试通过 `tests/e2e/helpers.ts` 里的 `runCli()` 调用已构建的 `dist/main.js`
- `browser-public.test.ts` 使用 `tryBrowserCommand()`，站点反爬或地域限制导致空数据时会 warn + pass
- `browser-auth.test.ts` 验证 **graceful failure**，重点是不 crash、不 hang、错误信息可控
- 如需测试完整登录态，保持 Chrome 登录态并安装 Browser Bridge 扩展，再手动运行对应测试
- 对依赖具体 host 页面上下文的 browser adapter，除了单测外，还应手动验证真实命令，并把必要的 target host 约束写进 adapter docs / troubleshooting
- 对会主动导航页面的 browser commands，手动验证时优先串行执行；多个 CLI 进程同时连到同一个 CDP target 可能互相覆盖导航，制造假的 adapter 故障

---

## 如何添加新测试

### 新增 YAML Adapter（如 `src/clis/producthunt/trending.yaml`）

1. `opencli validate` 的 E2E / smoke 测试会覆盖 adapter 结构校验
2. 根据 adapter 类型，在对应测试文件补一个 `it()` block

```typescript
// 如果 browser: false（公开 API）→ tests/e2e/public-commands.test.ts
it('producthunt trending returns data', async () => {
  const { stdout, code } = await runCli(['producthunt', 'trending', '--limit', '3', '-f', 'json']);
  expect(code).toBe(0);
  const data = parseJsonOutput(stdout);
  expect(Array.isArray(data)).toBe(true);
  expect(data.length).toBeGreaterThanOrEqual(1);
  expect(data[0]).toHaveProperty('title');
}, 30_000);
```

```typescript
// 如果 browser: true 但可公开访问 → tests/e2e/browser-public.test.ts
it('producthunt trending returns data', async () => {
  const data = await tryBrowserCommand(['producthunt', 'trending', '--limit', '3', '-f', 'json']);
  expectDataOrSkip(data, 'producthunt trending');
}, 60_000);
```

```typescript
// 如果 browser: true 且需登录 → tests/e2e/browser-auth.test.ts
it('producthunt me fails gracefully without login', async () => {
  await expectGracefulAuthFailure(['producthunt', 'me', '-f', 'json'], 'producthunt me');
}, 60_000);
```

### 新增管理命令（如 `opencli export`）

在 `tests/e2e/management.test.ts` 添加测试；如果新命令会影响输出格式，也同步补 `tests/e2e/output-formats.test.ts`。

### 新增内部模块

在对应源码旁创建 `*.test.ts`，优先和被测模块放在同一目录下，便于发现与维护。

### 决策流程图

```text
新增功能 → 是内部模块？ → 是 → src/ 下加 *.test.ts
                ↓ 否
         是 CLI 命令？ → browser: false? → tests/e2e/public-commands.test.ts
                              ↓ true
                        公开数据？ → tests/e2e/browser-public.test.ts
                              ↓ 需登录
                        tests/e2e/browser-auth.test.ts
```

---

## CI/CD 流水线

### `ci.yml`

| Job | 触发条件 | 内容 |
|---|---|---|
| `build` | push/PR 到 `main`,`dev` | `tsc --noEmit` + `npm run build` |
| `unit-test` | push/PR 到 `main`,`dev` | Node `20` 与 `22` 双版本运行核心 `unit` tests，按 `2` shard 并行 |
| `adapter-test` | push/PR 到 `main`,`dev` | Node `22` 运行聚焦的 `zhihu/twitter/reddit/bilibili` adapter tests |
| `smoke-test` | `schedule` 或 `workflow_dispatch` | 安装真实 Chrome，`xvfb-run` 执行 `tests/smoke/` |

### `e2e-headed.yml`

| Job | 触发条件 | 内容 |
|---|---|---|
| `e2e-headed` | push/PR 到 `main`,`dev`，或手动触发 | 安装真实 Chrome，`xvfb-run` 执行 `tests/e2e/` |

E2E 与 smoke 都使用 `./.github/actions/setup-chrome` 准备真实 Chrome，并通过 `OPENCLI_BROWSER_EXECUTABLE_PATH` 注入浏览器路径。

### Sharding

单元测试使用 vitest 内置 shard，并在 Node `20` / `22` 两个版本上运行：

::: v-pre
```yaml
strategy:
  matrix:
    node-version: ['20', '22']
    shard: [1, 2]
steps:
  - run: npm test -- --reporter=verbose --shard=${{ matrix.shard }}/2
```
:::

---

## 浏览器模式

opencli 通过 Browser Bridge 扩展连接浏览器：

| 条件 | 模式 | 使用场景 |
|---|---|---|
| 扩展已安装 / 已连接 | Extension 模式 | 本地用户，连接已登录的 Chrome |
| 无扩展 token | CLI 自行拉起浏览器 | CI、无登录态或纯自动化场景 |

CI 中使用 `OPENCLI_BROWSER_EXECUTABLE_PATH` 指定真实 Chrome 路径：

::: v-pre
```yaml
env:
  OPENCLI_BROWSER_EXECUTABLE_PATH: ${{ steps.setup-chrome.outputs.chrome-path }}
```
:::

---

## 站点兼容性

GitHub Actions 的美国 runner 上，部分站点会因为地域限制、登录要求或反爬而返回空数据。当前 E2E 对这些场景采用 warn + pass 策略，避免偶发站点限制把整条 CI 打红。

| 站点 | CI 表现 | 常见原因 |
|---|---|---|
| `hackernews`、`bbc`、`v2ex`、`bloomberg` | 通常返回数据 | 公开接口或公开页面 |
| `yahoo-finance`、`google` | 通常返回数据 | 页面公开，但仍可能受限流影响 |
| `bilibili`、`zhihu`、`weibo`、`xiaohongshu`、`xueqiu` | 容易空数据 | 地域限制、反爬、登录要求 |
| `reddit`、`twitter`、`youtube` | 容易空数据 | 登录态、cookie、机器人检测 |
| `smzdm`、`boss`、`ctrip`、`coupang`、`linux-do` | 结果波动较大 | 地域限制、风控或页面结构变动 |

> 如果需要更稳定的浏览器 E2E 结果，优先使用具备目标站点网络可达性的 self-hosted runner。
