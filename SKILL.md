---
name: opencli
description: "OpenCLI — Make any website or Electron App your CLI. Zero risk, AI-powered, reuse Chrome login. 150+ commands across 30+ sites."
version: 1.1.0
author: jackwener
tags: [cli, browser, web, chrome-extension, cdp, bilibili, zhihu, twitter, github, v2ex, hackernews, reddit, xiaohongshu, xueqiu, youtube, boss, coupang, AI, agent]
---

# OpenCLI

> Make any website or Electron App your CLI. Reuse Chrome login, zero risk, AI-powered discovery.

> [!CAUTION]
> **AI Agent 必读：创建或修改任何适配器之前，你必须先阅读 [CLI-EXPLORER.md](./CLI-EXPLORER.md)！**
> 该文档包含完整的 API 发现工作流（必须使用浏览器探索）、5 级认证策略决策树、平台 SDK 速查表、`tap` 步骤调试流程、分页 API 模板、级联请求模式、以及常见陷阱。
> **本文件（SKILL.md）仅提供命令参考和简化模板，不足以正确开发适配器。**

## Install & Run

```bash
# npm global install (recommended)
npm install -g @jackwener/opencli
opencli <command>

# Or from source
cd ~/code/opencli && npm install
npx tsx src/main.ts <command>

# Update to latest
npm update -g @jackwener/opencli
```

## Prerequisites

Browser commands require:
1. Chrome browser running **(logged into target sites)**
2. **opencli Browser Bridge** Chrome extension installed (load `extension/` as unpacked in `chrome://extensions`)
3. No further setup needed — the daemon auto-starts on first browser command

> **Note**: You must be logged into the target website in Chrome before running commands. Tabs opened during command execution are auto-closed afterwards.

Public API commands (`hackernews`, `v2ex`) need no browser.

## Commands Reference

### Data Commands

