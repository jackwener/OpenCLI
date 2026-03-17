# OpenCLI

> **把任何网站变成你的命令行工具。**  
> 零风控 · 复用 Chrome 登录 · AI 自动发现接口 · 80+ 命令 · 19 站点

[English](./README.md)

[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](./LICENSE)

OpenCLI 将任何网站变成命令行工具 — B站、知乎、小红书、Twitter/X、Reddit、YouTube 等 [19 个站点](#内置命令) — 复用浏览器登录态，AI 驱动探索。

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

- **多站点覆盖** — B站、知乎、小红书、Twitter、Reddit 等 19 个站点，80+ 命令
- **零风控** — 复用 Chrome 登录态，无需存储任何凭证
- **自修复配置** — `opencli setup` 自动发现 Token；`opencli doctor` 诊断 10+ 工具配置；`--fix` 一键修复
- **AI 原生** — `explore` 自动发现 API，`synthesize` 生成适配器，`cascade` 探测认证策略
- **动态加载引擎** — 声明式的 `.yaml` 或者底层定制的 `.ts` 适配器，放入 `clis/` 文件夹即可自动注册生效

## 前置要求

- **Node.js**: >= 18.0.0
- **Chrome** 浏览器正在运行，且**已登录目标网站**（如 bilibili.com、zhihu.com、xiaohongshu.com）

> **⚠️ 重要**：大多数命令复用你的 Chrome 登录状态。运行命令前，你必须已在 Chrome 中打开目标网站并完成登录。如果获取到空数据或报错，请先检查你的浏览器登录状态。

OpenCLI 通过 Playwright MCP Bridge 扩展与你的浏览器通信。

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
opencli bilibili hot --limit 5            # 浏览器命令
opencli zhihu hot -f json                 # JSON 输出
opencli zhihu hot -f yaml                 # YAML 输出
```

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
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `subtitle` `dynamic` `ranking` `following` `user-videos` | 11 | 🔐 浏览器 |
| **v2ex** | `hot` `latest` `topic` `daily` `me` `notifications` | 6 | 🌐 / 🔐 |
| **xueqiu** | `feed` `hot-stock` `hot` `search` `stock` `watchlist` | 6 | 🔐 浏览器 |
| **xiaohongshu** | `search` `notifications` `feed` `me` `user` | 5 | 🔐 浏览器 |
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

## 远程 Chrome（服务器/无头环境）

在服务器（无显示器）环境中，通过 Chrome DevTools Protocol (CDP) 连接到本地电脑上运行的 Chrome。支持两种方式：

| 方式 | 需重启 Chrome？ | Chrome 版本 | 端点格式 |
|------|:-:|:-:|:-:|
| **A. Chrome 144+ 自动发现** | 否 | ≥ 144 | `ws://` |
| **B. 经典 `--remote-debugging-port`** | 是 | 任意 | `http://` |

---

### 方式 A：Chrome 144+（无需重启）

直接复用**已运行的 Chrome**，不需要任何命令行参数。

**第一步 — 在 Chrome 中开启远程调试**

打开 `chrome://inspect#remote-debugging`，勾选"允许远程调试"。

**第二步 — 获取 WebSocket URL**

读取 Chrome 的 `DevToolsActivePort` 文件获取端口和浏览器 GUID：

```bash
# macOS (Chrome)
cat ~/Library/Application\ Support/Google/Chrome/DevToolsActivePort

# macOS (Edge)
cat ~/Library/Application\ Support/Microsoft\ Edge/DevToolsActivePort

# Linux (Chrome)
cat ~/.config/google-chrome/DevToolsActivePort

# Linux (Chromium)
cat ~/.config/chromium/DevToolsActivePort
```

```cmd
:: Windows (Chrome)
type "%LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort"

:: Windows (Edge)
type "%LOCALAPPDATA%\Microsoft\Edge\User Data\DevToolsActivePort"
```

输出示例：
```
61882
/devtools/browser/9f395fbe-24cb-4075-b58f-dd1c4f6eb172
```

**第三步 — SSH 隧道 + 运行 OpenCLI**

```bash
# 本地电脑 — 将端口转发到服务器
ssh -R 61882:localhost:61882 your-server

# 在服务器上
export OPENCLI_CDP_ENDPOINT="ws://localhost:61882/devtools/browser/9f395fbe-..."
opencli doctor                    # 验证连接
opencli bilibili hot --limit 5    # 测试命令
```

> **同机快捷方式**：如果 Chrome 和 OpenCLI 在同一台机器上运行，auto-discovery 会自动读取 `DevToolsActivePort`，无需设置环境变量，或设置 `OPENCLI_CDP_ENDPOINT=1` 强制启用。

> **注意**：每次 Chrome 重启或重新启用远程调试后，端口和 GUID 会改变，需要重新读取 `DevToolsActivePort` 并更新环境变量。

---

### 方式 B：经典 `--remote-debugging-port`（任意 Chrome 版本）

需要用命令行参数重启 Chrome，但兼容所有 Chrome 版本，且 HTTP 端点稳定不变。

**第一步 — 启动带远程调试的 Chrome**

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222
```

**第二步 — 登录目标网站**

**第三步 — SSH 隧道 + 运行 OpenCLI**

```bash
# 本地电脑
ssh -R 9222:localhost:9222 your-server

# 在服务器上
export OPENCLI_CDP_ENDPOINT="http://localhost:9222"
opencli doctor                    # 验证连接
opencli bilibili hot --limit 5    # 测试命令
```

---

### 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `OPENCLI_CDP_ENDPOINT` | CDP 端点 URL（`ws://` 或 `http://`），或 `1` 强制自动发现 | `ws://localhost:61882/devtools/browser/...` |
| `CHROME_USER_DATA_DIR` | 自定义 Chrome 用户数据目录（用于 `DevToolsActivePort` 发现） | `/home/user/.config/google-chrome` |

### 持久化配置

写入 shell 配置文件（`~/.bashrc` 或 `~/.zshrc`）：

```bash
export OPENCLI_CDP_ENDPOINT="ws://localhost:61882/devtools/browser/..."
```

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
