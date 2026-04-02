---
name: opencli-usage
description: "OpenCLI usage guide — installation, prerequisites, and command reference organized by platform"
version: 1.5.6
author: jackwener
tags: [cli, browser, web, chrome-extension, cdp, AI, agent]
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

## Command Categories

OpenCLI commands are organized by platform type:

### 📱 Browser-based Commands
Commands that require Chrome browser with login state. See [browser.md](./browser.md) for full reference.

**Supported platforms:**
- Bilibili (哔哩哔哩), Zhihu (知乎), Xiaohongshu (小红书), Xueqiu (雪球)
- Twitter/X, Reddit, Facebook, Instagram, TikTok, LinkedIn
- YouTube, Medium, Substack, Sinablog (新浪博客)
- V2EX (browser features), Weibo (微博), Jike (即刻), Linux.do (browser features)
- BOSS直聘, Coupang (쿠팡), JD (京东), SMZDM (什么值得买), Ctrip (携程)
- Yahoo Finance, Sina Finance, Reuters, Barchart, Bloomberg (full article)
- Douban (豆瓣), Chaoxing (超星学习通), WeRead (微信读书), Pixiv
- Yollomi, Jimeng (即梦 AI), Web, Weixin (微信公众号)
- Grok, Doubao Web (豆包), Kimi, DeepSeek, Qwen (通义千问)

### 🖥️ Desktop Adapter Commands
Commands that interact with desktop applications via CDP or external CLI tools. See [desktop.md](./desktop.md) for full reference.

**Supported platforms:**
- GitHub (via gh CLI), Cursor, Codex, ChatGPT, ChatWise
- Notion, Discord App, Doubao App (豆包桌面版), Antigravity

### 🌐 Public API Commands
Commands that work without browser or authentication. See [public-api.md](./public-api.md) for full reference.

**Supported platforms:**
- Hacker News, V2EX (public features), BBC News, Sina Finance
- Lobsters, Google, DEV.to, Steam, Apple Podcasts
- arXiv, Bloomberg (RSS), Dictionary, HuggingFace
- StackOverflow, Xiaoyuzhou (小宇宙), Wikipedia, Product Hunt