```bash
# Bilibili (browser)
opencli bilibili hot --limit 10          # B站热门视频
opencli bilibili search "rust"            # 搜索视频 (query positional)
opencli bilibili me                       # 我的信息
opencli bilibili favorite                 # 我的收藏
opencli bilibili history --limit 20       # 观看历史
opencli bilibili feed --limit 10          # 动态时间线
opencli bilibili user-videos --uid 12345  # 用户投稿
opencli bilibili subtitle --bvid BV1xxx   # 获取视频字幕 (支持 --lang zh-CN)
opencli bilibili dynamic --limit 10       # 动态
opencli bilibili ranking --limit 10       # 排行榜
opencli bilibili following --limit 20     # 我的关注列表 (支持 --uid 查看他人)

# 知乎 (browser)
opencli zhihu hot --limit 10             # 知乎热榜
opencli zhihu search "AI"                # 搜索 (query positional)
opencli zhihu question 34816524            # 问题详情和回答 (id positional)

# 小红书 (browser)
opencli xiaohongshu search "美食"           # 搜索笔记 (query positional)
opencli xiaohongshu notifications             # 通知（mentions/likes/connections）
opencli xiaohongshu feed --limit 10           # 推荐 Feed
opencli xiaohongshu user xxx               # 用户主页 (id positional)
opencli xiaohongshu creator-notes --limit 10   # 创作者笔记列表
opencli xiaohongshu creator-note-detail --note-id xxx  # 笔记详情
opencli xiaohongshu creator-notes-summary      # 笔记数据概览
opencli xiaohongshu creator-profile            # 创作者资料
opencli xiaohongshu creator-stats              # 创作者数据统计

# 雪球 Xueqiu (browser)
opencli xueqiu hot-stock --limit 10      # 雪球热门股票榜
opencli xueqiu stock --symbol SH600519   # 查看股票实时行情
opencli xueqiu watchlist                 # 获取自选股/持仓列表
opencli xueqiu feed                      # 我的关注 timeline
opencli xueqiu hot --limit 10            # 雪球热榜
opencli xueqiu search "特斯拉"            # 搜索 (query positional)

# GitHub (via gh External CLI)
opencli gh repo list                     # 列出仓库 (passthrough to gh)
opencli gh pr list --limit 5             # PR 列表
opencli gh issue list                    # Issue 列表

# Twitter/X (browser)
opencli twitter trending --limit 10      # 热门话题
opencli twitter bookmarks --limit 20     # 获取收藏的书签推文
opencli twitter search "AI"              # 搜索推文 (query positional)
opencli twitter profile elonmusk         # 用户资料
opencli twitter timeline --limit 20      # 时间线
opencli twitter thread 1234567890        # 推文 thread（原文 + 回复）
opencli twitter article 1891511252174299446 # 推文长文内容
opencli twitter follow elonmusk          # 关注用户
opencli twitter unfollow elonmusk        # 取消关注
opencli twitter bookmark https://x.com/... # 收藏推文
opencli twitter unbookmark https://x.com/... # 取消收藏

# Reddit (browser)
opencli reddit hot --limit 10            # 热门帖子
opencli reddit hot --subreddit programming  # 指定子版块
opencli reddit frontpage --limit 10      # 首页 /r/all
opencli reddit popular --limit 10        # /r/popular 热门
opencli reddit search "AI" --sort top --time week  # 搜索（支持排序+时间过滤）
opencli reddit subreddit rust --sort top --time month  # 子版块浏览（支持时间过滤）
opencli reddit read --post-id 1abc123    # 阅读帖子 + 评论
opencli reddit user spez                 # 用户资料（karma、注册时间）
opencli reddit user-posts spez           # 用户发帖历史
opencli reddit user-comments spez        # 用户评论历史
opencli reddit upvote --post-id xxx --direction up  # 投票（up/down/none）
opencli reddit save --post-id xxx        # 收藏帖子
opencli reddit comment --post-id xxx "Great!"  # 发表评论 (text positional)
opencli reddit subscribe --subreddit python  # 订阅子版块
opencli reddit saved --limit 10          # 我的收藏
opencli reddit upvoted --limit 10        # 我的赞

# V2EX (public + browser)
opencli v2ex hot --limit 10              # 热门话题
opencli v2ex latest --limit 10           # 最新话题
opencli v2ex topic 1024                  # 主题详情 (id positional)
opencli v2ex daily                       # 每日签到 (browser)
opencli v2ex me                          # 我的信息 (browser)
opencli v2ex notifications --limit 10    # 通知 (browser)

# Hacker News (public)
opencli hackernews top --limit 10        # Top stories

# BBC (public)
opencli bbc news --limit 10             # BBC News RSS headlines

# 微博 (browser)
opencli weibo hot --limit 10            # 微博热搜

# BOSS直聘 (browser)
opencli boss search "AI agent"          # 搜索职位 (query positional)
opencli boss detail --security-id xxx    # 职位详情
opencli boss recommend --limit 10        # 推荐职位
opencli boss joblist --limit 10          # 职位列表
opencli boss greet --security-id xxx     # 打招呼
opencli boss batchgreet --job-id xxx     # 批量打招呼
opencli boss send --uid xxx "消息内容"    # 发消息 (text positional)
opencli boss chatlist --limit 10         # 聊天列表
opencli boss chatmsg --security-id xxx   # 聊天记录
opencli boss invite --security-id xxx    # 邀请沟通
opencli boss mark --security-id xxx      # 标记管理
opencli boss exchange --security-id xxx  # 交换联系方式
opencli boss resume                    # 简历管理
opencli boss stats                     # 数据统计

# YouTube (browser)
opencli youtube search "rust"            # 搜索视频 (query positional)
opencli youtube video "https://www.youtube.com/watch?v=xxx"  # 视频元数据
opencli youtube transcript "https://www.youtube.com/watch?v=xxx"  # 获取视频字幕/转录
opencli youtube transcript "xxx" --lang zh-Hans --mode raw  # 指定语言 + 原始时间戳模式

# Yahoo Finance (browser)
opencli yahoo-finance quote --symbol AAPL  # 股票行情

# Sina Finance
opencli sinafinance news --limit 10 --type 1  # 7x24实时快讯 (0=全部 1=A股 2=宏观 3=公司 4=数据 5=市场 6=国际 7=观点 8=央行 9=其它)

# Reuters (browser)
opencli reuters search "AI"              # 路透社搜索 (query positional)

# 什么值得买 (browser)
opencli smzdm search "耳机"              # 搜索好价 (query positional)

# 携程 (browser)
opencli ctrip search "三亚"              # 搜索目的地 (query positional)

# Antigravity (Electron/CDP)
opencli antigravity status              # 检查 CDP 连接
opencli antigravity send "hello"        # 发送文本到当前 agent 聊天框
opencli antigravity read                # 读取整个聊天记录面板
opencli antigravity new                 # 清空聊天、开启新对话
opencli antigravity dump               # 导出 DOM 和快照调试信息
opencli antigravity extract-code        # 自动抽取 AI 回复中的代码块
opencli antigravity model claude        # 切换底层模型
opencli antigravity watch               # 流式监听增量消息
opencli antigravity serve --port 8082  # 启动 Anthropic 兼容代理

# Barchart (browser)
opencli barchart quote --symbol AAPL     # 股票行情
opencli barchart options --symbol AAPL   # 期权链
opencli barchart greeks --symbol AAPL    # 期权 Greeks
opencli barchart flow --limit 20         # 异常期权活动

# Jike 即刻 (browser)
opencli jike feed --limit 10             # 动态流
opencli jike search "AI"                 # 搜索 (query positional)
opencli jike create "内容"                # 发布动态 (text positional)
opencli jike like xxx                    # 点赞 (id positional)
opencli jike comment xxx "评论"           # 评论 (id + text positional)
opencli jike repost xxx                  # 转发 (id positional)
opencli jike notifications               # 通知

# Linux.do (public)
opencli linux-do hot --limit 10          # 热门话题
opencli linux-do latest --limit 10       # 最新话题
opencli linux-do search "rust"           # 搜索 (query positional)
opencli linux-do topic 1024              # 主题详情 (id positional)

# StackOverflow (public)
opencli stackoverflow hot --limit 10     # 热门问题
opencli stackoverflow search "typescript"  # 搜索 (query positional)
opencli stackoverflow bounties --limit 10  # 悬赏问题

# WeRead 微信读书 (browser)
opencli weread shelf --limit 10          # 书架
opencli weread search "AI"               # 搜索图书 (query positional)
opencli weread book xxx                  # 图书详情 (book-id positional)
opencli weread highlights xxx            # 划线笔记 (book-id positional)
opencli weread notes xxx                 # 想法笔记 (book-id positional)
opencli weread ranking --limit 10        # 排行榜

# Jimeng 即梦 AI (browser)
opencli jimeng generate --prompt "描述"  # AI 生图
opencli jimeng history --limit 10        # 生成历史

# Grok (default + explicit web)
opencli grok ask --prompt "问题"         # 提问 Grok（兼容默认路径）
opencli grok ask --prompt "问题" --web   # 显式 grok.com consumer web UI 路径

# HuggingFace (public)
opencli hf top --limit 10                # 热门模型

# 超星学习通 (browser)
opencli chaoxing assignments             # 作业列表
opencli chaoxing exams                   # 考试列表
```

