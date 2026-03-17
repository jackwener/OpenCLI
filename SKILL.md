---
name: opencli
description: "OpenCLI — Make any website your CLI. Zero risk, AI-powered, reuse Chrome login. 83 commands across 19 sites."
version: 0.7.3
author: jackwener
tags: [cli, browser, web, mcp, playwright, bilibili, zhihu, twitter, github, v2ex, hackernews, reddit, xiaohongshu, xueqiu, youtube, boss, coupang, ctrip, reuters, smzdm, weibo, yahoo-finance, bbc, linkedin, AI, agent]
---

# OpenCLI

> Make any website your CLI. Reuse Chrome login, zero risk, AI-powered discovery.

> [!CAUTION]
> **AI Agent 必读：创建或修改任何适配器之前，你必须先阅读 [CLI-EXPLORER.md](./CLI-EXPLORER.md)！**
> 该文档包含完整的 API 发现工作流（必须使用 Playwright MCP Bridge 浏览器探索）、5 级认证策略决策树、平台 SDK 速查表、`tap` 步骤调试流程、分页 API 模板、级联请求模式、以及常见陷阱。
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
2. [Playwright MCP Bridge](https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm) extension installed
3. Run `opencli setup` to auto-discover token and configure all tools

> **Note**: You must be logged into the target website in Chrome before running commands. Tabs opened during command execution are auto-closed afterwards.

Public API commands (`hackernews`, `github search`, `v2ex`) need no browser.

## Commands Reference

### Data Commands

```bash
# Bilibili (browser)
opencli bilibili dynamic                  # Get Bilibili user dynamic feed
opencli bilibili favorite                 # 我的默认收藏夹
opencli bilibili feed                     # 关注的人的动态时间线
opencli bilibili following                # 获取 Bilibili 用户的关注列表
opencli bilibili history                  # 我的观看历史
opencli bilibili hot                      # B站热门视频
opencli bilibili me                       # My Bilibili profile info
opencli bilibili ranking                  # Get Bilibili video ranking board
opencli bilibili search                   # Search Bilibili videos or users
opencli bilibili subtitle                 # 获取 Bilibili 视频的字幕
opencli bilibili user-videos              # 查看指定用户的投稿视频

# 知乎 (browser)
opencli zhihu hot                        # 知乎热榜
opencli zhihu question                   # 知乎问题详情和回答
opencli zhihu search                     # 知乎搜索

# 小红书 (browser)
opencli xiaohongshu feed                 # 小红书首页推荐 Feed (via Pinia Store Action)
opencli xiaohongshu me                   # 我的小红书个人信息
opencli xiaohongshu notifications        # 小红书通知 (mentions/likes/connections)
opencli xiaohongshu search               # 搜索小红书笔记
opencli xiaohongshu user                 # Get user notes from Xiaohongshu

# 雪球 Xueqiu (browser)
opencli xueqiu feed                      # 获取雪球首页时间线（关注用户的动态）
opencli xueqiu hot                       # 获取雪球热门动态
opencli xueqiu hot-stock                 # 获取雪球热门股票榜
opencli xueqiu search                    # 搜索雪球股票（代码或名称）
opencli xueqiu stock                     # 获取雪球股票实时行情
opencli xueqiu watchlist                 # 获取雪球自选股列表

# GitHub (public)
opencli github search                    # Search GitHub repositories

# Twitter/X (browser & ui)
opencli twitter article                  # Fetch a Twitter Article (long-form content) and export as Markdown
opencli twitter bookmark                 # Bookmark a tweet [UI]
opencli twitter bookmarks                # 获取 Twitter 书签列表
opencli twitter delete                   # Delete a specific tweet by URL [UI]
opencli twitter follow                   # Follow a Twitter user [UI]
opencli twitter followers                # Get accounts following a Twitter/X user
opencli twitter following                # Get accounts a Twitter/X user is following
opencli twitter like                     # Like a specific tweet [UI]
opencli twitter notifications            # Get Twitter/X notifications
opencli twitter post                     # Post a new tweet/thread [UI]
opencli twitter profile                  # Fetch a Twitter user profile (bio, stats, etc.)
opencli twitter reply                    # Reply to a specific tweet [UI]
opencli twitter search                   # Search Twitter/X for tweets
opencli twitter thread                   # Get a tweet thread (original + all replies)
opencli twitter timeline                 # Twitter Home Timeline
opencli twitter trending                 # Twitter/X trending topics
opencli twitter unbookmark               # Remove a tweet from bookmarks [UI]
opencli twitter unfollow                 # Unfollow a Twitter user [UI]

# Reddit (browser & cookie)
opencli reddit comment                   # Post a comment on a Reddit post
opencli reddit frontpage                 # Reddit Frontpage / r/all
opencli reddit hot                       # Reddit 热门帖子
opencli reddit popular                   # Reddit Popular posts (/r/popular)
opencli reddit read                      # Read a Reddit post and its comments
opencli reddit save                      # Save or unsave a Reddit post
opencli reddit saved                     # Browse your saved Reddit posts
opencli reddit search                    # Search Reddit Posts
opencli reddit subreddit                 # Get posts from a specific Subreddit
opencli reddit subscribe                 # Subscribe or unsubscribe to a subreddit
opencli reddit upvote                    # Upvote or downvote a Reddit post
opencli reddit upvoted                   # Browse your upvoted Reddit posts
opencli reddit user                      # View a Reddit user profile
opencli reddit user-comments             # View a Reddit user's comment history
opencli reddit user-posts                # View a Reddit user's submitted posts

# V2EX (public & cookie)
opencli v2ex daily                       # V2EX 每日签到并领取铜币
opencli v2ex hot                         # V2EX 热门话题
opencli v2ex latest                      # V2EX 最新话题
opencli v2ex me                          # V2EX 获取个人资料 (余额/未读提醒)
opencli v2ex notifications               # V2EX 获取提醒 (回复/由于)
opencli v2ex topic                       # V2EX 主题详情和回复

# Hacker News (public)
opencli hackernews top                   # Hacker News top stories

# BBC (public)
opencli bbc news                        # BBC News headlines (RSS)

# 微博 (browser)
opencli weibo hot                       # 微博热搜

# BOSS直聘 (browser)
opencli boss detail                     # BOSS直聘查看职位详情
opencli boss search                     # BOSS直聘搜索职位

# YouTube (browser)
opencli youtube search                  # Search YouTube videos
opencli youtube transcript              # Get YouTube video transcript/subtitles
opencli youtube video                   # Get YouTube video metadata (title, views, description, etc.)

# Yahoo Finance (browser)
opencli yahoo-finance quote             # Yahoo Finance 股票行情

# Reuters (browser)
opencli reuters search                  # Reuters 路透社新闻搜索

# 什么值得买 (browser)
opencli smzdm search                    # 什么值得买搜索好价

# 携程 (browser)
opencli ctrip search                    # 携程旅行搜索

# Coupang (browser)
opencli coupang search                  # Search Coupang products with logged-in browser session
opencli coupang add-to-cart             # Add a Coupang product to cart using logged-in browser session

# LinkedIn (header)
opencli linkedin search                 # Search LinkedIn
```

