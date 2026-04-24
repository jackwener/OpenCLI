# OpenCLI

> **把网站、浏览器会话、Electron 应用和本地工具，统一变成适合人类与 AI Agent 使用的确定性接口。**  
> 复用浏览器登录态，先自动化真实操作，再把高频流程沉淀成可复用的 CLI 命令。

[![English](https://img.shields.io/badge/docs-English-1D4ED8?style=flat-square)](./README.md)
[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](./LICENSE)

OpenCLI 可以用同一套 CLI 做三类事情：

- **直接使用现成适配器**：B站、知乎、小红书、Twitter/X、Reddit、HackerNews 等 [90+ 站点](#内置命令) 开箱即用。
- **让 AI Agent 操作任意网站**：在你的 AI Agent（Claude Code、Cursor 等）中安装 `opencli-adapter-author` skill，Agent 就能用你的已登录浏览器导航、点击、输入、提取任意网页内容。
- **把新网站写成 CLI**：用 `opencli browser` 原语 + `opencli-adapter-author` skill，从站点侦察、API 发现、字段解码到 `opencli browser verify` 一条龙。

除了网站能力，OpenCLI 还是一个 **CLI 枢纽**：你可以把 `gh`、`docker` 等本地工具统一注册到 `opencli` 下，也可以通过桌面端适配器控制 Cursor、Codex、Antigravity、ChatGPT、Notion 等 Electron 应用。

## 亮点

- **桌面应用控制** — 通过 CDP 直接在终端驱动 Electron 应用（Cursor、Codex、ChatGPT、Notion 等）。
- **AI Agent 浏览器自动化** — 安装 `opencli-adapter-author` skill，你的 AI Agent 就能操作任意网站：导航、点击、输入、提取、截图——全部通过你的已登录 Chrome 会话完成。
- **网站 → CLI** — 把任何网站变成确定性 CLI：90+ 内置适配器，或用 `opencli-adapter-author` skill + `opencli browser verify` 自己写。
- **账号安全** — 复用 Chrome/Chromium 登录态，凭证永远不会离开浏览器。
- **面向 AI Agent** — 一个 skill 带你走完站点侦察、API 发现、字段解码、适配器编写、验证的全流程。
- **CLI 枢纽** — 统一发现、自动安装、纯透传任何外部 CLI（gh、docker、obsidian 等）。
- **零 LLM 成本** — 运行时不消耗模型 token，跑 10,000 次也不花一分钱。
- **确定性输出** — 相同命令，相同输出结构，每次一致。可管道、可脚本、CI 友好。

## 快速开始

### 1. 安装 OpenCLI

```bash
npm install -g @jackwener/opencli
```

### 2. 安装 Browser Bridge 扩展

OpenCLI 通过轻量 Browser Bridge 扩展和本地微型 daemon 与 Chrome/Chromium 通信。daemon 会按需自动启动。

1. 到 GitHub [Releases 页面](https://github.com/jackwener/opencli/releases) 下载最新的 `opencli-extension-v{version}.zip`。
2. 解压后打开 `chrome://extensions`，启用 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择解压后的目录。

### 3. 验证环境

```bash
opencli doctor
```

### 4. 跑第一个命令

```bash
opencli list
opencli hackernews top --limit 5
opencli bilibili hot --limit 5
```

## 给人类用户

如果你只是想稳定地调用网站或桌面应用能力，主路径很简单：

- `opencli list` 查看当前所有命令
- `opencli <site> <command>` 调用内置或生成好的适配器
- `opencli register mycli` 把本地 CLI 接入同一发现入口
- `opencli doctor` 处理浏览器连通性问题

## 给 AI Agent

OpenCLI 的 browser 命令是给 AI Agent 用的——不是手动执行的。把 skill 安装到你的 AI Agent（Claude Code、Cursor 等）中，Agent 就能用你的已登录 Chrome 会话替你操作网站。

### 安装 skill

```bash
npx skills add jackwener/opencli
```

或只装需要的 skill：

```bash
npx skills add jackwener/opencli --skill opencli-adapter-author
npx skills add jackwener/opencli --skill opencli-autofix
npx skills add jackwener/opencli --skill opencli-browser
npx skills add jackwener/opencli --skill opencli-usage
npx skills add jackwener/opencli --skill smart-search
```

### 选择哪个 skill

| Skill | 适用场景 | 你对 AI Agent 说的话 |
|-------|---------|-------------------|
| **opencli-adapter-author** | 实时操作任意网站，或为新站点写可复用适配器 | "帮我看看小红书的通知" / "帮我做一个抖音热门的适配器" / "帮我做一个抓取这个页面热帖的命令" |
| **opencli-autofix** | 内置命令失败时修复已有适配器 | "`opencli zhihu hot` 返回空了，修一下" |
| **opencli-browser** | 浏览器自动化参考文档 | "用浏览器命令抓取这个页面" |
| **opencli-usage** | 所有命令和站点的快速参考 | "OpenCLI 有哪些 Twitter 相关的命令？" |
| **smart-search** | 在现有 OpenCLI 能力里搜索 | "帮我找个 B 站热门相关的适配器" |

### 工作原理

安装 `opencli-adapter-author` skill 后，你的 AI Agent 可以：

1. **导航**到任意 URL，使用你的已登录浏览器
2. **读取**页面内容——通过结构化 DOM 快照（不是截图）
3. **交互**——点击按钮、填写表单、选择选项、按键
4. **提取**页面数据或拦截网络 API 响应
5. **等待**元素、文本或页面跳转

Agent 在内部自动处理所有 `opencli browser` 命令——你只需用自然语言描述想做的事。

**Skill 参考文档：**
- [`skills/opencli-adapter-author/SKILL.md`](./skills/opencli-adapter-author/SKILL.md) — 浏览器操作 + 适配器编写，全流程
- [`skills/opencli-autofix/SKILL.md`](./skills/opencli-autofix/SKILL.md) — 修复已有适配器
- [`skills/opencli-browser/SKILL.md`](./skills/opencli-browser/SKILL.md) — 浏览器自动化参考
- [`skills/opencli-usage/SKILL.md`](./skills/opencli-usage/SKILL.md) — 命令和站点参考
- [`skills/smart-search/SKILL.md`](./skills/smart-search/SKILL.md) — 能力搜索

`browser` 可用命令包括：`open`、`state`、`click`、`type`、`select`、`keys`、`wait`、`get`、`find`、`extract`、`frames`、`screenshot`、`scroll`、`back`、`eval`、`network`、`tab list`、`tab new`、`tab select`、`tab close`、`init`、`verify`、`close`。

`opencli browser open <url>` 和 `opencli browser tab new [url]` 都会返回 target ID。`opencli browser tab list` 用来查看当前已存在 tab 的 target ID，再通过 `--tab <targetId>` 把命令明确路由到某个 tab。`tab new` 只会新建 tab，不会改变默认浏览器目标；只有显式执行 `tab select <targetId>`，才会把该 tab 设为后续未指定 target 的 `opencli browser ...` 命令的默认目标。

## 核心概念

### `browser`：AI Agent 的浏览器控制层

`opencli browser` 命令是 AI Agent 操作网站的底层原语。你不需要手动运行这些命令——把 `opencli-adapter-author` skill 安装到你的 AI Agent 中，用自然语言描述你想做的事，Agent 会自动处理浏览器操作。

比如你告诉 Agent：*"帮我看看小红书的通知"*——Agent 会在底层调用 `opencli browser open`、`state`、`click` 等命令。

### 内置适配器：稳定命令

当某个站点能力已经存在时，优先使用 `opencli hackernews top`、`opencli reddit hot` 这类稳定命令。这些命令是确定性的，无需浏览器——人类和 AI Agent 都可以直接使用。

### 为新站点写适配器

当你需要的网站还没覆盖时，用 `opencli-adapter-author` skill，它会把 Agent 带到闭环：

1. 侦察站点，分类 pattern（SPA / SSR / JSONP / Token / Streaming）
2. 发现目标 endpoint——network 精读、initial state、bundle 搜索、token 溯源，或 interceptor 兜底
3. 定认证策略——`PUBLIC` / `COOKIE` / `HEADER` / `INTERCEPT`
4. 字段解码 + 设计输出列
5. `opencli browser init <site>/<name>` → 写适配器 → `opencli browser verify <site>/<name>`
6. 把站点知识沉到 `~/.opencli/sites/<site>/`，下次写同站点的其他命令直接吃缓存

### CLI 枢纽与桌面端适配器

OpenCLI 不只是网站 CLI，还可以：

- 统一代理本地二进制工具，例如 `gh`、`docker`、`obsidian`
- 通过专门适配器和 CDP 集成控制 Electron 桌面应用

## 前置要求

- **Node.js**: >= 21.0.0
- 浏览器型命令需要 Chrome 或 Chromium 处于运行中，并已登录目标网站

> **重要**：浏览器型命令直接复用你的 Chrome/Chromium 登录态。如果拿到空数据或出现权限类失败，先确认目标站点已经在浏览器里打开并完成登录。

## 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLI_DAEMON_PORT` | `19825` | daemon-extension 通信端口 |
| `OPENCLI_WINDOW_FOCUSED` | `false` | 设为 `1` 时 automation 窗口在前台打开（适合调试）。`--focus` 标志会设置此变量 |
| `OPENCLI_LIVE` | `false` | 设为 `1` 时 adapter 命令执行完后保留 automation 窗口不关闭（适合检查页面）。`--live` 标志会设置此变量 |
| `OPENCLI_BROWSER_CONNECT_TIMEOUT` | `30` | 浏览器连接超时（秒） |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | `60` | 单个浏览器命令超时（秒） |
| `OPENCLI_CDP_ENDPOINT` | — | Chrome DevTools Protocol 端点，用于远程浏览器或 Electron 应用 |
| `OPENCLI_CDP_TARGET` | — | 按 URL 子串过滤 CDP target（如 `detail.1688.com`） |
| `OPENCLI_VERBOSE` | `false` | 启用详细日志（`-v` 也可以） |
| `OPENCLI_DIAGNOSTIC` | `false` | 设为 `1` 时在失败时输出结构化诊断上下文 |
| `DEBUG_SNAPSHOT` | — | 设为 `1` 输出 DOM 快照调试信息 |

`--focus` 同时适用于 `opencli browser *` 和浏览器型 adapter 命令。`--live` 主要是给 adapter 命令用的：`browser` 子命令本来就会一直保留 automation window，直到你手动执行 `opencli browser close` 或等空闲超时。

## 更新

```bash
npm install -g @jackwener/opencli@latest

# 如果你在用打包发布的 OpenCLI skills，也一起刷新
npx skills add jackwener/opencli
```

如果你只装了部分 skill，也可以只刷新自己在用的：

```bash
npx skills add jackwener/opencli --skill opencli-adapter-author
npx skills add jackwener/opencli --skill opencli-autofix
npx skills add jackwener/opencli --skill smart-search
```

## 面向开发者

从源码安装：

```bash
git clone git@github.com:jackwener/opencli.git
cd opencli
npm install
npm run build
npm link
```

加载源码版 Browser Bridge 扩展：

1. 打开 `chrome://extensions` 并启用 **开发者模式**
2. 点击 **加载已解压的扩展程序**，选择本仓库里的 `extension/` 目录

## 内置命令

运行 `opencli list` 查看完整注册表。

| 站点 | 命令 | 模式 |
|------|------|------|
| **twitter** | `trending` `search` `timeline` `tweets` `lists` `list-tweets` `list-add` `list-remove` `bookmarks` `profile` `thread` `following` `followers` `notifications` `post` `reply` `delete` `like` `likes` `article` `follow` `unfollow` `bookmark` `unbookmark` `download` `accept` `reply-dm` `block` `unblock` `hide-reply` | 浏览器 |
| **reddit** | `hot` `frontpage` `popular` `search` `subreddit` `read` `user` `user-posts` `user-comments` `upvote` `save` `comment` `subscribe` `saved` `upvoted` | 浏览器 |
| **tieba** | `hot` `posts` `search` `read` | 浏览器 |
| **hupu** | `hot` `search` `detail` `mentions` `reply` `like` `unlike` | 浏览器 |
| **cursor** | `status` `send` `read` `new` `dump` `composer` `model` `extract-code` `ask` `screenshot` `history` `export` | 桌面端 |
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `subtitle` `video` `comments` `dynamic` `ranking` `following` `user-videos` `download` | 浏览器 |
| **codex** | `status` `send` `read` `new` `dump` `extract-diff` `model` `ask` `screenshot` `history` `export` | 桌面端 |
| **chatwise** | `status` `new` `send` `read` `ask` `model` `history` `export` `screenshot` | 桌面端 |
| **doubao** | `status` `new` `send` `read` `ask` `history` `detail` `meeting-summary` `meeting-transcript` | 浏览器 |
| **doubao-app** | `status` `new` `send` `read` `ask` `screenshot` `dump` | 桌面端 |
| **notion** | `status` `search` `read` `new` `write` `sidebar` `favorites` `export` | 桌面端 |
| **discord-app** | `status` `send` `read` `channels` `servers` `search` `members` | 桌面端 |
| **v2ex** | `hot` `latest` `topic` `node` `user` `member` `replies` `nodes` `daily` `me` `notifications` | 公开 / 浏览器 |
| **xueqiu** | `feed` `hot-stock` `hot` `search` `stock` `comments` `watchlist` `earnings-date` `fund-holdings` `fund-snapshot` | 浏览器 |
| **antigravity** | `status` `send` `read` `new` `dump` `extract-code` `model` `watch` `serve` | 桌面端 |
| **chatgpt-app** | `status` `new` `send` `read` `ask` `model` | 桌面端 |
| **xiaohongshu** | `search` `note` `comments` `notifications` `feed` `user` `download` `publish` `creator-notes` `creator-note-detail` `creator-notes-summary` `creator-profile` `creator-stats` | 浏览器 |
| **xiaoe** | `courses` `detail` `catalog` `play-url` `content` | 浏览器 |
| **quark** | `ls` `mkdir` `mv` `rename` `rm` `save` `share-tree` | 浏览器 |
| **uiverse** | `code` `preview` | 浏览器 |
| **apple-podcasts** | `search` `episodes` `top` | 公开 |
| **baidu-scholar** | `search` | 公开 |
| **google-scholar** | `search` | 公开 |
| **gov-law** | `search` `recent` | 公开 |
| **gov-policy** | `search` `recent` | 公开 |
| **nowcoder** | `hot` `trending` `topics` `recommend` `creators` `companies` `jobs` `search` `suggest` `experience` `referral` `salary` `papers` `practice` `notifications` `detail` | 公开 / 浏览器 |
| **wanfang** | `search` | 公开 |
| **xiaoyuzhou** | `podcast*` `podcast-episodes*` `episode*` `download*` `transcript*` `auth` | 本地凭证 |
| **zhihu** | `hot` `search` `question` `download` `follow` `like` `favorite` `comment` `answer` | 浏览器 |
| **weixin** | `download` | 浏览器 |
| **youtube** | `search` `video` `transcript` `comments` `channel` `playlist` `feed` `history` `watch-later` `subscriptions` `like` `unlike` `subscribe` `unsubscribe` | 浏览器 |
| **boss** | `search` `detail` `recommend` `joblist` `greet` `batchgreet` `send` `chatlist` `chatmsg` `invite` `mark` `exchange` `resume` `stats` | 浏览器 |
| **coupang** | `search` `add-to-cart` | 浏览器 |
| **bbc** | `news` | 公共 API |
| **bloomberg** | `main` `markets` `economics` `industries` `tech` `politics` `businessweek` `opinions` `feeds` `news` | 公共 API / 浏览器 |
| **ctrip** | `search` | 浏览器 |
| **devto** | `top` `tag` `user` | 公开 |
| **dictionary** | `search` `synonyms` `examples` | 公开 |
| **arxiv** | `search` `paper` | 公开 |
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
| **grok** | `ask` `image` | 浏览器 |
| **hf** | `top` | 公开 |
| **jike** | `feed` `search` `create` `like` `comment` `repost` `notifications` `post` `topic` `user` | 浏览器 |
| **jimeng** | `generate` `history` | 浏览器 |
| **yollomi** | `generate` `video` `edit` `upload` `models` `remove-bg` `upscale` `face-swap` `restore` `try-on` `background` `object-remover` | 浏览器 |
| **linux-do** | `hot` `latest` `feed` `search` `categories` `category` `tags` `topic` `topic-content` `user-posts` `user-topics` | 浏览器 |
| **stackoverflow** | `hot` `search` `bounties` `unanswered` | 公开 |
| **steam** | `top-sellers` | 公开 |
| **weread** | `shelf` `search` `book` `highlights` `notes` `notebooks` `ranking` | 浏览器 |
| **douban** | `search` `top250` `subject` `photos` `download` `marks` `reviews` `movie-hot` `book-hot` | 浏览器 |
| **facebook** | `feed` `profile` `search` `friends` `groups` `events` `notifications` `memories` `add-friend` `join-group` | 浏览器 |
| **google** | `news` `search` `suggest` `trends` | 公开 |
| **amazon** | `bestsellers` `search` `product` `offer` `discussion` `movers-shakers` `new-releases` `rankings` | 浏览器 |
| **1688** | `search` `item` `assets` `download` `store` | 浏览器 |
| **gitee** | `trending` `search` `user` | 公开 / 浏览器 |
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

90+ 适配器 — **[→ 查看完整命令列表](./docs/adapters/index.md)**

`*` `opencli xiaoyuzhou podcast`、`podcast-episodes`、`episode`、`download`、`transcript` 需要本地小宇宙凭证：`~/.opencli/xiaoyuzhou.json`。

### 外部 CLI 枢纽

OpenCLI 也可以作为你现有命令行工具的统一入口，负责发现、自动安装和纯透传执行。

| 外部 CLI | 描述 | 示例 |
|----------|------|------|
| **gh** | GitHub CLI | `opencli gh pr list --limit 5` |
| **obsidian** | Obsidian 仓库管理 | `opencli obsidian search query="AI"` |
| **docker** | Docker 命令行工具 | `opencli docker ps` |
| **lark-cli** | 飞书 CLI — 消息、文档、日历、任务，200+ 命令 | `opencli lark-cli calendar +agenda` |
| **dws** | 钉钉 CLI — 钉钉全套产品能力的跨平台命令行工具，支持人类和 AI Agent 使用 | `opencli dws msg send --to user "hello"` |
| **wecom-cli** | 企业微信 CLI — 企业微信开放平台命令行工具，支持人类和 AI Agent 使用 | `opencli wecom-cli msg send --to user "hello"` |
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
| **ChatGPT App** | 自动化操作 ChatGPT macOS 桌面客户端 | [Doc](./docs/adapters/desktop/chatgpt-app.md) |
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
| **1688** | 图片、视频 | 下载商品页中可见的商品素材 |
| **小宇宙** | 音频、转录 | 使用本地凭证下载单集音频和转录 JSON / 文本 |
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
opencli xiaohongshu download "https://www.xiaohongshu.com/search_result/<id>?xsec_token=..." --output ./xhs
opencli xiaohongshu download "https://xhslink.com/..." --output ./xhs

# 下载B站视频（需要 yt-dlp）
opencli bilibili download BV1xxx --output ./bilibili
opencli bilibili download BV1xxx --quality 1080p  # 指定画质

# 下载 Twitter 用户的媒体
opencli twitter download elonmusk --limit 20 --output ./twitter

# 下载单条推文的媒体
opencli twitter download --tweet-url "https://x.com/user/status/123" --output ./twitter

# 下载豆瓣电影海报 / 剧照
opencli douban download 30382501 --output ./douban

# 下载 1688 商品页中的图片 / 视频素材
opencli 1688 download 841141931191 --output ./1688-downloads

# 下载小宇宙单集音频
opencli xiaoyuzhou download 69b3b675772ac2295bfc01d0 --output ./xiaoyuzhou

# 下载小宇宙单集转录
opencli xiaoyuzhou transcript 69dd0c98e2c8be31551f6a33 --output ./xiaoyuzhou-transcripts

# 导出知乎文章为 Markdown
opencli zhihu download "https://zhuanlan.zhihu.com/p/xxx" --output ./zhihu

# 导出并下载图片
opencli zhihu download "https://zhuanlan.zhihu.com/p/xxx" --download-images

# 导出微信公众号文章为 Markdown
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --output ./weixin
```

`opencli xiaoyuzhou download` 和 `transcript` 需要本地小宇宙凭证：`~/.opencli/xiaoyuzhou.json`。



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

通过社区贡献的插件扩展 OpenCLI。插件使用与内置命令相同的 JS 格式，启动时自动发现。

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
| [opencli-plugin-github-trending](https://github.com/ByteYue/opencli-plugin-github-trending) | JS | GitHub Trending 仓库 |
| [opencli-plugin-hot-digest](https://github.com/ByteYue/opencli-plugin-hot-digest) | JS | 多平台热榜聚合 |
| [opencli-plugin-juejin](https://github.com/Astro-Han/opencli-plugin-juejin) | JS | 稀土掘金热门文章 |
| [opencli-plugin-vk](https://github.com/flobo3/opencli-plugin-vk) | JS | VK (VKontakte) 动态、信息流和搜索 |

详见 [插件指南](./docs/zh/guide/plugins.md) 了解如何创建自己的插件。

## 致 AI Agent（开发者指南）

如果你是一个被要求查阅代码并编写新 `opencli` 适配器的 AI，请遵守以下工作流。

在动代码前，先读 [`opencli-adapter-author` skill](./skills/opencli-adapter-author/SKILL.md)。它把整个流程串起来：

- 侦察站点，选定 pattern（SPA / SSR / JSONP / Token / Streaming）
- 用 `opencli browser network`、`eval`、interceptor 等找到目标 endpoint
- 定认证策略（`PUBLIC` / `COOKIE` / `HEADER` / `INTERCEPT`）
- 字段解码、设计 columns、`opencli browser init` 生成骨架
- 交付前用 `opencli browser verify <site>/<name>` 验证

在仓库外写的私有适配器放到 `~/.opencli/clis/<site>/<name>.js`；每个站点的 endpoint、字段映射、抓包样本会累积在 `~/.opencli/sites/<site>/`，下次写同站点的其他命令可以直接复用。

## 常见问题排查

- **"Extension not connected" 报错**
  - 确保你当前的 Chrome 或 Chromium 已安装且**开启了** opencli Browser Bridge 扩展（在 `chrome://extensions` 中检查）。
- **"attach failed: Cannot access a chrome-extension:// URL" 报错**
  - 其他 Chrome/Chromium 扩展（如 youmind、New Tab Override 或 AI 助手类扩展）可能产生冲突。请尝试**暂时禁用其他扩展**后重试。
- **返回空数据，或者报错 "Unauthorized"**
  - Chrome/Chromium 里的登录态可能已经过期。请打开当前页面，在新标签页重新手工登录或刷新该页面。
- **Node API 错误 (如 parseArgs, fs 等)**
  - 确保 Node.js 版本 `>= 21`（`node:util` 的 `styleText` 需要 Node 21+）。
- **Daemon 问题**
  - 检查 daemon 状态：`curl localhost:19825/status`
  - 查看扩展日志：`curl localhost:19825/logs`


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jackwener/opencli&type=Date)](https://star-history.com/#jackwener/opencli&Date)



## License

[Apache-2.0](./LICENSE)
