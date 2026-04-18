---
name: opencli-usage
description: "Use when running OpenCLI commands to interact with websites (Bilibili, Twitter, Reddit, Xiaohongshu, etc.), desktop apps (Cursor, Notion), or public APIs (HackerNews, arXiv). Covers installation, command reference, and output formats for 87+ adapters."
version: 1.7.0
author: jackwener
tags: [opencli, cli, browser, web, chrome-extension, cdp, bilibili, twitter, reddit, xiaohongshu, github, youtube, AI, agent, automation]
---

# OpenCLI Usage Guide

> Make any website or Electron App your CLI. Reuse Chrome login, zero risk, AI-powered discovery.

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

## Quick Lookup by Capability

| Capability | Platforms (partial list) |
|-----------|--------------------------|
| **search** | Bilibili, Twitter, Reddit, Xiaohongshu, Zhihu, YouTube, Google, arXiv, LinkedIn, Pixiv, etc. |
| **hot/trending** | Bilibili, Twitter, Weibo, HackerNews, Reddit, V2EX, Xueqiu, Lobsters, Douban |
| **feed/timeline** | Twitter, Reddit, Xiaohongshu, Xueqiu, Jike, Facebook, Instagram, Medium |
| **user/profile** | Twitter, Reddit, Instagram, TikTok, Facebook, Bilibili, Pixiv |
| **post/create** | Twitter, Jike, Douyin, Weibo |
| **AI chat** | Grok, Doubao, ChatGPT, Gemini, Cursor, Codex, NotebookLM |
| **finance/stock** | Xueqiu, Yahoo Finance, Barchart, Sina Finance, Bloomberg |
| **web scraping** | `opencli web read --url <url>` — any URL to Markdown |
| **GitHub/DevOps** | `opencli gh`, `opencli docker`, `opencli vercel` — external CLI passthrough |
| **collaboration** | `opencli lark-cli`, `opencli dws`, `opencli wecom-cli` — external CLI passthrough |

## Command Quick Reference

Usage: `opencli <site> <command> [args] [--limit N] [-f json|yaml|md|csv|table]`

Type legend: 🌐 = Browser (needs Chrome login) · ✅ = Public API (no browser) · 🖥️ = Desktop (Electron/CDP) · 🔧 = External CLI (passthrough)

### Website Adapters

