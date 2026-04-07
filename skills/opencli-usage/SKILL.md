---
name: opencli-usage
description: "Use when running OpenCLI commands to interact with websites (Bilibili, Twitter, Reddit, Xiaohongshu, etc.), desktop apps (Cursor, Notion), or public APIs (HackerNews, arXiv). Covers installation, command reference, and output formats for 79+ adapters."
version: 1.6.3
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

| Capability | Platforms (partial list) | File |
|-----------|--------------------------|------|
| **search** | Bilibili, Twitter, Reddit, Xiaohongshu, Zhihu, YouTube, Google, arXiv, LinkedIn, Pixiv, etc. | browser.md / public-api.md |
| **hot/trending** | Bilibili, Twitter, Weibo, HackerNews, Reddit, V2EX, Xueqiu, Lobsters, Douban | browser.md / public-api.md |
| **feed/timeline** | Twitter, Reddit, Xiaohongshu, Xueqiu, Jike, Facebook, Instagram, Medium | browser.md |
| **user/profile** | Twitter, Reddit, Instagram, TikTok, Facebook, Bilibili, Pixiv | browser.md |
| **post/create** | Twitter, Jike, Douyin, Weibo | browser.md |
| **AI chat** | Grok, Doubao, ChatGPT, Gemini, Cursor, Codex, NotebookLM | browser.md / desktop.md |
| **finance/stock** | Xueqiu, Yahoo Finance, Barchart, Sina Finance, Bloomberg | browser.md / public-api.md |
| **web scraping** | `opencli web read --url <url>` — any URL to Markdown | browser.md |

## Command Quick Reference

Usage: `opencli <site> <command> [args] [--limit N] [-f json|yaml|md|csv|table]`

### Browser-based (login required)

| Site | Commands |
|------|----------|
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `user-videos` `subtitle` `dynamic` `ranking` `following` |
| **zhihu** | `hot` `search` `question` |
| **xiaohongshu** | `search` `notifications` `feed` `user` `note` `comments` `download` `publish` `creator-notes` `creator-note-detail` `creator-notes-summary` `creator-profile` `creator-stats` |
| **xueqiu** | `hot-stock` `stock` `watchlist` `feed` `hot` `search` `comments` `earnings-date` `fund-holdings` `fund-snapshot` |
| **twitter** | `trending` `bookmarks` `search` `profile` `timeline` `thread` `article` `follow` `unfollow` `bookmark` `unbookmark` `post` `like` `likes` `reply` `delete` `block` `unblock` `followers` `following` `notifications` `hide-reply` `download` `accept` `reply-dm` |
| **reddit** | `hot` `frontpage` `popular` `search` `subreddit` `read` `user` `user-posts` `user-comments` `upvote` `save` `comment` `subscribe` `saved` `upvoted` |
| **youtube** | `search` `video` `transcript` |
| **facebook** | `feed` `profile` `search` `friends` `groups` `events` `notifications` `memories` `add-friend` `join-group` |
| **instagram** | `explore` `profile` `search` `user` `followers` `following` `follow` `unfollow` `like` `unlike` `comment` `save` `unsave` `saved` |
| **tiktok** | `explore` `search` `profile` `user` `following` `follow` `unfollow` `like` `unlike` `comment` `save` `unsave` `live` `notifications` `friends` |
| **linkedin** | `search` `timeline` |
| **medium** | `feed` `search` `user` |
| **substack** | `feed` `search` `publication` |
| **sinablog** | `hot` `search` `article` `user` |
| **weibo** | `hot` `search` `feed` `user` `me` `post` `comments` |
| **douyin** | `profile` `videos` `user-videos` `activities` `collections` `hashtag` `location` `stats` `publish` `draft` `drafts` `delete` `update` |
| **bluesky** | `search` `profile` `user` `feeds` `followers` `following` `thread` `trending` `starter-packs` |
| **boss** | `search` `detail` `recommend` `joblist` `greet` `batchgreet` `send` `chatlist` `chatmsg` `invite` `mark` `exchange` `resume` `stats` |
| **douban** | `search` `top250` `subject` `photos` `download` `marks` `reviews` `movie-hot` `book-hot` |
| **pixiv** | `ranking` `search` `user` `illusts` `detail` `download` |
| **jike** | `feed` `search` `create` `like` `comment` `repost` `notifications` `post` `topic` `user` |
| **band** | `bands` `posts` `post` `mentions` |
| **zsxq** | `groups` `dynamics` `topics` `topic` `search` |
| **tieba** | `hot` `search` `posts` `read` |
| **yahoo-finance** | `quote` |
| **barchart** | `quote` `options` `greeks` `flow` |
| **sinafinance** | `news` |
| **reuters** | `search` |
| **amazon** | `bestsellers` `search` `product` `offer` `discussion` `movers-shakers` `new-releases` |
| **coupang** | `search` `add-to-cart` |
| **jd** | `item` |
| **smzdm** | `search` |
| **ctrip** | `search` |
| **36kr** | `hot` `news` `search` `article` |
| **weread** | `shelf` `search` `book` `highlights` `notes` `notebooks` `ranking` |
| **chaoxing** | `assignments` `exams` |
| **jimeng** | `generate` `history` |
| **yollomi** | `models` `generate` `video` `upload` `remove-bg` `edit` `background` `face-swap` `object-remover` `restore` `try-on` `upscale` |
| **ones** | `login` `logout` `me` `tasks` `task` `my-tasks` `worklog` `token-info` |
| **web** | `read` — any URL to Markdown |
| **weixin** | `download` — 公众号 article to Markdown |
| **v2ex** (browser) | `daily` `me` `notifications` |
| **linux-do** (browser) | `hot` `latest` `feed` `search` `categories` `category` `tags` `topic` `topic-content` `user-posts` `user-topics` |
| **bloomberg** (browser) | `news` — full article reader |
| **grok** | `ask` |
| **doubao** | `status` `new` `send` `read` `ask` `detail` `history` `meeting-summary` `meeting-transcript` |
| **gemini** | `ask` `new` `image` `deep-research` `deep-research-result` |
| **notebooklm** | `status` `list` `open` `current` `get` `history` `summary` `note-list` `notes-get` `source-list` `source-get` `source-fulltext` `source-guide` |

