# OpenCLI

> **把任何网站或 Electron 应用变成你的命令行工具。**  
> 零风控 · 复用 Chrome 登录 · AI 自动发现接口 · 80+ 命令 · 19 站点

[English](./README.md)

[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](./LICENSE)

OpenCLI 将任何网站或 Electron 应用（如 Antigravity）变成命令行工具 — B站、知乎、小红书、Twitter/X、Reddit、YouTube 等 [19 个站点](#内置命令) — 复用浏览器登录态，AI 驱动探索。

🔥 **opencli 支持 CLI 化所有 electron 应用！最强大更新来袭！** 🔥
CLI all electron！现在支持把所有 electron 应用 CLI 化，从而组合出各种神奇的能力。
如果你在使用诸如 Antigravity Ultra 等工具时觉得不够灵活或难以扩展，现在通过 OpenCLI 把他 CLI 化，轻松打破界限。
现在，**AI 可以自己控制自己**！结合 cc/openclaw 就可以远程控制任何 electron 应用！无限玩法！！

---

## 目录

- [亮点](#亮点)
- [前置要求](#前置要求)
- [快速开始](#快速开始)
- [内置命令](#内置命令)
- [输出格式](#输出格式)
- [致 AI Agent（开发者指南）](#致-ai-agent开发者指南)
- [远程 Chrome（服务器/无头环境）](#远程-chrome服务器无头环境)
- [常见问题排查](#常见问题排查)
- [版本发布](#版本发布)
- [License](#license)

---

## 亮点

- **CLI All Electron** — 支持把所有 electron 应用（如 Antigravity Ultra）CLI 化，让 AI 控制自己！
- **不抢窗口** — 运行一次 `opencli login` 保存 Cookie，之后所有命令加上 `--headless` 即可后台静默执行，Chrome 窗口不再弹出。
- **多站点覆盖** — B站、知乎、小红书、Twitter、Reddit 等 19 个站点，80+ 命令
- **零风控** — 复用 Chrome 登录态，无需存储任何凭证
- **自修复配置** — `opencli setup` 自动发现 Token；`opencli doctor` 诊断 10+ 工具配置；`--fix` 一键修复
- **AI 原生** — `explore` 自动发现 API，`synthesize` 生成适配器，`cascade` 探测认证策略
- **动态加载引擎** — 声明式的 `.yaml` 或者底层定制的 `.ts` 适配器，放入 `clis/` 文件夹即可自动注册生效

## 前置要求

- **Node.js**: >= 18.0.0
- **Chrome** 浏览器正在运行，且**已登录目标网站**（如 bilibili.com、zhihu.com、xiaohongshu.com）

> **Tip**：不想每次都弹出 Chrome 窗口？配置完成后运行一次 `opencli login` 保存登录态，之后所有命令加 `--headless` 即可后台静默运行，Cookie 完整保留。

OpenCLI 通过 Playwright MCP Bridge 扩展与你的浏览器通信。
它会优先复用本地或全局已安装的 `@playwright/mcp`，如果没有嗅探到可用 MCP server，则会自动回退到 `npx -y @playwright/mcp@latest` 启动。

### Playwright MCP Bridge 扩展配置

1. 安装 **[Playwright MCP Bridge](https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm)** 扩展
2. 运行 `opencli setup` — 自动发现 Token、分发到各工具、验证连通性：

```bash
opencli setup
```

交互式 TUI 会：
- 🔍 从 Chrome 自动发现 `PLAYWRIGHT_MCP_EXTENSION_TOKEN`（无需手动复制）
- ☑️ 显示所有支持的工具（Codex、Cursor、Claude Code、Gemini CLI 等）
- ✏️ 只更新你选中的文件（空格切换，回车确认）
- 🔌 完成后自动验证浏览器连通性

> **Tip**：后续诊断和维护用 `opencli doctor`：
> ```bash
> opencli doctor            # 只读 Token 与配置诊断
> opencli doctor --live     # 额外测试浏览器连通性
> opencli doctor --fix      # 修复不一致的配置（交互确认）
> opencli doctor --fix -y   # 无交互直接修复所有配置
> ```

**备选方案：CDP 模式 (适用于服务器/无头环境)**
如果你无法安装浏览器扩展（比如在远程无头服务器上运行 OpenCLI），你可以通过 SSH 隧道或反向代理，利用 CDP (Chrome DevTools Protocol) 连接到本地的 Chrome 浏览器。详细指南请参考 [CDP 连接教程](./CDP.zh-CN.md)。

<details>
<summary>手动配置（备选方案）</summary>

配置你的 MCP 客户端（如 Claude/Cursor 等）：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--extension"],
      "env": {
        "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "<你的-token>"
      }
    }
  }
}
```

在终端环境变量中导出（建议写进 `~/.zshrc`）：

```bash
export PLAYWRIGHT_MCP_EXTENSION_TOKEN="<你的-token>"
```

</details>

## 快速开始

### npm 全局安装（推荐）

```bash
npm install -g @jackwener/opencli
opencli setup   # 首次使用：配置 Playwright MCP token
```

直接使用：

```bash
opencli list                              # 查看所有命令
opencli list -f yaml                      # 以 YAML 列出所有命令
opencli hackernews top --limit 5          # 公共 API，无需浏览器
opencli bilibili hot --limit 5            # 浏览器命令（使用 Chrome 扩展）
opencli zhihu hot -f json                 # JSON 输出
opencli zhihu hot -f yaml                 # YAML 输出
```

### 后台静默模式（无弹窗 + 有 Cookie）

默认情况下，浏览器命令会短暂弹出一个 Chrome 标签页。如需后台静默运行：

```bash
# 一次性操作：将 Chrome 登录态（Cookie）保存到 ~/.opencli/session.json
opencli login

# 之后所有浏览器命令都可以后台运行，无弹窗，且保持完整登录态
opencli --headless bilibili me
opencli --headless bilibili hot --limit 10
opencli --headless zhihu hot -f json
```

> 登录态过期后（通常几个月）重新运行 `opencli login` 即可。

### 从源码安装（面向开发者）

```bash
git clone git@github.com:jackwener/opencli.git
cd opencli 
npm install
npm run build
npm link      # 链接到全局环境
opencli list  # 可以在任何地方使用了！
```

### 更新

```bash
npm install -g @jackwener/opencli@latest
```

## 内置命令

**19 个站点 · 80+ 命令** — 运行 `opencli list` 查看完整注册表。

| 站点 | 命令 | 数量 | 模式 |
|------|------|:----:|------|
| **twitter** | `trending` `bookmarks` `profile` `search` `timeline` `thread` `following` `followers` `notifications` `post` `reply` `delete` `like` `article` `follow` `unfollow` `bookmark` `unbookmark` | 18 | 🔐 浏览器 |
| **reddit** | `hot` `frontpage` `popular` `search` `subreddit` `read` `user` `user-posts` `user-comments` `upvote` `save` `comment` `subscribe` `saved` `upvoted` | 15 | 🔐 浏览器 |
| **antigravity** | `status` `send` `read` `new` `evaluate` | 5 | 🖥️ 桌面端 |
| **codex** | `status` `send` `read` `new` `extract-diff` `model` | 6 | 🖥️ 桌面端 |
| **cursor** | `status` `send` `read` `new` `dump` `composer` `model` | 7 | 🖥️ 桌面端 |
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `subtitle` `dynamic` `ranking` `following` `user-videos` | 11 | 🔐 浏览器 |
| **v2ex** | `hot` `latest` `topic` `daily` `me` `notifications` | 6 | 🌐 / 🔐 |
| **xueqiu** | `feed` `hot-stock` `hot` `search` `stock` `watchlist` | 6 | 🔐 浏览器 |
| **xiaohongshu** | `search` `notifications` `feed` `me` `user` | 5 | 🔐 浏览器 |
| **xiaoyuzhou** | `podcast` `podcast-episodes` `episode` | 3 | 🌐 公开 |
| **youtube** | `search` `video` `transcript` | 3 | 🔐 浏览器 |
| **zhihu** | `hot` `search` `question` | 3 | 🔐 浏览器 |
| **boss** | `search` `detail` | 2 | 🔐 浏览器 |
| **coupang** | `search` `add-to-cart` | 2 | 🔐 浏览器 |
| **bbc** | `news` | 1 | 🌐 公共 API |
| **ctrip** | `search` | 1 | 🔐 浏览器 |
| **github** | `search` | 1 | 🌐 公共 API |
| **hackernews** | `top` | 1 | 🌐 公共 API |
| **linkedin** | `search` | 1 | 🔐 浏览器 |
| **reuters** | `search` | 1 | 🔐 浏览器 |
| **smzdm** | `search` | 1 | 🔐 浏览器 |
| **weibo** | `hot` | 1 | 🔐 浏览器 |
| **yahoo-finance** | `quote` | 1 | 🔐 浏览器 |

## 输出格式

所有内置命令都支持 `--format` / `-f`，可选值为 `table`、`json`、`yaml`、`md`、`csv`。
`list` 命令也支持同样的格式参数，同时继续兼容 `--json`。

```bash
opencli list -f yaml            # 用 YAML 列出命令注册表
opencli bilibili hot -f table   # 默认：富文本表格
opencli bilibili hot -f json    # JSON（适合传给 jq 或者各类 AI Agent）
opencli bilibili hot -f yaml    # YAML（更适合人类直接阅读）
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
opencli bilibili hot -v         # 详细模式：展示管线执行步骤调试信息
```

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

## 常见问题排查

- **"Failed to connect to Playwright MCP Bridge"** 报错
  - 确保你当前的 Chrome 已安装且**开启了** Playwright MCP Bridge 浏览器插件。
  - 如果是刚装完插件，需要重启 Chrome 浏览器。
- **返回空数据，或者报错 "Unauthorized"**
  - Chrome 里的登录态可能已经过期（甚至被要求过滑动验证码）。请打开当前 Chrome 页面，在新标签页重新手工登录或刷新该页面。
- **Node API 错误 (如 parseArgs, fs 等)**
  - 确保 Node.js 版本 `>= 18`。旧版不支持我们使用的现代核心库 API。
- **Token 问题**
  - 运行 `opencli doctor` 诊断所有工具的 Token 配置状态。
  - 使用 `opencli doctor --live` 测试浏览器连通性。

## 版本发布

```bash
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0

# 推送 tag，GitHub Actions 将自动执行发版和 npm 发布
git push --follow-tags
```

## License

[Apache-2.0](./LICENSE)