### Management Commands

```bash
opencli list                # List all commands (including External CLIs)
opencli list --json         # JSON output
opencli list -f yaml        # YAML output
opencli install <name>      # Auto-install an external CLI (e.g., gh, obsidian)
opencli register <name>     # Register a local custom CLI for unified discovery
opencli validate            # Validate all CLI definitions
opencli validate bilibili   # Validate specific site
opencli doctor              # Diagnose browser bridge (auto-starts daemon, includes live test)
```

### AI Agent Workflow

```bash
# Deep Explore: network intercept → response analysis → capability inference
opencli explore <url> --site <name>

# Synthesize: generate evaluate-based YAML pipelines from explore artifacts
opencli synthesize <site>

# Generate: one-shot explore → synthesize → register
opencli generate <url> --goal "hot"

# Strategy Cascade: auto-probe PUBLIC → COOKIE → HEADER
opencli cascade <api-url>

# Explore with interactive fuzzing (click buttons to trigger lazy APIs)
opencli explore <url> --auto --click "字幕,CC,评论"

# Verify: validate adapter definitions
opencli verify
```

## Output Formats

All built-in commands support `--format` / `-f` with `table`, `json`, `yaml`, `md`, and `csv`.
The `list` command supports the same formats and also keeps `--json` as a compatibility alias.

```bash
opencli list -f yaml            # YAML command registry
opencli bilibili hot -f table   # Default: rich table
opencli bilibili hot -f json    # JSON (pipe to jq, feed to AI agent)
opencli bilibili hot -f yaml    # YAML (readable structured output)
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
```

## Verbose Mode

```bash
opencli bilibili hot -v         # Show each pipeline step and data flow
```

## Creating Adapters

> [!TIP]
> **快速模式**：如果你只想为一个具体页面生成一个命令，直接看 [CLI-ONESHOT.md](./CLI-ONESHOT.md)。
> 只需要一个 URL + 一句话描述，4 步搞定。

> [!IMPORTANT]
> **完整模式 — 在写任何代码之前，先阅读 [CLI-EXPLORER.md](./CLI-EXPLORER.md)。**
> 它包含：① AI Agent 浏览器探索工作流 ② 认证策略决策树 ③ 平台 SDK（如 Bilibili 的 `apiGet`/`fetchJson`）④ YAML vs TS 选择指南 ⑤ `tap` 步骤调试方法 ⑥ 级联请求模板 ⑦ 常见陷阱表。
> **下方仅为简化模板参考，直接使用极易踩坑。**

### YAML Pipeline (declarative, recommended)

Create `src/clis/<site>/<name>.yaml`:

