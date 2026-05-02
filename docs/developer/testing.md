# Testing Guide

> 面向开发者和 AI Agent 的当前测试参考手册。

## 测试结构

OpenCLI 当前测试主要分成四类：

| 类别 | 位置 | 当前规模 | 主要用途 |
|---|---|---:|---|
| 单元测试 | `src/**/*.test.ts` | 60 | 核心运行时、命令层、浏览器桥、输出、插件、诊断 |
| E2E 测试 | `tests/e2e/*.test.ts` | 11 | 真实 CLI 入口、公开站点、浏览器命令、管理命令、输出格式 |
| 烟雾测试 | `tests/smoke/*.test.ts` | 1 | 外部 API 与注册完整性健康检查 |
| 步骤级测试 | `src/pipeline/steps/*.test.ts` | 已包含在单元测试内 | pipeline step 行为与边界情况 |

当前仓库里没有独立的 `clis/**/*.test.{ts,js}` adapter 测试树。adapter 相关验证主要分布在：

- `tests/e2e/`
- `src/commanderAdapter.test.ts`
- `src/registry.test.ts`
- `src/execution.test.ts`
- `src/validate.ts` / `opencli validate`

## 本地默认策略

本地默认跑最小充分验证，不要先跑全量。

推荐顺序：

1. 改动命令文案、输出格式、参数解析：
   - 跑对应单元测试
   - 跑一条真实 CLI 命令做 spot check
2. 改动 adapter 发现、注册、验证逻辑：
   - 跑 `src/registry.test.ts`
   - 跑 `src/execution.test.ts`
   - 跑 `opencli validate`
3. 改动 browser / daemon / runtime：
   - 跑对应 `src/*test.ts`
   - 必要时补一条 `tests/e2e/*` 或手动 `opencli browser ...` 验证
4. 改动共享底层、跨多个模块、或 merge 前需要更高信心：
   - 再扩大到 `npm test`

## 常用命令

```bash
# 类型检查
npx tsc --noEmit

# 编译产物
npm run build

# 跑一个目标测试文件
npx vitest run src/<target>.test.ts

# 全量 vitest projects
npm run test:all

# E2E
npm run test:e2e

# 适配器注册 / schema 校验
node dist/src/main.js validate
```

如果你明确要跑 adapter project，也可以执行：

```bash
npm run test:adapter
```

## 当前 E2E 文件

当前 `tests/e2e/` 包含：

- `browser-auth.test.ts`
- `browser-public.test.ts`
- `cli.test.ts`
- `extension-bridge.test.ts`
- `formats.test.ts`
- `list.test.ts`
- `management.test.ts`
- `public-commands.test.ts`
- `recovery.test.ts`
- `remote-chrome.test.ts`
- `tab-targeting.test.ts`

如果这个列表变化，以仓库文件为准：

```bash
find tests/e2e -name '*.test.ts' | sort
```

## 当前值得优先覆盖的区域

以下改动最容易引入回归：

- `src/cli.ts`
- `src/commanderAdapter.ts`
- `src/discovery.ts`
- `src/execution.ts`
- `src/runtime.ts`
- `src/daemon.ts`
- `src/plugin.ts`
- `src/external.ts`
- `src/pipeline/**`

这类改动优先补：

- 精准单元测试
- 一条真实 CLI 验证路径
- 必要时再扩大到 `npm test`

## 手动验证建议

文档或命令面改动后，优先做 2 到 4 条真实命令 spot check，例如：

```bash
node dist/src/main.js --help
node dist/src/main.js list --format json
node dist/src/main.js plugin --help
node dist/src/main.js doctor --help
```

浏览器相关改动再补：

```bash
node dist/src/main.js browser --help
node dist/src/main.js browser tab list
```

## CI 角色

CI 负责更大范围的回归信心，本地负责最快闭环。

适合交给 CI 的内容：

- 更大的命令面回归
- 多环境差异
- E2E 稳定性
- smoke 检查

适合本地优先做的内容：

- 参数解析
- 输出格式
- 注册与发现
- 文档相关命令行为
- 共享模块的小范围回归

## 更新这份文档的规则

当以下任一项变化时，顺手更新此页：

- `tests/e2e/` 文件列表
- 默认本地测试命令
- `package.json` 测试脚本
- 共享运行时的高风险模块
