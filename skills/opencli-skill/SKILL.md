---
name: opencli-skill
description: 'Cross-platform web automation skill for search, retrieval, posting, interaction, and downloads. Supports platforms: 36kr, amazon, antigravity, apple-podcasts, arxiv, band, barchart, bbc, bilibili, bloomberg, bluesky, boss, chaoxing, chatgpt, chatwise, codex, coupang, ctrip, cursor, devto, dictionary, discord-app, douban, doubao, doubao-app, douyin, facebook, gemini, google, grok, hackernews, hf, imdb, instagram, jd, jike, jimeng, linkedin, linux-do, lobsters, medium, notebooklm, notion, ones, paperreview, pixiv, producthunt, reddit, reuters, sinablog, sinafinance, smzdm, spotify, stackoverflow, steam, substack, tieba, tiktok, twitter, v2ex, web, weibo, weixin, weread, wikipedia, xiaohongshu, xiaoyuzhou, xueqiu, yahoo-finance, yollomi, youtube, zhihu, zsxq.'
---

Use this skill as a platform command router.

Prerequisites and bootstrap:

- Ensure `opencli` is available. If missing, install:
  - `npm install -g @jackwener/opencli`
  - verify: `opencli --version`
- Before first real command, run:
  - `opencli doctor`
- If doctor reports extension/browser connectivity issue, prompt user to install Chrome Browser Bridge extension manually (same as README):
  - Install location: Chrome extension management page `chrome://extensions`
  - Option A (recommended): download `opencli-extension.zip` from OpenCLI Releases and install
  - Option B (dev mode): open `chrome://extensions` → enable Developer mode → click "Load unpacked" → select OpenCLI repo `extension/` directory
  - After install: keep Chrome open and logged into target platforms, then rerun `opencli doctor`

1. Detect target platform from user request.
2. Load `references/commands/<platform>.md`.
3. Select the command and fill required args.
4. Prefer `-f json` for parseable output.
5. If platform/command is unclear, ask one minimal clarification or run `opencli list` / `opencli <site> --help`.

All command docs live in:
- `references/commands/*.md`

Record workflow (for dynamic/auth-heavy pages):

- Start recording: `opencli record <url>`
- Optional args:
  - `--site <name>` specify site name
  - `--timeout <ms>` recording timeout (default 60000)
  - `--poll <ms>` polling interval (default 2000)
  - `--out <dir>` output directory
- During recording, manually operate the page in browser to trigger API calls.
- Output files:
  - `.opencli/record/<site>/captured.json`
  - `.opencli/record/<site>/candidates/*.yaml`
- Use record when `explore` cannot fully discover requests due to login state, SPA routing, or interaction-dependent APIs.

<!-- SUPPORTED_PLATFORMS:START -->
- Total: **73 platforms**, **461 commands**

