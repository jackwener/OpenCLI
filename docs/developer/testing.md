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

```
tests/
├── e2e/                           # E2E 集成测试（子进程运行真实 CLI）
│   ├── helpers.ts                 # runCli() 共享工具
│   ├── public-commands.test.ts    # 公开 API 命令（无需浏览器）
│   ├── browser-public.test.ts     # 浏览器命令（公开数据）
│   ├── browser-auth.test.ts       # 需登录命令（graceful failure 测试）
│   ├── management.test.ts         # 管理命令（list, validate, verify, help）
│   └── output-formats.test.ts     # 输出格式（json/yaml/csv/md）
├── smoke/                         # 烟雾测试（仅定时 / 手动触发）
│   └── api-health.test.ts         # 外部 API 可用性检测
src/
├── *.test.ts                      # 单元测试（已有 8 个）
```

| 层 | 位置 | 运行方式 | 用途 |
|---|---|---|---|
| 单元测试 | `src/**/*.test.ts` | `npx vitest run src/` | 内部模块逻辑 |
| E2E 测试 | `tests/e2e/*.test.ts` | `npx vitest run tests/e2e/` | 真实 CLI 命令执行 |
| 烟雾测试 | `tests/smoke/*.test.ts` | `npx vitest run tests/smoke/` | 外部 API 健康 |

---

## 当前覆盖范围

### 单元测试（8 个文件）

| 文件 | 覆盖内容 |
|---|---|
| `browser.test.ts` | JSON-RPC、tab 管理、extension/standalone 模式切换 |
| `engine.test.ts` | 命令发现与执行 |
| `registry.test.ts` | 命令注册与策略分配 |
| `output.test.ts` | 输出格式渲染 |
| `doctor.test.ts` | Token 诊断 |
| `coupang.test.ts` | 数据归一化 |
| `pipeline/template.test.ts` | 模板表达式求值 |
| `pipeline/transform.test.ts` | 数据变换步骤 |

### E2E 测试（~52 个用例）

| 文件 | 覆盖站点/功能 | 测试数 |
|---|---|---|
| `public-commands.test.ts` | hackernews/top, v2ex/hot, v2ex/latest, v2ex/topic | 5 |
| `browser-public.test.ts` | bbc, bilibili×3, weibo, zhihu×2, reddit×2, twitter, xueqiu×2, reuters, youtube, smzdm, boss, ctrip, coupang, xiaohongshu, yahoo-finance, v2ex/daily | 21 |
| `browser-auth.test.ts` | bilibili/me,dynamic,favorite,history,following + twitter/bookmarks,timeline,notifications + v2ex/me,notifications + xueqiu/feed,watchlist + xiaohongshu/feed,notifications | 14 |
| `management.test.ts` | list×5 格式, validate×3 级别, verify, --version, --help, unknown cmd | 12 |
| `output-formats.test.ts` | json, yaml, csv, md 格式验证 | 5 |

### 烟雾测试

公开 API 可用性（hackernews, v2ex×2, v2ex/topic）+ 全站点注册完整性检查。

---

## 本地运行测试

### 前置条件

```bash
npm ci                # 安装依赖
npm run build         # 编译（E2E 测试需要 dist/main.js）
```

### 运行命令

```bash
# 全部单元测试
npx vitest run src/

# 全部 E2E 测试（会真实调用外部 API）
npx vitest run tests/e2e/

# 单个测试文件
npx vitest run tests/e2e/management.test.ts

# 全部测试（单元 + E2E）
npx vitest run

# 烟雾测试
npx vitest run tests/smoke/

# watch 模式（开发时推荐）
npx vitest src/
```

### 浏览器命令本地测试须知

- opencli 通过 Browser Bridge 扩展连接已运行的 Chrome 浏览器
- `browser-public.test.ts` 使用 `tryBrowserCommand()`，站点反爬导致空数据时 warn + pass
- `browser-auth.test.ts` 验证 **graceful failure**（不 crash 不 hang 即通过）
- 如需测试完整登录态，保持 Chrome 登录态并安装 Browser Bridge 扩展，手动跑对应测试

---

## 如何添加新测试

### 新增 YAML Adapter（如 `src/clis/producthunt/trending.yaml`）

1. **无需额外操作**：`validate` 测试会自动覆盖 YAML 结构验证
2. 根据 adapter 类型，在对应文件加一个 `it()` block：

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

在 `tests/e2e/management.test.ts` 添加测试。

### 新增内部模块

在 `src/` 下对应位置创建 `*.test.ts`。

### 决策流程图

```
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

### ci.yml（主流水线）

| Job | 触发条件 | 内容 |
|---|---|---|
| **build** | push/PR to main,dev | typecheck + build |
| **unit-test** | push/PR to main,dev | 单元测试，2 shard 并行 |
| **smoke-test** | 每周一 08:00 UTC / 手动 | xvfb + real Chrome，外部 API 健康检查 |

### e2e-headed.yml（E2E 测试）

| Job | 触发条件 | 内容 |
|---|---|---|
| **e2e-headed** | push/PR to main,dev | xvfb + real Chrome，全部 E2E 测试 |

E2E 使用 `browser-actions/setup-chrome` 安装真实 Chrome，配合 `xvfb-run` 提供虚拟显示器，以 headed 模式运行浏览器。

### Sharding

单元测试使用 vitest 内置 shard：

::: v-pre
```yaml
strategy:
  matrix:
    shard: [1, 2]
steps:
  - run: npx vitest run src/ --shard=${{ matrix.shard }}/2
```
:::

---

## 浏览器模式

opencli 通过 Browser Bridge 扩展连接浏览器：

| 条件 | 模式 | 使用场景 |
|---|---|---|
| 扩展已安装 | Extension 模式 | 本地用户，连接已登录的 Chrome |
| 扩展未安装 | CLI 报错提示安装 | 需要安装 Browser Bridge 扩展 |

CI 中使用 `OPENCLI_BROWSER_EXECUTABLE_PATH` 指定真实 Chrome 路径：

::: v-pre
```yaml
env:
  OPENCLI_BROWSER_EXECUTABLE_PATH: ${{ steps.setup-chrome.outputs.chrome-path }}
```
:::

---

## 站点兼容性

在 GitHub Actions 美国 runner 上，部分站点因地域限制或登录要求返回空数据。E2E 测试对这些站点使用 warn + pass 策略，不影响 CI 绿灯。

| 站点 | CI 状态 | 限制原因 |
|---|---|---|
| hackernews, bbc, v2ex | ✅ 返回数据 | 无限制 |
| yahoo-finance | ✅ 返回数据 | 无限制 |
| bilibili, zhihu, weibo, xiaohongshu | ⚠️ 空数据 | 地域限制（中国站点） |
| reddit, twitter, youtube | ⚠️ 空数据 | 需登录或 cookie |
| smzdm, boss, ctrip, coupang, xueqiu | ⚠️ 空数据 | 地域限制 / 需登录 |

> 使用 self-hosted runner（国内服务器）可解决地域限制问题。