```yaml
site: mysite
name: hot
description: Hot topics
domain: www.mysite.com
strategy: cookie        # public | cookie | header | intercept | ui
browser: true

args:
  limit:
    type: int
    default: 20
    description: Number of items

pipeline:
  - navigate: https://www.mysite.com

  - evaluate: |
      (async () => {
        const res = await fetch('/api/hot', { credentials: 'include' });
        const d = await res.json();
        return d.data.items.map(item => ({
          title: item.title,
          score: item.score,
        }));
      })()

  - map:
      rank: ${{ index + 1 }}
      title: ${{ item.title }}
      score: ${{ item.score }}

  - limit: ${{ args.limit }}

columns: [rank, title, score]
```

For public APIs (no browser):

```yaml
strategy: public
browser: false

pipeline:
  - fetch:
      url: https://api.example.com/hot.json
  - select: data.items
  - map:
      title: ${{ item.title }}
  - limit: ${{ args.limit }}
```

### TypeScript Adapter (programmatic)

Create `src/clis/<site>/<name>.ts`. It will be automatically dynamically loaded (DO NOT manually import it in `index.ts`):

```typescript
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'mysite',
  name: 'search',
  strategy: Strategy.INTERCEPT, // Or COOKIE
  args: [{ name: 'query', required: true, positional: true }],
  columns: ['rank', 'title', 'url'],
  func: async (page, kwargs) => {
    await page.goto('https://www.mysite.com/search');
    
    // Inject native XHR/Fetch interceptor hook
    await page.installInterceptor('/api/search');
    
    // Auto scroll down to trigger lazy loading
    await page.autoScroll({ times: 3, delayMs: 2000 });
    
    // Retrieve intercepted JSON payloads
    const requests = await page.getInterceptedRequests();
    
    let results = [];
    for (const req of requests) {
      results.push(...req.data.items);
    }
    return results.map((item, i) => ({
      rank: i + 1, title: item.title, url: item.url,
    }));
  },
});
```

**When to use TS**: XHR interception (`page.installInterceptor`), infinite scrolling (`page.autoScroll`), cookie extraction, complex data transforms (like GraphQL unwrapping).

## Pipeline Steps

| Step | Description | Example |
|------|-------------|---------|
| `navigate` | Go to URL | `navigate: https://example.com` |
| `fetch` | HTTP request (browser cookies) | `fetch: { url: "...", params: { q: "..." } }` |
| `evaluate` | Run JavaScript in page | `evaluate: \| (async () => { ... })()` |
| `select` | Extract JSON path | `select: data.items` |
| `map` | Map fields | `map: { title: "${{ item.title }}" }` |
| `filter` | Filter items | `filter: item.score > 100` |
| `sort` | Sort items | `sort: { by: score, order: desc }` |
| `limit` | Cap result count | `limit: ${{ args.limit }}` |
| `intercept` | Declarative XHR capture | `intercept: { trigger: "navigate:...", capture: "api/hot" }` |
| `tap` | Store action + XHR capture | `tap: { store: "feed", action: "fetchFeeds", capture: "homefeed" }` |
| `snapshot` | Page accessibility tree | `snapshot: { interactive: true }` |
| `click` | Click element | `click: ${{ ref }}` |
| `type` | Type text | `type: { ref: "@1", text: "hello" }` |
| `wait` | Wait for time/text | `wait: 2` or `wait: { text: "loaded" }` |
| `press` | Press key | `press: Enter` |

## Template Syntax

```yaml
# Arguments with defaults
${{ args.query }}
${{ args.limit | default(20) }}

# Current item (in map/filter)
${{ item.title }}
${{ item.data.nested.field }}

# Index (0-based)
${{ index }}
${{ index + 1 }}
```

## 5-Tier Authentication Strategy

| Tier | Name | Method | Example |
|------|------|--------|---------|
| 1 | `public` | No auth, Node.js fetch | Hacker News, V2EX |
| 2 | `cookie` | Browser fetch with `credentials: include` | Bilibili, Zhihu |
| 3 | `header` | Custom headers (ct0, Bearer) | Twitter GraphQL |
| 4 | `intercept` | XHR interception + store mutation | 小红书 Pinia |
| 5 | `ui` | Full UI automation (click/type/scroll) | Last resort |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLI_DAEMON_PORT` | 19825 | Daemon listen port |
| `OPENCLI_BROWSER_CONNECT_TIMEOUT` | 30 | Browser connection timeout (sec) |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | 45 | Command execution timeout (sec) |
| `OPENCLI_BROWSER_EXPLORE_TIMEOUT` | 120 | Explore timeout (sec) |
| `OPENCLI_VERBOSE` | — | Show daemon/extension logs |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `npx not found` | Install Node.js: `brew install node` |
| `Extension not connected` | 1) Chrome must be open 2) Install opencli Browser Bridge extension |
| `Target page context` error | Add `navigate:` step before `evaluate:` in YAML |
| Empty table data | Check if evaluate returns correct data path |
| Daemon issues | `curl localhost:19825/status` to check, `curl localhost:19825/logs` for extension logs |
