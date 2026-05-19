# OpenCLI

> **把任意网站变成 CLI & 在你的登录态浏览器上跑 Browser Use。**
> 把网站、浏览器会话、Electron 应用和本地工具，统一变成适合人类与 AI Agent 使用的确定性接口。
> 或者在任意页面上跑 Browser Use —— 导航、填表单、点击、抓取、自动化。

[![English](https://img.shields.io/badge/docs-English-1D4ED8?style=flat-square)](./README.md)
[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](./LICENSE)

OpenCLI 可以用同一套 CLI 做三类事情：

- **直接使用现成适配器**：B站、知乎、小红书、Twitter/X、Reddit、HackerNews 等 [100+ 站点](#内置命令) 开箱即用。
- **让 AI Agent 操作任意网站**：在你的 AI Agent（Claude Code、Cursor 等）中安装 `opencli-browser` skill，Agent 就能用你的已登录浏览器导航、点击、输入/填充、提取任意网页内容。
- **把新网站写成 CLI**：用 `opencli browser` 原语 + `opencli-adapter-author` skill，从站点侦察、API 发现、字段解码到 `opencli browser verify` 一条龙。

除了网站能力，OpenCLI 还是一个 **CLI 枢纽**：你可以把 `gh`、`docker`、`longbridge`、`tg`、`discord`、`wx`、`ntn`（Notion）等本地工具统一注册到 `opencli` 下，也可以通过桌面端适配器控制 Cursor、Codex、Antigravity、ChatGPT 等 Electron 应用。

## 快速开始

### 1. 安装 OpenCLI

OpenCLI 要求 **Node.js >= 21**。

```bash
node --version
npm install -g @jackwener/opencli
```

### 2. 安装 Browser Bridge 扩展

OpenCLI 通过轻量 Browser Bridge 扩展和本地微型 daemon 与 Chrome/Chromium 通信。daemon 会按需自动启动。

**方式 A — Chrome Web Store（推荐）：**
在 [Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) 安装 **OpenCLI** 扩展。

**方式 B — 手动安装：**
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
- `opencli external register mycli` 把本地 CLI 接入同一发现入口
- `opencli doctor` 处理浏览器连通性问题

## 扩展 OpenCLI

如果你想新增自己的命令，先看 [扩展 OpenCLI](./docs/zh/guide/extending-opencli.md)。README 只保留入口；目录结构、源码管理方式和安装命令放在文档里。

| 需求 | 推荐路径 |
|------|----------|
| 把个人网站命令放在自己的 Git repo | `opencli plugin create` + `opencli plugin install file://...` |
| 快速写一个本机私人 adapter | `opencli browser init <site>/<command>`，放在 `~/.opencli/clis/` |
| 本地修改官方 adapter | `opencli adapter eject <site>` + `opencli adapter reset <site>` |
| 发布或安装第三方命令 | `opencli plugin install github:user/repo` |
| 包装已有本机 binary | `opencli external register <name>` |

## 给 AI Agent

OpenCLI 的 browser 命令是给 AI Agent 用的——不是手动执行的。把 skill 安装到你的 AI Agent（Claude Code、Cursor 等）中，Agent 就能用你的已登录 Chrome 会话替你操作网站。

### 安装 skill（同时也用于更新）

```bash
npx skills add jackwener/opencli
```

或只装需要的 skill：

```bash
npx skills add jackwener/opencli --skill opencli-adapter-author
npx skills add jackwener/opencli --skill opencli-autofix
npx skills add jackwener/opencli --skill opencli-browser
npx skills add jackwener/opencli --skill opencli-usage
```

### 选择哪个 skill

| Skill | 适用场景 | 你对 AI Agent 说的话 |
|-------|---------|-------------------|
| **opencli-adapter-author** | 为新站点写可复用适配器，或给已有站点添加命令 | "帮我做一个抖音热门的适配器" / "帮我做一个抓取这个页面热帖的命令" |
| **opencli-autofix** | 内置命令失败时修复已有适配器 | "`opencli zhihu hot` 返回空了，修一下" |
| **opencli-browser** | 实时驱动 Chrome 页面——导航、填表单、点击、抓取 | "帮我看看小红书的通知" / "帮我填一下这个表单" / "用浏览器命令抓取这个页面" |
| **opencli-usage** | 所有命令和站点的快速参考 | "OpenCLI 有哪些 Twitter 相关的命令？" |

### 工作原理

安装 `opencli-browser` skill 后，你的 AI Agent 可以：

1. **导航**到任意 URL，使用你的已登录浏览器
2. **读取**页面内容——通过结构化 DOM 快照（不是截图）
3. **交互**——点击按钮、填写表单、选择选项、按键
4. **提取**页面数据或拦截网络 API 响应
5. **等待**元素、文本或页面跳转

Agent 在内部自动处理所有 `opencli browser` 命令——你只需用自然语言描述想做的事。

**Skill 参考文档：**
- [`skills/opencli-browser/SKILL.md`](./skills/opencli-browser/SKILL.md) — 实时驱动 Chrome（导航、填表单、点击、抓取）
- [`skills/opencli-adapter-author/SKILL.md`](./skills/opencli-adapter-author/SKILL.md) — 给新站点写适配器，全流程
- [`skills/opencli-autofix/SKILL.md`](./skills/opencli-autofix/SKILL.md) — 修复已有适配器
- [`skills/opencli-usage/SKILL.md`](./skills/opencli-usage/SKILL.md) — 命令和站点参考

`browser` 可用命令包括：`open`、`state`、`click`、`type`、`fill`、`select`、`keys`、`wait`、`get`、`find`、`extract`、`frames`、`screenshot`、`scroll`、`back`、`eval`、`network`、`tab list`、`tab new`、`tab select`、`tab close`、`init`、`verify`、`close`。

`opencli browser` 命令必须紧跟一个 `<session>` 位置参数。`opencli browser work open <url>` 和 `opencli browser work tab new [url]` 都会返回 target ID。`opencli browser work tab list` 用来查看当前已存在 tab 的 target ID，再通过 `--tab <targetId>` 把命令明确路由到某个 tab。`tab new` 只会新建 tab，不会改变默认浏览器目标；只有显式执行 `tab select <targetId>`，才会把该 tab 设为同一 session 后续未指定 target 的默认目标。

## 为新站点写适配器

当你需要的网站还没覆盖时，用 `opencli-adapter-author` skill，全流程：

1. **侦察**站点，分类 pattern（SPA / SSR / JSONP / Token / Streaming）
2. **发现** endpoint——network 精读、initial state、bundle 搜索、token 溯源，或 interceptor 兜底
3. **定认证**——`PUBLIC` / `COOKIE` / `INTERCEPT` / `UI` / `LOCAL`
4. **字段解码** + 设计输出列
5. `opencli browser recon analyze <url>` → `opencli browser recon init <site>/<name>` → 写适配器 → `opencli browser recon verify <site>/<name>`
6. 站点知识沉到 `~/.opencli/sites/<site>/`，下次同站点直接吃缓存

## 前置要求

- **Node.js**: >= 21.0.0（标准 npm 安装路径要求）
- **Bun**: >= 1.0（可选替代运行时）
- 浏览器型命令需要 Chrome 或 Chromium 处于运行中，并已登录目标网站

> **重要**：浏览器型命令直接复用你的 Chrome/Chromium 登录态。如果拿到空数据或出现权限类失败，先确认目标站点已经在浏览器里打开并完成登录。

## 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLI_DAEMON_PORT` | `19825` | daemon-extension 通信端口 |
| `OPENCLI_WINDOW` | 命令默认值 | 设为 `foreground` 或 `background` 来覆盖 Browser Bridge 窗口位置。浏览器型命令也支持 `--window <foreground\|background>` |
| `OPENCLI_BROWSER_CONNECT_TIMEOUT` | `30` | 浏览器连接超时（秒） |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | `60` | 单个浏览器命令超时（秒） |
| `OPENCLI_CDP_ENDPOINT` | — | Chrome DevTools Protocol 端点，用于远程浏览器或 Electron 应用 |
| `OPENCLI_CDP_TARGET` | — | 按 URL 子串过滤 CDP target（如 `detail.1688.com`） |
| `OPENCLI_VERBOSE` | `false` | 启用详细日志（`-v` 也可以） |
| `DEBUG_SNAPSHOT` | — | 设为 `1` 输出 DOM 快照调试信息 |

`opencli browser *` 必须紧跟一个 `<session>` 位置参数，默认使用前台窗口，并保留该 session 的 tab lease，直到你手动执行 `opencli browser <session> close` 或等空闲超时。浏览器型 adapter 默认使用后台 adapter 窗口并在命令结束后释放一次性 tab lease；如果需要调试最终页面，可以传 `--window foreground --keep-tab true`。

## 内置命令

运行 `opencli list` 查看完整注册表。

| 站点 | 命令 |
|------|------|
| **xiaohongshu** | `search` `note` `comments` `notifications` `feed` `user` `download` `publish` `creator-notes` `creator-note-detail` `creator-notes-summary` `creator-profile` `creator-stats` |
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `subtitle` `summary` `video` `comments` `dynamic` `ranking` `following` `user-videos` `download` |
| **zhihu** | `hot` `search` `question` `download` `follow` `like` `favorite` `comment` `answer` |
| **hackernews** | `top` `new` `best` `ask` `show` `jobs` `search` `user` |
| **linkedin** | `connect` `inbox` `safe-send` `search` `people-search` `sent-invitations` `thread-snapshot` `timeline` `salesnav-search` `salesnav-inbox` `salesnav-message` `salesnav-thread` |
| **reddit** | `hot` `frontpage` `popular` `search` `subreddit` `read` `user` `user-posts` `user-comments` `upvote` `save` `comment` `subscribe` `saved` `upvoted` |
| **twitter** | `trending` `search` `timeline` `tweets` `lists` `list-tweets` `list-add` `list-remove` `bookmarks` `profile` `thread` `following` `followers` `notifications` `post` `reply` `delete` `like` `likes` `article` `follow` `unfollow` `bookmark` `unbookmark` `download` `accept` `reply-dm` `block` `unblock` `hide-reply` |
| **claude** | `ask` `send` `new` `status` `read` `history` `detail` |
| **gemini** | `new` `ask` `image` `deep-research` `deep-research-result` |
| **notebooklm** | `status` `list` `open` `current` `get` `history` `summary` `note-list` `notes-get` `source-list` `source-get` `source-fulltext` `source-guide` |
| **amazon** | `bestsellers` `search` `product` `offer` `discussion` `movers-shakers` `new-releases` `rankings` |

精选清单 — **[→ 查看全部 100+ 站点和命令](./docs/adapters/index.md)**（小红书 / B站 / 知乎 / Twitter / Reddit / 抖音 / 微博 / 微信读书 / 小宇宙 / 1688 / 夸克 / Spotify / 牛客 / arxiv / Bilibili / 等）。

### 外部 CLI 枢纽

把现有命令行工具统一接入 `opencli <tool> ...`：

`gh` · `docker` · `vercel` · `wrangler` · `obsidian` · `longbridge` · `lark-cli` · `ntn(notion)` · `dws(DingTalk Workspace)` · `wecom-cli(企业微信)` · `tg(tg-cli)` · `discord(discord-cli)` · `wx(wx-cli)`

注册自定义本地 CLI：`opencli external register <name>`；查看所有：`opencli external list`。

**桌面应用适配器**（Electron，通过 CDP）：Cursor / Codex / Antigravity / ChatGPT App / ChatWise / Discord / Doubao — 详见 [`docs/adapters/desktop/`](./docs/adapters/desktop/)。

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
opencli rednote download "https://www.rednote.com/search_result/<id>?xsec_token=..." --output ./rednote

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

opencli 遵循 Unix `sysexits.h`，CI / 脚本可按失败模式分支：`0` 成功、`66` 无数据、`69` Browser Bridge 未连接、`75` 超时、`77` 需要认证、`78` 配置错误、`130` Ctrl-C。完整参考：[docs/zh/guide/exit-codes.md](./docs/zh/guide/exit-codes.md)。

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

## 常见问题排查

- **"Extension not connected" 报错**
  - 确保你已从 [Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) 安装 OpenCLI 扩展，且在 `chrome://extensions` 中**已启用**。
- **"attach failed: Cannot access a chrome-extension:// URL" 报错**
  - 其他 Chrome/Chromium 扩展（如 youmind、New Tab Override 或 AI 助手类扩展）可能产生冲突。请尝试**暂时禁用其他扩展**后重试。
- **返回空数据，或者报错 "Unauthorized"**
  - Chrome/Chromium 里的登录态可能已经过期。请打开当前页面，在新标签页重新手工登录或刷新该页面。
- **Node API 错误 / 缺少 `fetch` / 旧 Node 启动即崩**
  - OpenCLI 要求 **Node.js >= 21**。先执行 `node --version`，如果版本过低先升级，再重试命令。
- **Daemon 问题**
  - 检查 daemon 状态：`curl localhost:19825/status`
  - 查看扩展日志：`curl localhost:19825/logs`


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jackwener/opencli&type=Date)](https://star-history.com/#jackwener/opencli&Date)



## License

[Apache-2.0](./LICENSE)