### Management Commands

```bash
opencli list                # List all commands
opencli list --json         # JSON output
opencli list -f yaml        # YAML output
opencli validate            # Validate all CLI definitions
opencli validate bilibili   # Validate specific site
opencli setup               # Interactive token setup (auto-discover + TUI checkbox)
opencli doctor              # Diagnose token & extension config across all tools
opencli doctor --live       # Also test live browser connectivity
opencli doctor --fix        # Fix mismatched configs (interactive confirmation)
opencli doctor --fix -y     # Fix all configs non-interactively
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
> 它包含：① AI Agent 浏览器探索工作流（必须用 Playwright MCP 抓包验证 API）② 认证策略决策树 ③ 平台 SDK（如 Bilibili 的 `apiGet`/`fetchJson`）④ YAML vs TS 选择指南 ⑤ `tap` 步骤调试方法 ⑥ 级联请求模板 ⑦ 常见陷阱表。
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
  args: [{ name: 'keyword', required: true }],
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
${{ args.keyword }}
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
| `OPENCLI_BROWSER_CONNECT_TIMEOUT` | 30 | Browser connection timeout (sec) |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | 45 | Command execution timeout (sec) |
| `OPENCLI_BROWSER_EXPLORE_TIMEOUT` | 120 | Explore timeout (sec) |
| `PLAYWRIGHT_MCP_EXTENSION_TOKEN` | — | Auto-approve extension connection |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `npx not found` | Install Node.js: `brew install node` |
| `Timed out connecting to browser` | 1) Chrome must be open 2) Install MCP Bridge extension and configure token |
| `Target page context` error | Add `navigate:` step before `evaluate:` in YAML |
| Empty table data | Check if evaluate returns JSON string (MCP parsing) or data path is wrong |