| Site | Type | Commands |
|------|------|----------|
| **1688** | 🌐 | `search` `item` `download` `store` |
| **36kr** | 🌐 | `hot` `news` `search` `article` |
| **amazon** | 🌐 | `bestsellers` `search` `product` `offer` `discussion` `movers-shakers` `new-releases` |
| **apple-podcasts** | ✅ | `top` `search` `episodes` |
| **arxiv** | ✅ | `search` `paper` |
| **band** | 🌐 | `bands` `posts` `post` `mentions` |
| **barchart** | 🌐 | `quote` `options` `greeks` `flow` |
| **bbc** | ✅ | `news` |
| **baidu-scholar** | 🌐 | `search` |
| **bilibili** | 🌐 | `hot` `search` `me` `favorite` `history` `feed` `user-videos` `subtitle` `dynamic` `ranking` `following` |
| **bloomberg** | ✅🌐 | RSS: `main` `markets` `tech` `politics` `economics` `opinions` `industries` `businessweek` `feeds` · Browser: `news` (full article) |
| **bluesky** | 🌐 | `search` `profile` `user` `feeds` `followers` `following` `thread` `trending` `starter-packs` |
| **boss** | 🌐 | `search` `detail` `recommend` `joblist` `greet` `batchgreet` `send` `chatlist` `chatmsg` `invite` `mark` `exchange` `resume` `stats` |
| **chaoxing** | 🌐 | `assignments` `exams` |
| **coupang** | 🌐 | `search` `add-to-cart` |
| **ctrip** | 🌐 | `search` |
| **devto** | ✅ | `top` `tag` `user` |
| **dictionary** | ✅ | `search` `synonyms` `examples` |
| **doubao** | 🌐 | `status` `new` `send` `read` `ask` `detail` `history` `meeting-summary` `meeting-transcript` |
| **douban** | 🌐 | `search` `top250` `subject` `photos` `download` `marks` `reviews` `movie-hot` `book-hot` |
| **douyin** | 🌐 | `profile` `videos` `user-videos` `activities` `collections` `hashtag` `location` `stats` `publish` `draft` `drafts` `delete` `update` |
| **facebook** | 🌐 | `feed` `profile` `search` `friends` `groups` `events` `notifications` `memories` `add-friend` `join-group` |
| **gemini** | 🌐 | `ask` `new` `image` `deep-research` `deep-research-result` |
| **google** | ✅ | `news` `search` `suggest` `trends` |
| **google-scholar** | 🌐 | `search` |
| **gov-law** | 🌐 | `search` `recent` |
| **gov-policy** | 🌐 | `search` `recent` |
| **grok** | 🌐 | `ask` `image` |
| **hackernews** | ✅ | `top` `new` `best` `ask` `show` `jobs` `search` `user` |
| **hf** | ✅ | `top` |
| **hupu** | 🌐 | `hot` `search` `detail` `like` `unlike` `reply` `mentions` |
| **imdb** | ✅ | `top` `trending` `search` `title` `person` `reviews` |
| **instagram** | 🌐 | `explore` `profile` `search` `user` `followers` `following` `follow` `unfollow` `like` `unlike` `comment` `save` `unsave` `saved` |
| **jd** | 🌐 | `item` |
| **jianyu** | 🌐 | `search` |
| **jike** | 🌐 | `feed` `search` `create` `like` `comment` `repost` `notifications` `post` `topic` `user` |
| **jimeng** | 🌐 | `generate` `history` |
| **lesswrong** | ✅ | `frontpage` `curated` `new` `top` `top-week` `top-month` `top-year` `shortform` `read` `comments` `user` `user-posts` `sequences` `tags` `tag` |
| **linkedin** | 🌐 | `search` `timeline` |
| **linux-do** | 🌐 | `hot` `latest` `feed` `search` `categories` `category` `tags` `topic` `topic-content` `user-posts` `user-topics` |
| **lobsters** | ✅ | `hot` `newest` `active` `tag` |
| **medium** | 🌐 | `feed` `search` `user` |
| **notebooklm** | 🌐 | `status` `list` `open` `current` `get` `history` `summary` `note-list` `notes-get` `source-list` `source-get` `source-fulltext` `source-guide` |
| **ones** | 🌐 | `login` `logout` `me` `tasks` `task` `my-tasks` `worklog` `token-info` |
| **paperreview** | ✅ | `submit` `review` `feedback` |
| **pixiv** | 🌐 | `ranking` `search` `user` `illusts` `detail` `download` |
| **producthunt** | ✅ | `today` `hot` `browse` `posts` |
| **quark** | 🌐 | `ls` `mkdir` `mv` `rename` `rm` `save` `share-tree` |
| **reddit** | 🌐 | `hot` `frontpage` `popular` `search` `subreddit` `read` `user` `user-posts` `user-comments` `upvote` `save` `comment` `subscribe` `saved` `upvoted` |
| **reuters** | 🌐 | `search` |
| **sinablog** | 🌐 | `hot` `search` `article` `user` |
| **sinafinance** | ✅ | `news` |
| **smzdm** | 🌐 | `search` |
| **spotify** | ✅ | `auth` `status` `play` `pause` `next` `prev` `volume` `search` `queue` `shuffle` `repeat` |
| **stackoverflow** | ✅ | `hot` `search` `bounties` `unanswered` |
| **steam** | ✅ | `top-sellers` |
| **substack** | 🌐 | `feed` `search` `publication` |
| **tieba** | 🌐 | `hot` `search` `posts` `read` |
| **tiktok** | 🌐 | `explore` `search` `profile` `user` `following` `follow` `unfollow` `like` `unlike` `comment` `save` `unsave` `live` `notifications` `friends` |
| **twitter** | 🌐 | `trending` `bookmarks` `search` `profile` `timeline` `lists` `list-tweets` `list-add` `list-remove` `thread` `article` `follow` `unfollow` `bookmark` `unbookmark` `post` `like` `likes` `reply` `delete` `block` `unblock` `followers` `following` `notifications` `hide-reply` `download` `accept` `reply-dm` |
| **v2ex** | ✅🌐 | Public: `hot` `latest` `topic` `node` `nodes` `member` `user` `replies` · Browser: `daily` `me` `notifications` |
| **web** | 🌐 | `read` — any URL to Markdown |
| **weibo** | 🌐 | `hot` `search` `feed` `user` `me` `post` `comments` |
| **weixin** | 🌐 | `download` — 公众号 article to Markdown |
| **wanfang** | 🌐 | `search` |
| **weread** | 🌐 | `shelf` `search` `book` `highlights` `notes` `notebooks` `ranking` |
| **wikipedia** | ✅ | `search` `summary` `random` `trending` |
| **xianyu** | 🌐 | `search` `item` `chat` |
| **xiaoe** | 🌐 | `courses` `catalog` `content` `detail` `play-url` |
| **xiaohongshu** | 🌐 | `search` `notifications` `feed` `user` `note` `comments` `download` `publish` `creator-notes` `creator-note-detail` `creator-notes-summary` `creator-profile` `creator-stats` |
| **xiaoyuzhou** | 🔑 | `podcast` `podcast-episodes` `episode` `download` `transcript` |
| **nowcoder** | ✅🌐 | Public: `hot` `trending` `topics` `recommend` `creators` `companies` `jobs` · Browser: `search` `suggest` `experience` `referral` `salary` `papers` `practice` `notifications` `detail` |
| **xueqiu** | 🌐 | `hot-stock` `stock` `watchlist` `feed` `hot` `search` `comments` `earnings-date` `fund-holdings` `fund-snapshot` |
| **yahoo-finance** | 🌐 | `quote` |
| **yollomi** | 🌐 | `models` `generate` `video` `upload` `remove-bg` `edit` `background` `face-swap` `object-remover` `restore` `try-on` `upscale` |
| **youtube** | 🌐 | `search` `video` `transcript` `comments` `channel` `playlist` `feed` `history` `watch-later` `subscriptions` `like` `unlike` `subscribe` `unsubscribe` |
| **yuanbao** | 🌐 | `new` `ask` |
| **zhihu** | 🌐 | `hot` `search` `question` |
| **zsxq** | 🌐 | `groups` `dynamics` `topics` `topic` `search` |

