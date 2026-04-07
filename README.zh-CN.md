# OpenCLI

> **把任何网站、本地工具、Electron 应用变成能够让 AI 调用的命令行！**  
> 零风控 · 复用 Chrome/Chromium 登录 · AI 自动发现接口 · 全能 CLI 枢纽

[![English](https://img.shields.io/badge/docs-English-1D4ED8?style=flat-square)](./README.md)
[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](./LICENSE)

OpenCLI 将任何网站、本地 CLI 或 Electron 应用（如 Antigravity）变成命令行工具 — B站、知乎、小红书、Twitter/X、Reddit、YouTube，以及 `gh`、`docker` 等[多种站点与工具](#内置命令) — 复用浏览器登录态，AI 驱动探索。

**专为 AI Agent 打造**：加载 [`opencli-operate` skill](./skills/opencli-operate/SKILL.md)，赋予 AI Agent（Claude Code、Cursor 等）直接操控浏览器的能力——操作任意网站，并将这些交互沉淀为可复用的 CLI 命令。在 `AGENT.md` 或 `.cursorrules` 中配置 `opencli list`，AI 即可自动发现并调用所有可用工具。

**opencli 支持 CLI 化所有 electron 应用！最强大更新来袭！**
CLI all electron！现在支持把所有 electron 应用 CLI 化，从而组合出各种神奇的能力。
如果你在使用诸如 Antigravity Ultra 等工具时觉得不够灵活或难以扩展，现在通过 OpenCLI 把他 CLI 化，轻松打破界限。
现在，**AI 可以自己控制自己**！结合 cc/openclaw 就可以远程控制任何 electron 应用！无限玩法！！

---

## 亮点

- **CLI All Electron** — 支持把所有 electron 应用（如 Antigravity Ultra）CLI 化，让 AI 控制自己！
- **浏览器自动化** — `operate` 赋予 AI Agent 直接操控浏览器的能力：点击、输入、提取、截图，任意交互皆可脚本化
- **网页转 CLI** — 将任意网站变成确定性命令行工具：79+ 预置适配器，或用 `opencli record` 沉淀自己的操作
- **多站点覆盖** — 79+ 站点，横跨全球与中国平台（B站、知乎、小红书、Reddit、HackerNews 等），并支持通过 CDP 控制桌面 Electron 应用
- **零风控** — 复用 Chrome/Chromium 登录态，无需存储任何凭证
- **外部 CLI 枢纽** — 统一发现、自动安装、透传执行 `gh`、`docker` 等本地 CLI
- **自修复配置** — `opencli doctor` 自动启动 daemon，诊断扩展和浏览器连接状态
- **AI 原生** — `explore` 自动发现 API，`synthesize` 生成适配器，`cascade` 探测认证策略，`operate` 直接控制浏览器
- **零 LLM 成本** — 运行时不消耗任何 token，跑一万次不花一分钱
- **确定性** — 同一命令永远返回同一结构，可管道化、可脚本化、CI 友好

## 前置要求

- **Node.js**: >= 20.0.0
- **Chrome 或 Chromium** 浏览器正在运行，且**已登录目标网站**（如 bilibili.com、zhihu.com、xiaohongshu.com、goofish.com）

> **⚠️ 重要**：大多数命令复用你的 Chrome/Chromium 登录状态。运行命令前，你必须已在 Chrome 或 Chromium 中打开目标网站并完成登录。如果获取到空数据或报错，请先检查你的浏览器登录状态。

OpenCLI 通过轻量化的 **Browser Bridge** Chrome/Chromium 扩展 + 微型 daemon 与浏览器通信（零配置，自动启动）。

### Browser Bridge 扩展配置

你可以选择以下任一方式安装扩展：

**方式一：下载构建好的安装包（推荐）**
1. 到 GitHub [Releases 页面](https://github.com/jackwener/opencli/releases) 下载最新的 `opencli-extension.zip`。
2. 解压后在 Chrome 或 Chromium 中打开 `chrome://extensions`，启用右上角的 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择解压后的文件夹。

**方式二：加载源码（针对开发者）**
1. 同样在 `chrome://extensions` 开启 **开发者模式**。
2. 点击 **加载已解压的扩展程序**，选择本仓库代码树中的 `extension/` 文件夹。

完成！运行任何 opencli 浏览器命令时，后台微型 daemon 会自动启动与浏览器通信。无需配 API Token，零代码配置。

> **Tip**：后续诊断和 daemon 管理：
> ```bash
> opencli doctor            # 检查扩展和 daemon 连通性
> opencli daemon status     # 查看 daemon 状态
> opencli daemon stop       # 停止 daemon
> ```

## 快速开始

### npm 全局安装（推荐）

```bash
npm install -g @jackwener/opencli

# 安装 AI Skills（Claude Code / Cursor）
npx skills add jackwener/opencli
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

### 浏览器自动化 — 让 AI Agent 直接控制浏览器

将 [`skills/opencli-operate/SKILL.md`](./skills/opencli-operate/SKILL.md) 指向你的 AI Agent（Claude Code、Cursor），即可开箱即用，内含完整命令参考与使用示例。

可用命令：`open`、`state`、`click`、`type`、`select`、`keys`、`wait`、`get`、`screenshot`、`scroll`、`back`、`eval`、`network`、`init`、`verify`、`close`。

### 安装 AI Skills

OpenCLI 提供 [skills](./skills/) 供 AI Agent（Claude Code 等）使用：

```bash
# 安装所有 OpenCLI skills
npx skills add jackwener/opencli

# 或安装特定 skill
npx skills add jackwener/opencli --skill opencli-usage      # 命令参考
npx skills add jackwener/opencli --skill opencli-operate     # 浏览器自动化（AI Agent 专用）
npx skills add jackwener/opencli --skill opencli-explorer    # 适配器开发指南
npx skills add jackwener/opencli --skill opencli-oneshot     # 快速命令参考
```

## 内置命令

运行 `opencli list` 查看完整注册表。

| 站点 | 命令 | 模式 |
|------|------|------|
| **twitter** | `trending` `bookmarks` `profile` `search` `timeline` `thread` `following` `followers` `notifications` `post` `reply` `delete` `like` `article` `follow` `unfollow` `bookmark` `unbookmark` `download` `accept` `reply-dm` `block` `unblock` `hide-reply` | 浏览器 |
| **reddit** | `hot` `frontpage` `popular` `search` `subreddit` `read` `user` `user-posts` `user-comments` `upvote` `save` `comment` `subscribe` `saved` `upvoted` | 浏览器 |
| **tieba** | `hot` `posts` `search` `read` | 浏览器 |
| **hupu** | `hot` `search` `detail` `mentions` `reply` `like` `unlike` | 浏览器 |
| **cursor** | `status` `send` `read` `new` `dump` `composer` `model` `extract-code` `ask` `screenshot` `history` `export` | 桌面端 |
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `subtitle` `dynamic` `ranking` `following` `user-videos` `download` | 浏览器 |
| **codex** | `status` `send` `read` `new` `dump` `extract-diff` `model` `ask` `screenshot` `history` `export` | 桌面端 |
| **chatwise** | `status` `new` `send` `read` `ask` `model` `history` `export` `screenshot` | 桌面端 |
| **doubao** | `status` `new` `send` `read` `ask` `history` `detail` `meeting-summary` `meeting-transcript` | 浏览器 |
| **doubao-app** | `status` `new` `send` `read` `ask` `screenshot` `dump` | 桌面端 |
| **notion** | `status` `search` `read` `new` `write` `sidebar` `favorites` `export` | 桌面端 |
| **discord-app** | `status` `send` `read` `channels` `servers` `search` `members` | 桌面端 |
| **v2ex** | `hot` `latest` `topic` `node` `user` `member` `replies` `nodes` `daily` `me` `notifications` | 公开 / 浏览器 |
| **xueqiu** | `feed` `hot-stock` `hot` `search` `stock` `comments` `watchlist` `earnings-date` `fund-holdings` `fund-snapshot` | 浏览器 |
| **antigravity** | `status` `send` `read` `new` `dump` `extract-code` `model` `watch` | 桌面端 |
| **chatgpt** | `status` `new` `send` `read` `ask` `model` | 桌面端 |
| **xiaohongshu** | `search` `notifications` `feed` `user` `download` `publish` `creator-notes` `creator-note-detail` `creator-notes-summary` `creator-profile` `creator-stats` | 浏览器 |
| **xiaoe** | `courses` `detail` `catalog` `play-url` `content` | 浏览器 |
| **apple-podcasts** | `search` `episodes` `top` | 公开 |
| **xiaoyuzhou** | `podcast` `podcast-episodes` `episode` | 公开 |
| **zhihu** | `hot` `search` `question` `download` | 浏览器 |
| **weixin** | `download` | 浏览器 |
| **youtube** | `search` `video` `transcript` | 浏览器 |
| **boss** | `search` `detail` `recommend` `joblist` `greet` `batchgreet` `send` `chatlist` `chatmsg` `invite` `mark` `exchange` `resume` `stats` | 浏览器 |
| **coupang** | `search` `add-to-cart` | 浏览器 |
| **bbc** | `news` | 公共 API |
| **bloomberg** | `main` `markets` `economics` `industries` `tech` `politics` `businessweek` `opinions` `feeds` `news` | 公共 API / 浏览器 |
| **ctrip** | `search` | 浏览器 |
| **devto** | `top` `tag` `user` | 公开 |
| **dictionary** | `search` `synonyms` `examples` | 公开 |
| **arxiv** | `search` `paper` | 公开 |
| **pubmed** | `search` `article` `author` `citations` `related` | 公开 |
| **paperreview** | `submit` `review` `feedback` | 公开 |
| **wikipedia** | `search` `summary` `random` `trending` | 公开 |
| **hackernews** | `top` `new` `best` `ask` `show` `jobs` `search` `user` | 公共 API |
| **jd** | `item` | 浏览器 |
| **linkedin** | `search` `timeline` | 浏览器 |
| **reuters** | `search` | 浏览器 |
| **smzdm** | `search` | 浏览器 |
| **web** | `read` | 浏览器 |
| **weibo** | `hot` `search` `feed` `user` `me` `post` `comments` | 浏览器 |
| **yahoo-finance** | `quote` | 浏览器 |
| **sinafinance** | `news` | 🌐 公开 |
| **barchart** | `quote` `options` `greeks` `flow` | 浏览器 |
| **chaoxing** | `assignments` `exams` | 浏览器 |
| **grok** | `ask` | 浏览器 |
| **hf** | `top` | 公开 |
| **jike** | `feed` `search` `create` `like` `comment` `repost` `notifications` `post` `topic` `user` | 浏览器 |
| **jimeng** | `generate` `history` | 浏览器 |
| **yollomi** | `generate` `video` `edit` `upload` `models` `remove-bg` `upscale` `face-swap` `restore` `try-on` `background` `object-remover` | 浏览器 |
| **linux-do** | `hot` `latest` `feed` `search` `categories` `category` `tags` `topic` `user-posts` `user-topics` | 浏览器 |
| **stackoverflow** | `hot` `search` `bounties` `unanswered` | 公开 |
| **steam** | `top-sellers` | 公开 |
| **weread** | `shelf` `search` `book` `highlights` `notes` `notebooks` `ranking` | 浏览器 |
| **douban** | `search` `top250` `subject` `photos` `download` `marks` `reviews` `movie-hot` `book-hot` | 浏览器 |
| **facebook** | `feed` `profile` `search` `friends` `groups` `events` `notifications` `memories` `add-friend` `join-group` | 浏览器 |
| **google** | `news` `search` `suggest` `trends` | 公开 |
| **amazon** | `bestsellers` `search` `product` `offer` `discussion` `movers-shakers` `new-releases` | 浏览器 |
| **1688** | `search` `item` `store` | 浏览器 |
| **gemini** | `new` `ask` `image` `deep-research` `deep-research-result` | 浏览器 |
| **spotify** | `auth` `status` `play` `pause` `next` `prev` `volume` `search` `queue` `shuffle` `repeat` | OAuth API |
| **notebooklm** | `status` `list` `open` `current` `get` `history` `summary` `note-list` `notes-get` `source-list` `source-get` `source-fulltext` `source-guide` | 浏览器 |
| **36kr** | `news` `hot` `search` `article` | 公开 / 浏览器 |
| **imdb** | `search` `title` `top` `trending` `person` `reviews` | 公开 |
| **producthunt** | `posts` `today` `hot` `browse` | 公开 / 浏览器 |
| **instagram** | `explore` `profile` `search` `user` `followers` `following` `follow` `unfollow` `like` `unlike` `comment` `save` `unsave` `saved` | 浏览器 |
| **lobsters** | `hot` `newest` `active` `tag` | 公开 |
| **medium** | `feed` `search` `user` | 浏览器 |
| **sinablog** | `hot` `search` `article` `user` | 浏览器 |
| **substack** | `feed` `search` `publication` | 浏览器 |
| **pixiv** | `ranking` `search` `user` `illusts` `detail` `download` | 浏览器 |
| **tiktok** | `explore` `search` `profile` `user` `following` `follow` `unfollow` `like` `unlike` `comment` `save` `unsave` `live` `notifications` `friends` | 浏览器 |
| **bluesky** | `search` `trending` `user` `profile` `thread` `feeds` `followers` `following` `starter-packs` | 公开 |
| **xianyu** | `search` `item` `chat` | 浏览器 |
| **douyin** | `videos` `publish` `drafts` `draft` `delete` `stats` `profile` `update` `hashtag` `location` `activities` `collections` | 浏览器 |
| **yuanbao** | `new` `ask` | 浏览器 |

79+ 适配器 — **[→ 查看完整命令列表](./docs/adapters/index.md)**

### 外部 CLI 枢纽

OpenCLI 也可以作为你现有命令行工具的统一入口，负责发现、自动安装和纯透传执行。

| 外部 CLI | 描述 | 示例 |
|----------|------|------|
| **gh** | GitHub CLI | `opencli gh pr list --limit 5` |
| **obsidian** | Obsidian 仓库管理 | `opencli obsidian search query="AI"` |
| **docker** | Docker 命令行工具 | `opencli docker ps` |
| **lark-cli** | 飞书 CLI — 消息、文档、日历、任务，200+ 命令 | `opencli lark-cli calendar +agenda` |
| **dingtalk** | 钉钉 CLI — 钉钉全套产品能力的跨平台命令行工具，支持人类和 AI Agent 使用 | `opencli dingtalk msg send --to user "hello"` |
| **wecom** | 企业微信 CLI — 企业微信开放平台命令行工具，支持人类和 AI Agent 使用 | `opencli wecom msg send --to user "hello"` |
| **vercel** | Vercel — 部署项目、管理域名、环境变量、日志 | `opencli vercel deploy --prod` |

**零配置透传**：OpenCLI 会把你的输入原样转发给底层二进制，保留原生 stdout / stderr 行为。

**自动安装**：如果你运行 `opencli gh ...` 时系统中还没有 `gh`，OpenCLI 会优先尝试通过系统包管理器安装，然后自动重试命令。

**注册自定义本地 CLI**：

```bash
opencli register mycli
```

### 桌面应用适配器

每个桌面适配器都有自己详细的文档说明，包括命令参考、启动配置与使用示例：

| 应用 | 描述 | 文档 |
|-----|-------------|-----|
| **Cursor** | 控制 Cursor IDE — Composer、对话、代码提取等 | [Doc](./docs/adapters/desktop/cursor.md) |
| **Codex** | 在后台（无头）驱动 OpenAI Codex CLI Agent | [Doc](./docs/adapters/desktop/codex.md) |
| **Antigravity** | 在终端直接控制 Antigravity Ultra | [Doc](./docs/adapters/desktop/antigravity.md) |
| **ChatGPT** | 自动化操作 ChatGPT macOS 桌面客户端 | [Doc](./docs/adapters/desktop/chatgpt.md) |
| **ChatWise** | 多 LLM 客户端（GPT-4、Claude、Gemini） | [Doc](./docs/adapters/desktop/chatwise.md) |
| **Notion** | 搜索、读取、写入 Notion 页面 | [Doc](./docs/adapters/desktop/notion.md) |
| **Discord** | Discord 桌面版 — 消息、频道、服务器 | [Doc](./docs/adapters/desktop/discord.md) |
| **Doubao** | 通过 CDP 控制豆包桌面应用 | [Doc](./docs/adapters/desktop/doubao-app.md) |

## 下载支持

OpenCLI 支持从各平台下载图片、视频和文章。

### 支持的平台

| 平台 | 内容类型 | 说明 |
|------|----------|------|
| **小红书** | 图片、视频 | 下载笔记中的所有媒体文件 |
| **B站** | 视频 | 需要安装 `yt-dlp` |
| **Twitter/X** | 图片、视频 | 从用户媒体页或单条推文下载 |
| **Pixiv** | 图片 | 下载原始画质插画，支持多页作品 |
| **知乎** | 文章（Markdown） | 导出文章，可选下载图片到本地 |
| **微信公众号** | 文章（Markdown） | 导出微信公众号文章为 Markdown |
| **豆瓣** | 图片 | 下载电影条目的海报 / 剧照图片 |

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
opencli xiaohongshu download abc123 --output ./xhs

# 下载B站视频（需要 yt-dlp）
opencli bilibili download BV1xxx --output ./bilibili
opencli bilibili download BV1xxx --quality 1080p  # 指定画质

# 下载 Twitter 用户的媒体
opencli twitter download elonmusk --limit 20 --output ./twitter

# 下载单条推文的媒体
opencli twitter download --tweet-url "https://x.com/user/status/123" --output ./twitter

# 下载豆瓣电影海报 / 剧照
opencli douban download 30382501 --output ./douban

# 导出知乎文章为 Markdown
opencli zhihu download "https://zhuanlan.zhihu.com/p/xxx" --output ./zhihu

# 导出并下载图片
opencli zhihu download "https://zhuanlan.zhihu.com/p/xxx" --download-images

# 导出微信公众号文章为 Markdown
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --output ./weixin
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

## 退出码

opencli 遵循 Unix `sysexits.h` 惯例，可无缝接入 shell 管道和 CI 脚本：

| 退出码 | 含义 | 触发场景 |
|--------|------|----------|
| `0` | 成功 | 命令正常完成 |
| `1` | 通用错误 | 未分类的意外错误 |
| `2` | 用法错误 | 参数错误或未知命令 |
| `66` | 无数据 | 命令返回空结果（`EX_NOINPUT`） |
| `69` | 服务不可用 | Browser Bridge 未连接（`EX_UNAVAILABLE`） |
| `75` | 临时失败 | 命令超时，可重试（`EX_TEMPFAIL`） |
| `77` | 需要认证 | 未登录目标网站（`EX_NOPERM`） |
| `78` | 配置错误 | 凭证缺失或配置有误（`EX_CONFIG`） |
| `130` | 中断 | Ctrl-C / SIGINT |

```bash
opencli bilibili hot 2>/dev/null
case $? in
  0)   echo "ok" ;;
  69)  echo "请先启动 Browser Bridge" ;;
  77)  echo "请先登录 bilibili.com" ;;
esac
```

## 插件

通过社区贡献的插件扩展 OpenCLI。插件使用与内置命令相同的 YAML/TS 格式，启动时自动发现。

```bash
opencli plugin install github:user/opencli-plugin-my-tool  # 安装
opencli plugin list                                         # 查看已安装
opencli plugin update my-tool                               # 更新到最新
opencli plugin update --all                                 # 更新全部已安装插件
opencli plugin uninstall my-tool                            # 卸载
```

当 plugin 的版本被记录到 `~/.opencli/plugins.lock.json` 后，`opencli plugin list` 也会显示对应的短 commit hash。

| 插件 | 类型 | 描述 |
|------|------|------|
| [opencli-plugin-github-trending](https://github.com/ByteYue/opencli-plugin-github-trending) | YAML | GitHub Trending 仓库 |
| [opencli-plugin-hot-digest](https://github.com/ByteYue/opencli-plugin-hot-digest) | TS | 多平台热榜聚合 |
| [opencli-plugin-juejin](https://github.com/Astro-Han/opencli-plugin-juejin) | YAML | 稀土掘金热门文章 |

详见 [插件指南](./docs/zh/guide/plugins.md) 了解如何创建自己的插件。

## 致 AI Agent（开发者指南）

如果你是一个被要求查阅代码并编写新 `opencli` 适配器的 AI，请遵守以下工作流。

> **快速模式**：只想为某个页面快速生成一个命令？看 [opencli-oneshot skill](./skills/opencli-oneshot/SKILL.md) — 给一个 URL + 一句话描述，4 步搞定。

> **完整模式**：在编写任何新代码前，先阅读 [opencli-explorer skill](./skills/opencli-explorer/SKILL.md)。它包含完整的适配器探索开发指南、API 探测流程、5级认证策略以及常见陷阱。

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
  - 确保你当前的 Chrome 或 Chromium 已安装且**开启了** opencli Browser Bridge 扩展（在 `chrome://extensions` 中检查）。
- **"attach failed: Cannot access a chrome-extension:// URL" 报错**
  - 其他 Chrome/Chromium 扩展（如 youmind、New Tab Override 或 AI 助手类扩展）可能产生冲突。请尝试**暂时禁用其他扩展**后重试。
- **返回空数据，或者报错 "Unauthorized"**
  - Chrome/Chromium 里的登录态可能已经过期。请打开当前页面，在新标签页重新手工登录或刷新该页面。
- **Node API 错误 (如 parseArgs, fs 等)**
  - 确保 Node.js 版本 `>= 20`。
- **Daemon 问题**
  - 检查 daemon 状态：`curl localhost:19825/status`
  - 查看扩展日志：`curl localhost:19825/logs`


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jackwener/opencli&type=Date)](https://star-history.com/#jackwener/opencli&Date)



## License

[Apache-2.0](./LICENSE)
