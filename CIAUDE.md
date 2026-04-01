# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 项目概述

OpenCLI 将网站、Electron 应用和本地 CLI 工具转化为命令行接口。提供 70+ 站点适配器（Bilibili、Twitter/X、Reddit、Spotify、HackerNews 等），具备零成本运行时执行、确定性输出和 AI 驱动的发现能力。发布为 `@jackwener/opencli`。

## 构建与开发命令

```bash
npm install               # 安装依赖
npm run build             # 完整构建：clean + tsc + manifest + YAML 复制
npm run dev               # 开发模式：tsx src/main.ts（无需构建）
npm link                  # 全局安装，用于测试 `opencli` 命令

npx tsc --noEmit          # 仅类型检查（快速）
```

## 测试命令

```bash
npm test                  # 仅单元测试（src/**/*.test.ts，排除 src/clis/）
npm run test:adapter      # 仅适配器测试（src/clis/**/*.test.ts）
npm run test:all          # 顺序运行所有测试项目
npx vitest run tests/e2e/ # E2E 测试（需要先 `npm run build`）
npx vitest run tests/smoke/ # 烟雾测试

# 单个测试文件
npx vitest run src/clis/apple-podcasts/commands.test.ts

# Watch 模式
npx vitest src/

# 扩展 E2E（20+ 站点）
OPENCLI_E2E=1 npx vitest run
```

E2E 测试通过子进程调用 `dist/main.js` — 运行前务必先构建。浏览器 E2E 测试对不稳定站点（地域限制、反爬）采用 warn+pass 策略。

## 架构

### 双适配器系统

适配器位于 `src/clis/<site>/<command>.yaml` 或 `.ts`。数据抓取优先使用 YAML；复杂浏览器交互使用 TypeScript。

- **YAML 适配器**使用声明式管道（`fetch → map → filter → limit → sort`），支持模板表达式 `${{ item.title }}`
- **TypeScript 适配器**调用 `src/registry.ts` 中的 `cli()`，通过 `func` 回调接收 `(page: IPage, kwargs)`

### 核心流程

`main.ts`（入口）→ `discovery.ts`（发现适配器）→ `commanderAdapter.ts`（桥接到 Commander）→ `execution.ts`（校验参数、执行命令）→ `output.ts`（格式化为 table/json/yaml/csv/md）

### 核心模块

| 模块 | 职责 |
|------|------|
| `src/registry.ts` | `Strategy` 枚举、`CliCommand` 接口、通过全局 `__opencli_registry__` Map 进行 `cli()` 注册 |
| `src/discovery.ts` | 从预编译的 `cli-manifest.json`（生产）或文件系统扫描（开发）加载适配器 |
| `src/execution.ts` | 懒加载 TS 模块、校验参数、管理浏览器会话和超时 |
| `src/pipeline/` | YAML 管道执行器、模板求值器（`${{ }}`）、步骤处理器（fetch、map、filter、transform、browser、intercept、download） |
| `src/browser/` | 基于 CDP 的 IPage 抽象；BrowserBridge（Chrome 扩展 + 守护进程）或 CDPBridge（通过 `OPENCLI_CDP_ENDPOINT` 直连） |
| `src/errors.ts` | 统一错误层级，使用 Unix sysexits.h 退出码（66=无输入、69=不可用、75=超时、77=无权限） |
| `src/output.ts` | 多格式渲染器：table、json、yaml、csv、md |

### Strategy 枚举（认证方式）

`PUBLIC`（无认证）| `COOKIE`（浏览器登录会话）| `HEADER`（自定义认证头）| `INTERCEPT`（网络请求捕获）| `UI`（浏览器交互）

### 构建清单

`npm run build` 生成 `cli-manifest.json` — YAML 适配器完全内联（零运行时解析），TS 适配器变为懒加载存根，首次执行时加载。

## 代码规范

- **TypeScript strict 模式** — 避免使用 `any`
- **ES Modules** — import 路径使用 `.js` 扩展名
- **命名规范**：文件 `kebab-case`，变量/函数 `camelCase`，类型/类 `PascalCase`
- **禁止默认导出** — 始终使用命名导出
- **Conventional Commits**：`feat(twitter): add thread command`、`fix(browser): handle CDP timeout`
- 常用 scope：站点名（`twitter`、`reddit`）或模块名（`browser`、`pipeline`、`engine`）

## 参数设计规范

主要必填参数使用位置参数（query、username、video_id）。配置项使用命名标志 `--flag`（limit、format、sort）。示例：`opencli bilibili hot --limit 10` 而非 `opencli bilibili hot --category hot`。

## 新增适配器

1. 创建 `src/clis/<site>/<command>.yaml`（复杂逻辑用 `.ts`）
2. 运行 `opencli validate` 检查语法
3. 使用 `opencli <site> <command> --limit 3 -f json` 测试
4. 使用 `-v` 标志开启调试输出（`OPENCLI_VERBOSE=1`）
5. 在相应位置添加测试：
   - 单元逻辑 → `src/clis/<site>/*.test.ts`
   - 公开 API 命令 → `tests/e2e/public-commands.test.ts`
   - 浏览器公开数据 → `tests/e2e/browser-public.test.ts`
   - 浏览器需登录 → `tests/e2e/browser-auth.test.ts`

## 致 AI Agent（开发者指南）

如果你是一个被要求查阅代码并编写新 `opencli` 适配器的 AI，请遵守以下工作流。

> **快速模式**：只想为某个页面快速生成一个命令？看 [CLI-ONESHOT.md](./CLI-ONESHOT.md) — 给一个 URL + 一句话描述，4 步搞定。

> **完整模式**：在编写任何新代码前，先阅读 [CLI-EXPLORER.md](./CLI-EXPLORER.md)。它包含完整的适配器探索开发指南、API 探测流程、5级认证策略以及常见陷阱。

```bash
# 1. Deep Explore — 网络拦截 → 响应分析 → 能力推理 → 框架检测
opencli explore https://example.com --site mysite

# 2. Synthesize — 从探索成果物生成 evaluate-based YAML 适配器
opencli synthesize mysite

# 3. Generate — 一键完成：探索 → 合成 → 注册
opencli generate https://example.com --goal "hot"

# 4. Strategy Cascade — 自动降级探测：PUBLIC → COOKIE → HEADER
opencli cascade https://api.example.com/data
```

探索结果输出到 `.opencli/explore/<site>/`。

## PR 前检查清单

```bash
npx tsc --noEmit          # 类型检查
npm test                  # 单元测试
npm run test:adapter      # 适配器测试（如修改了适配器逻辑）
opencli validate          # YAML 校验（如适用）
```
