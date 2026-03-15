# OpenCLI

> **把任何网站变成你的命令行工具。**  
> 零风控 · 复用 Chrome 登录 · AI 自动发现接口

[English](./README.md)

[![npm](https://img.shields.io/npm/v/@jackwener/opencli)](https://www.npmjs.com/package/@jackwener/opencli)

OpenCLI 通过 Chrome 浏览器 + [Playwright MCP Bridge](https://github.com/nichochar/playwright-mcp) 扩展，将任何网站变成命令行工具。不存密码、不泄 token，直接复用浏览器已登录状态。

## ✨ 亮点

- 🌐 **28+ 命令，16 个站点** — B站、知乎、小红书、Twitter、Reddit、GitHub、V2EX、Hacker News、BBC、微博、BOSS直聘、Yahoo Finance、路透社、什么值得买、携程、YouTube
- 🔐 **零风控** — 复用 Chrome 登录态，无需存储任何凭证
- 🤖 **AI 原生** — `explore` 自动发现 API，`synthesize` 生成适配器，`cascade` 探测认证策略
- 📝 **声明式 YAML** — 大部分适配器只需 ~30 行 YAML
- 🔌 **TypeScript 扩展** — 复杂场景（XHR 拦截、GraphQL）可用 TS 编写

## 🚀 快速开始

### npm 全局安装（推荐）

```bash
npm install -g @jackwener/opencli
```

直接使用：

```bash
opencli list                              # 查看所有命令
opencli hackernews top --limit 5          # 公共 API，无需浏览器
opencli bilibili hot --limit 5            # 浏览器命令
opencli zhihu hot -f json                 # JSON 输出
```

### 从源码安装

```bash
git clone git@github.com:jackwener/opencli.git
cd opencli && npm install
npx tsx src/main.ts list
```

### 更新

```bash
# npm 全局更新
npm update -g @jackwener/opencli

# 或直接安装最新版
npm install -g @jackwener/opencli@latest
```

## 📋 前置要求

浏览器命令需要：
1. **Chrome** 浏览器正在运行，且**已登录目标网站**（如 bilibili.com、zhihu.com、xiaohongshu.com）
2. 安装 **[Playwright MCP Bridge](https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm)** 扩展
3. 在 MCP 配置中设置 `PLAYWRIGHT_MCP_EXTENSION_TOKEN`（从扩展设置页获取）：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--extension"],
      "env": {
        "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "<your-token>"
      }
    }
  }
}
```

公共 API 命令（`hackernews`、`github search`、`v2ex`）无需浏览器。

> **⚠️ 重要**：浏览器命令复用你的 Chrome 登录状态。运行命令前，你必须已在 Chrome 中登录目标网站。如果获取到空数据或报错，请先检查登录状态。

## 📦 内置命令

| 站点 | 命令 | 模式 |
|------|------|------|
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `user-videos` | 🔐 浏览器 |
| **zhihu** | `hot` `search` `question` | 🔐 浏览器 |
| **xiaohongshu** | `search` `notifications` `feed` | 🔐 浏览器 |
| **twitter** | `trending` | 🔐 浏览器 |
| **reddit** | `hot` | 🔐 浏览器 |
| **weibo** | `hot` | 🔐 浏览器 |
| **boss** | `search` | 🔐 浏览器 |
| **youtube** | `search` | 🔐 浏览器 |
| **yahoo-finance** | `quote` | 🔐 浏览器 |
| **reuters** | `search` | 🔐 浏览器 |
| **smzdm** | `search` | 🔐 浏览器 |
| **ctrip** | `search` | 🔐 浏览器 |
| **github** | `trending` `search` | 🔐 / 🌐 |
| **v2ex** | `hot` `latest` `topic` | 🌐 公共 API |
| **hackernews** | `top` | 🌐 公共 API |
| **bbc** | `news` | 🌐 公共 API |

## 🎨 输出格式

```bash
opencli bilibili hot -f table   # 默认：表格
opencli bilibili hot -f json    # JSON（可 pipe 给 jq 或 AI agent）
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
opencli bilibili hot -v         # 详细模式：展示 pipeline 每步数据
```

## 🧠 AI Agent 工作流

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

探索结果输出到 `.opencli/explore/<site>/`：
- `manifest.json` — 站点元数据、框架检测结果
- `endpoints.json` — 评分排序的 API 端点，含响应 schema
- `capabilities.json` — 推理出的能力及置信度
- `auth.json` — 认证策略建议

## 🔧 创建新命令

查看 **[SKILL.md](./SKILL.md)** 了解完整的适配器开发指南（YAML pipeline + TypeScript）。

## 版本发布

```bash
# 升级版本号
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0

# 推送 tag，GitHub Actions 自动发 release 并发布到 npm
git push --follow-tags
```

## 📄 License

MIT