- **36kr** (4): article, hot, news, search
- **amazon** (5): bestsellers, discussion, offer, product, search
- **antigravity** (9): dump, extract-code, model, new, read, send, serve, status, ... (+1)
- **apple-podcasts** (3): episodes, search, top
- **arxiv** (2): paper, search
- **band** (4): bands, mentions, post, posts
- **barchart** (4): flow, greeks, options, quote
- **bbc** (1): news
- **bilibili** (13): comments, download, dynamic, favorite, feed, following, history, hot, ... (+5)
- **bloomberg** (10): businessweek, economics, feeds, industries, main, markets, news, opinions, ... (+2)
- **bluesky** (9): feeds, followers, following, profile, search, starter-packs, thread, trending, ... (+1)
- **boss** (14): batchgreet, chatlist, chatmsg, detail, exchange, greet, invite, joblist, ... (+6)
- **chaoxing** (2): assignments, exams
- **chatgpt** (7): ask, ax, model, new, read, send, status
- **chatwise** (9): ask, export, history, model, new, read, screenshot, send, ... (+1)
- **codex** (11): ask, dump, export, extract-diff, history, model, new, read, ... (+3)
- **coupang** (2): add-to-cart, search
- **ctrip** (1): search
- **cursor** (12): ask, composer, dump, export, extract-code, history, model, new, ... (+4)
- **devto** (3): tag, top, user
- **dictionary** (3): examples, search, synonyms
- **discord-app** (7): channels, members, read, search, send, servers, status
- **douban** (9): book-hot, download, marks, movie-hot, photos, reviews, search, subject, ... (+1)
- **doubao** (9): ask, detail, history, meeting-summary, meeting-transcript, new, read, send, ... (+1)
- **doubao-app** (7): ask, dump, new, read, screenshot, send, status
- **douyin** (13): activities, collections, delete, draft, drafts, hashtag, location, profile, ... (+5)
- **facebook** (10): add-friend, events, feed, friends, groups, join-group, memories, notifications, ... (+2)
- **gemini** (3): ask, image, new
- **google** (4): news, search, suggest, trends
- **grok** (1): ask
- **hackernews** (8): ask, best, jobs, new, search, show, top, user
- **hf** (1): top
- **imdb** (6): person, reviews, search, title, top, trending
- **instagram** (15): comment, download, explore, follow, followers, following, like, profile, ... (+7)
- **jd** (1): item
- **jike** (10): comment, create, feed, like, notifications, post, repost, search, ... (+2)
- **jimeng** (2): generate, history
- **linkedin** (2): search, timeline
- **linux-do** (10): categories, category, feed, hot, latest, search, tags, topic, ... (+2)
- **lobsters** (4): active, hot, newest, tag
- **medium** (3): feed, search, user
- **notebooklm** (14): current, get, history, list, note-list, notes-get, open, rpc, ... (+6)
- **notion** (8): export, favorites, new, read, search, sidebar, status, write
- **ones** (11): common, enrich-tasks, login, logout, me, my-tasks, resolve-labels, task, ... (+3)
- **paperreview** (3): feedback, review, submit
- **pixiv** (6): detail, download, illusts, ranking, search, user
- **producthunt** (4): browse, hot, posts, today
- **reddit** (15): comment, frontpage, hot, popular, read, save, saved, search, ... (+7)
- **reuters** (1): search
- **sinablog** (4): article, hot, search, user
- **sinafinance** (3): news, rolling-news, stock
- **smzdm** (1): search
- **spotify** (1): spotify
- **stackoverflow** (4): bounties, hot, search, unanswered
- **steam** (1): top-sellers
- **substack** (3): feed, publication, search
- **tieba** (4): hot, posts, read, search
- **tiktok** (15): comment, explore, follow, following, friends, like, live, notifications, ... (+7)
- **twitter** (25): accept, article, block, bookmark, bookmarks, delete, download, follow, ... (+17)
- **v2ex** (11): daily, hot, latest, me, member, node, nodes, notifications, ... (+3)
- **web** (1): read
- **weibo** (7): comments, feed, hot, me, post, search, user
- **weixin** (1): download
- **weread** (7): book, highlights, notebooks, notes, ranking, search, shelf
- **wikipedia** (4): random, search, summary, trending
- **xiaohongshu** (13): comments, creator-note-detail, creator-notes, creator-notes-summary, creator-profile, creator-stats, download, feed, ... (+5)
- **xiaoyuzhou** (3): episode, podcast, podcast-episodes
- **xueqiu** (10): comments, earnings-date, feed, fund-holdings, fund-snapshot, hot, hot-stock, search, ... (+2)
- **yahoo-finance** (1): quote
- **yollomi** (12): background, edit, face-swap, generate, models, object-remover, remove-bg, restore, ... (+4)
- **youtube** (6): channel, comments, search, transcript, transcript-group, video
- **zhihu** (4): download, hot, question, search
- **zsxq** (5): dynamics, groups, search, topic, topics

_Coverage derived from source adapters._
<!-- SUPPORTED_PLATFORMS:END -->