`opencli xiaoyuzhou podcast`, `podcast-episodes`, `episode`, `download`, and `transcript` require local Xiaoyuzhou credentials in `~/.opencli/xiaoyuzhou.json`.

### Desktop Apps (CDP/Electron)

| App | Commands |
|-----|----------|
| **antigravity** | `status` `send` `read` `new` `dump` `extract-code` `model` `watch` `serve` |
| **chatgpt** | `status` `new` `send` `read` `ask` `model` |
| **chatwise** | `status` `new` `send` `read` `ask` `model` `history` `export` `screenshot` |
| **codex** | `status` `send` `read` `new` `dump` `extract-diff` `model` `ask` `screenshot` `history` `export` |
| **cursor** | `status` `send` `read` `new` `dump` `composer` `model` `extract-code` `ask` `screenshot` `history` `export` |
| **discord-app** | `status` `send` `read` `channels` `servers` `search` `members` |
| **doubao-app** | `status` `new` `send` `read` `ask` `screenshot` `dump` |
| **notion** | `status` `search` `read` `new` `write` `sidebar` `favorites` `export` |

### External CLI (passthrough)

OpenCLI can discover, auto-install, and passthrough commands to external CLI tools. Use `opencli install <name>` to auto-install, or `opencli register <name>` to register a local CLI.

| CLI | Description | Commands |
|-----|-------------|----------|
| **gh** | GitHub CLI — repos, PRs, issues, releases | `repo` `pr` `issue` (all gh subcommands) |
| **obsidian** | Obsidian vault — notes, search, tags | All obsidian subcommands |
| **docker** | Docker CLI | All docker subcommands |
| **lark-cli** | Lark/Feishu — messages, docs, calendar, tasks (200+ commands) | All lark-cli subcommands |
| **dws** | DingTalk Workspace — messages, docs, calendar, contacts | All dws subcommands |
| **wecom-cli** | WeCom/企业微信 — contacts, todos, meetings, messages | All wecom-cli subcommands |
| **vercel** | Vercel — deploy, domains, env vars, logs | All vercel subcommands |

```bash
opencli install gh              # Auto-install gh CLI
opencli register my-tool        # Register a local custom CLI
opencli gh pr list --limit 5    # Passthrough to gh
opencli docker ps               # Passthrough to docker
opencli lark-cli msg send ...   # Passthrough to lark-cli
```

### Management

```bash
opencli list [-f json|yaml]     # List all commands
opencli validate [site]         # Validate adapter definitions
opencli doctor                  # Diagnose browser bridge
opencli explore <url>           # AI-powered API discovery
opencli record <url>            # Record API calls manually
```

All commands support: `--format` / `-f` with `table` `json` `yaml` `md` `csv`

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLI_DAEMON_PORT` | `19825` | Daemon-extension bridge port |
| `OPENCLI_WINDOW_FOCUSED` | `false` | `1` = open automation windows in foreground |
| `OPENCLI_BROWSER_CONNECT_TIMEOUT` | `30` | Browser connection timeout (seconds) |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | `60` | Single command timeout (seconds) |
| `OPENCLI_BROWSER_EXPLORE_TIMEOUT` | `120` | Explore/record timeout (seconds) |
| `OPENCLI_CDP_ENDPOINT` | — | CDP endpoint for remote browser / Electron apps |
| `OPENCLI_CDP_TARGET` | — | Filter CDP targets by URL substring |
| `OPENCLI_VERBOSE` | `false` | Verbose logging (`-v` flag also works) |
| `OPENCLI_DIAGNOSTIC` | `false` | `1` = structured diagnostic on failures |

## Self-Repair

If a command fails due to a site change (selector, API, or response schema), **automatically fix the adapter and retry** instead of reporting failure. Re-run the command with `OPENCLI_DIAGNOSTIC=1` to get structured diagnostic context, then fix the adapter file at `RepairContext.adapter.sourcePath` and retry. Max 3 repair rounds. See the `opencli-autofix` skill for the full workflow.

## Related Skills

- **opencli-browser** — Browser automation for AI agents (navigate, click, type, extract via Chrome)
- **opencli-explorer** — Full guide for creating new adapters (API discovery, auth strategy, TS writing)
- **opencli-oneshot** — Quick 4-step template for adding a single command from a URL
- **opencli-autofix** — Automatically fix broken adapters when commands fail
