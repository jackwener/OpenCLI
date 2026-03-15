---
name: opencli
description: "OpenCLI — Make any website your CLI. Zero risk, AI-powered, reuse Chrome login."
version: 0.1.0
author: jackwener
tags: [cli, browser, web, mcp, playwright, bilibili, zhihu, twitter, github, v2ex, hackernews, reddit, xiaohongshu, AI, agent]
---

# OpenCLI

> Make any website your CLI. Reuse Chrome login, zero risk, AI-powered discovery.

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
2. [Playwright MCP Bridge](https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm) extension
3. Configure `PLAYWRIGHT_MCP_EXTENSION_TOKEN` (from extension settings) in your MCP config

> **Note**: You must be logged into the target website in Chrome before running commands. Tabs opened during command execution are auto-closed afterwards.

Public API commands (`hackernews`, `github search`, `v2ex`) need no browser.

## Commands Reference

### Data Commands

```bash
# Bilibili (browser)
opencli bilibili hot --limit 10          # B站热门视频
opencli bilibili search --keyword "rust"  # 搜索视频
opencli bilibili me                       # 我的信息
opencli bilibili favorite                 # 我的收藏
opencli bilibili history --limit 20       # 观看历史
opencli bilibili feed --limit 10          # 动态时间线
opencli bilibili user-videos --uid 12345  # 用户投稿

# 知乎 (browser)
opencli zhihu hot --limit 10             # 知乎热榜
opencli zhihu search --keyword "AI"      # 搜索
opencli zhihu question --id 34816524     # 问题详情和回答

# 小红书 (browser)
opencli xiaohongshu search --keyword "美食"  # 搜索笔记
opencli xiaohongshu notifications             # 通知（mentions/likes/connections）
opencli xiaohongshu feed --limit 10           # 推荐 Feed

# GitHub (trending=browser, search=public)
opencli github trending --limit 10       # GitHub Trending
opencli github search --keyword "cli"    # 搜索仓库

# Twitter/X (browser)
opencli twitter trending --limit 10      # 热门话题

# Reddit (browser)
opencli reddit hot --limit 10            # 热门帖子
opencli reddit hot --subreddit programming  # 指定子版块

# V2EX (public)
opencli v2ex hot --limit 10              # 热门话题
opencli v2ex latest --limit 10           # 最新话题
opencli v2ex topic --id 1024             # 主题详情

# Hacker News (public)
opencli hackernews top --limit 10        # Top stories

# BBC (public)
opencli bbc news --limit 10             # BBC News RSS headlines

# 微博 (browser)
opencli weibo hot --limit 10            # 微博热搜

# BOSS直聘 (browser)
opencli boss search --query "AI agent"  # 搜索职位

# YouTube (browser)
opencli youtube search --query "rust"   # 搜索视频

# Yahoo Finance (browser)
opencli yahoo-finance quote --symbol AAPL  # 股票行情

# Reuters (browser)
opencli reuters search --query "AI"     # 路透社搜索

# 什么值得买 (browser)
opencli smzdm search --keyword "耳机"    # 搜索好价

# 携程 (browser)
opencli ctrip search --query "三亚"      # 搜索目的地
```

### Management Commands

```bash
opencli list                # List all commands
opencli list --json         # JSON output
opencli validate            # Validate all CLI definitions
opencli validate bilibili   # Validate specific site
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

# Verify: smoke-test a generated adapter
opencli verify <site/name> --smoke
```

## Output Formats

All commands support `--format` / `-f`:

```bash
opencli bilibili hot -f table   # Default: rich table
opencli bilibili hot -f json    # JSON (pipe to jq, feed to AI agent)
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
```

## Verbose Mode

```bash
opencli bilibili hot -v         # Show each pipeline step and data flow
```

## Creating Adapters

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

Create `src/clis/<site>/<name>.ts` and import in `clis/index.ts`:

```typescript
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'mysite',
  name: 'search',
  strategy: Strategy.COOKIE,
  args: [{ name: 'keyword', required: true }],
  columns: ['rank', 'title', 'url'],
  func: async (page, kwargs) => {
    await page.goto('https://www.mysite.com');
    const data = await page.evaluate(`
      (async () => {
        const res = await fetch('/api/search?q=${kwargs.keyword}', {
          credentials: 'include'
        });
        return await res.json();
      })()
    `);
    return data.items.map((item, i) => ({
      rank: i + 1, title: item.title, url: item.url,
    }));
  },
});
```

**When to use TS**: XHR interception (小红书), cookie extraction (Twitter ct0), Wbi signing (Bilibili), auto-pagination, complex data transforms.

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
| `OPENCLI_EXTENSION_LOCK_TIMEOUT` | 120 | Extension lock timeout (sec) |
| `PLAYWRIGHT_MCP_EXTENSION_TOKEN` | — | Auto-approve extension connection |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `npx not found` | Install Node.js: `brew install node` |
| `Timed out connecting to browser` | 1) Chrome must be open 2) Install MCP Bridge extension 3) Click to approve |
| `Extension lock timed out` | Another opencli command is running; browser commands run serially |
| `Target page context` error | Add `navigate:` step before `evaluate:` in YAML |
| Empty table data | Check if evaluate returns JSON string (MCP parsing) or data path is wrong |