### Desktop (CDP/Electron)

| Site | Commands |
|------|----------|
| **gh** | `repo` `pr` `issue` — passthrough to gh CLI |
| **cursor** | `status` `send` `read` `new` `dump` `composer` `model` `extract-code` `ask` `screenshot` `history` `export` |
| **codex** | `status` `send` `read` `new` `dump` `extract-diff` `model` `ask` `screenshot` `history` `export` |
| **chatgpt** | `status` `new` `send` `read` `ask` `model` |
| **chatwise** | `status` `new` `send` `read` `ask` `model` `history` `export` `screenshot` |
| **notion** | `status` `search` `read` `new` `write` `sidebar` `favorites` `export` |
| **discord-app** | `status` `send` `read` `channels` `servers` `search` `members` |
| **doubao-app** | `status` `new` `send` `read` `ask` `screenshot` `dump` |
| **antigravity** | `status` `send` `read` `new` `dump` `extract-code` `model` `watch` |

### Public API (no browser)

| Site | Commands |
|------|----------|
| **hackernews** | `top` `new` `best` `ask` `show` `jobs` `search` `user` |
| **v2ex** (public) | `hot` `latest` `topic` `node` `nodes` `member` `user` `replies` |
| **bbc** | `news` |
| **lobsters** | `hot` `newest` `active` `tag` |
| **google** | `news` `search` `suggest` `trends` |
| **devto** | `top` `tag` `user` |
| **steam** | `top-sellers` |
| **apple-podcasts** | `top` `search` `episodes` |
| **arxiv** | `search` `paper` |
| **bloomberg** (RSS) | `main` `markets` `tech` `politics` `economics` `opinions` `industries` `businessweek` `feeds` |
| **dictionary** | `search` `synonyms` `examples` |
| **hf** | `top` |
| **stackoverflow** | `hot` `search` `bounties` `unanswered` |
| **xiaoyuzhou** | `podcast` `podcast-episodes` `episode` |
| **wikipedia** | `search` `summary` `random` `trending` |
| **producthunt** | `today` `hot` `browse` `posts` |
| **imdb** | `top` `trending` `search` `title` `person` `reviews` |
| **spotify** | `auth` `status` `play` `pause` `next` `prev` `volume` `search` `queue` `shuffle` `repeat` |
| **paperreview** | `submit` `review` `feedback` |

### Management

```bash
opencli list [-f json|yaml]     # List all commands
opencli validate [site]         # Validate adapter definitions
opencli doctor                  # Diagnose browser bridge
opencli explore <url>           # AI-powered API discovery
opencli record <url>            # Record API calls manually
```

All commands support: `--format` / `-f` with `table` `json` `yaml` `md` `csv`

## Self-Repair

If a command fails due to a site change (selector, API, or response schema), **automatically fix the adapter and retry** instead of reporting failure. Re-run the command with `OPENCLI_DIAGNOSTIC=1` to get structured diagnostic context, then fix the adapter file at `RepairContext.adapter.sourcePath` and retry. Max 3 repair rounds. See the `opencli-autofix` skill for the full workflow.

## Related Skills

- **opencli-operate** — Browser automation for AI agents (navigate, click, type, extract via Chrome)
- **opencli-explorer** — Full guide for creating new adapters (API discovery, auth strategy, YAML/TS writing)
- **opencli-oneshot** — Quick 4-step template for adding a single command from a URL
- **opencli-autofix** — Automatically fix broken adapters when commands fail
