# OpenCLI

> **把任何网站或 Electron 应用变成你的命令行工具。**  
> 零风控 · 复用 Chrome 登录 · AI 自动发现接口 · 浏览器与桌面端自动化

[English](./README.md)

[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](./LICENSE)

OpenCLI 将任何网站或 Electron 应用（如 Antigravity）变成命令行工具 — B站、知乎、小红书、Twitter/X、Reddit、YouTube 等[多种站点与应用](#内置命令) — 复用浏览器登录态，AI 驱动探索。

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
  - [桌面应用适配器](#桌面应用适配器)
- [下载支持](#下载支持)
- [输出格式](#输出格式)
- [致 AI Agent（开发者指南）](#致-ai-agent开发者指南)
- [远程 Chrome（服务器/无头环境）](#远程-chrome服务器无头环境)
- [常见问题排查](#常见问题排查)
- [版本发布](#版本发布)
- [License](#license)

---

## 亮点

- **CLI All Electron** — 支持把所有 electron 应用（如 Antigravity Ultra）CLI 化，让 AI 控制自己！
- **多站点覆盖** — 覆盖 B站、知乎、小红书、Twitter、Reddit，以及多种桌面应用
- **零风控** — 复用 Chrome 登录态，无需存储任何凭证
- **自修复配置** — `opencli setup` 检查 Browser Bridge 连通性；`opencli doctor` 诊断 daemon、扩展和浏览器连接状态
- **AI 原生** — `explore` 自动发现 API，`synthesize` 生成适配器，`cascade` 探测认证策略
- **动态加载引擎** — 声明式的 `.yaml` 或者底层定制的 `.ts` 适配器，放入 `clis/` 文件夹即可自动注册生效

## 前置要求

- **Node.js**: >= 20.0.0
- **Chrome** 浏览器正在运行，且**已登录目标网站**（如 bilibili.com、zhihu.com、xiaohongshu.com）

> **⚠️ 重要**：大多数命令复用你的 Chrome 登录状态。运行命令前，你必须已在 Chrome 中打开目标网站并完成登录。如果获取到空数据或报错，请先检查你的浏览器登录状态。

OpenCLI 通过轻量化的 **Browser Bridge** Chrome 扩展 + 微型 daemon 与浏览器通信（零配置，自动启动）。

### Browser Bridge 扩展配置

你可以选择以下任一方式安装扩展：

**方式一：下载构建好的安装包（推荐）**
1. 到 GitHub [Releases 页面](https://github.com/jackwener/opencli/releases) 下载最新的 `opencli-extension.zip` 或 `opencli-extension.crx`。
2. 打开 Chrome 的 `chrome://extensions`，启用右上角的 **开发者模式**。
3. 将 `.crx` 拖入浏览器窗口，或将解压后的文件夹拖入即可完成安装。

**方式二：加载源码（针对开发者）**
1. 同样在 `chrome://extensions` 开启 **开发者模式**。
2. 点击 **加载已解压的扩展程序**，选择本仓库代码树中的 `extension/` 文件夹。

完成！运行任何 opencli 浏览器命令时，后台微型 daemon 会自动启动与浏览器通信。无需配 API Token，零代码配置。

> **Tip**：后续诊断用 `opencli doctor`：
> ```bash
> opencli doctor            # 检查扩展和 daemon 连通性
> opencli doctor --live     # 额外测试浏览器命令
> ```

## 快速开始

### npm 全局安装（推荐）

```bash
npm install -g @jackwener/opencli
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

运行 `opencli list` 查看完整注册表。

| 站点 | 命令 | 模式 |
|------|------|------|
| **twitter** | `trending` `bookmarks` `profile` `search` `timeline` `thread` `following` `followers` `notifications` `post` `reply` `delete` `like` `article` `follow` `unfollow` `bookmark` `unbookmark` `download` `accept` `reply-dm` | 浏览器 |
| **reddit** | `hot` `frontpage` `popular` `search` `subreddit` `read` `user` `user-posts` `user-comments` `upvote` `save` `comment` `subscribe` `saved` `upvoted` | 浏览器 |
| **cursor** | `status` `send` `read` `new` `dump` `composer` `model` `extract-code` `ask` `screenshot` `history` `export` | 桌面端 |
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `subtitle` `dynamic` `ranking` `following` `user-videos` `download` | 浏览器 |
| **codex** | `status` `send` `read` `new` `extract-diff` `model` `ask` `screenshot` `history` `export` | 桌面端 |
| **chatwise** | `status` `new` `send` `read` `ask` `model` `history` `export` `screenshot` | 桌面端 |
| **notion** | `status` `search` `read` `new` `write` `sidebar` `favorites` `export` | 桌面端 |
| **discord-app** | `status` `send` `read` `channels` `servers` `search` `members` | 桌面端 |
| **v2ex** | `hot` `latest` `topic` `daily` `me` `notifications` | 公开 / 浏览器 |
| **xueqiu** | `feed` `hot-stock` `hot` `search` `stock` `watchlist` | 浏览器 |
| **antigravity** | `status` `send` `read` `new` `dump` `extract-code` `model` `watch` | 桌面端 |
| **chatgpt** | `status` `new` `send` `read` `ask` | 桌面端 |
| **xiaohongshu** | `search` `notifications` `feed` `me` `user` `download` | 浏览器 |
| **apple-podcasts** | `search` `episodes` `top` | 公开 |
| **xiaoyuzhou** | `podcast` `podcast-episodes` `episode` | 公开 |
| **zhihu** | `hot` `search` `question` `download` | 浏览器 |
| **youtube** | `search` `video` `transcript` | 浏览器 |
| **boss** | `search` `detail` | 浏览器 |
| **coupang** | `search` `add-to-cart` | 浏览器 |
| **bbc** | `news` | 公共 API |
| **ctrip** | `search` | 浏览器 |
| **github** | `search` | 公共 API |
| **arxiv** | `search` `paper` | 公开 |
| **wikipedia** | `search` `summary` | 公开 |
| **hackernews** | `top` | 公共 API |
| **linkedin** | `search` | 浏览器 |
| **reuters** | `search` | 浏览器 |
| **smzdm** | `search` | 浏览器 |
| **weibo** | `hot` | 浏览器 |
| **yahoo-finance** | `quote` | 浏览器 |

### 桌面应用适配器

每个桌面适配器都有自己详细的文档说明，包括命令参考、启动配置与使用示例：

| 应用 | 描述 | 文档 |
|-----|-------------|-----|
| **Cursor** | 控制 Cursor IDE — Composer、对话、代码提取等 | [README](./src/clis/cursor/README.md) |
| **Codex** | 在后台（无头）驱动 OpenAI Codex CLI Agent | [README](./src/clis/codex/README.md) |
| **Antigravity** | 在终端直接控制 Antigravity Ultra | [README](./src/clis/antigravity/README.md) |
| **ChatGPT** | 自动化操作 ChatGPT macOS 桌面客户端 | [README](./src/clis/chatgpt/README.md) |
| **ChatWise** | 多 LLM 客户端（GPT-4、Claude、Gemini） | [README](./src/clis/chatwise/README.md) |
| **Notion** | 搜索、读取、写入 Notion 页面 | [README](./src/clis/notion/README.md) |
| **Discord** | Discord 桌面版 — 消息、频道、服务器 | [README](./src/clis/discord-app/README.md) |
| **Feishu** | 飞书/Lark 桌面版 (AppleScript 驱动) | [README](./src/clis/feishu/README.md) |
| **WeChat** | 微信 Mac 桌面端 (AppleScript + 无障碍接口) | [README](./src/clis/wechat/README.md) |
| **NeteaseMusic** | 网易云音乐 (CEF/CDP 驱动) | [README](./src/clis/neteasemusic/README.md) |

## 下载支持

OpenCLI 支持从各平台下载图片、视频和文章。

### 支持的平台

| 平台 | 内容类型 | 说明 |
|------|----------|------|
| **小红书** | 图片、视频 | 下载笔记中的所有媒体文件 |
| **B站** | 视频 | 需要安装 `yt-dlp` |
| **Twitter/X** | 图片、视频 | 从用户媒体页或单条推文下载 |
| **知乎** | 文章（Markdown） | 导出文章，可选下载图片到本地 |

### 前置依赖

下载流媒体平台的视频需要安装 `yt-dlp`：

```bash
# 安装 yt-dlp
pip install yt-dlp
# 或者
brew install yt-dlp
```

### 使用示例

```bash
# 下载小红书笔记中的图片/视频
opencli xiaohongshu download --note_id abc123 --output ./xhs

# 下载B站视频（需要 yt-dlp）
opencli bilibili download --bvid BV1xxx --output ./bilibili
opencli bilibili download --bvid BV1xxx --quality 1080p  # 指定画质

# 下载 Twitter 用户的媒体
opencli twitter download --username elonmusk --limit 20 --output ./twitter

# 下载单条推文的媒体
opencli twitter download --tweet-url "https://x.com/user/status/123" --output ./twitter

# 导出知乎文章为 Markdown
opencli zhihu download --url "https://zhuanlan.zhihu.com/p/xxx" --output ./zhihu

# 导出文章并下载图片到本地
opencli zhihu download --url "https://zhuanlan.zhihu.com/p/xxx" --download-images
```

### Pipeline Step（用于 YAML 适配器）

`download` step 可以在 YAML 管线中使用：

```yaml
pipeline:
  - fetch: https://api.example.com/media
  - download:
      url: ${{ item.imageUrl }}
      dir: ./downloads
      filename: ${{ item.title | sanitize }}.jpg
      concurrency: 5
      skip_existing: true
```

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

- **"Extension not connected" 报错**
  - 确保你当前的 Chrome 已安装且**开启了** opencli Browser Bridge 扩展（在 `chrome://extensions` 中检查）。
- **返回空数据，或者报错 "Unauthorized"**
  - Chrome 里的登录态可能已经过期。请打开当前 Chrome 页面，在新标签页重新手工登录或刷新该页面。
- **Node API 错误 (如 parseArgs, fs 等)**
  - 确保 Node.js 版本 `>= 20`。
- **Daemon 问题**
  - 检查 daemon 状态：`curl localhost:19825/status`
  - 查看扩展日志：`curl localhost:19825/logs`

## 版本发布

```bash
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0

# 推送 tag，GitHub Actions 将自动执行发版和 npm 发布
git push --follow-tags
```

## License

[Apache-2.0](./LICENSE)
