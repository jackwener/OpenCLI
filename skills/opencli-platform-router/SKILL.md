---
name: opencli-platform-router
description: Route social/content requests to OpenCLI by platform command docs (twitter, xiaohongshu, reddit, zhihu, bilibili, weibo, youtube, hackernews, v2ex, xueqiu, boss, yahoo, ctrip, reuters, bbc, smzdm, github). Use when user asks to browse trending, search content, fetch feeds, check bookmarks/history, or execute platform write actions like post/reply/like/check-in.
---

Route by platform command file.

1. Detect target platform from user request.
2. Load exactly one file under `references/commands/<platform>.md` first.
3. Compose OpenCLI command with minimal required args.
4. Prefer `-f json` for parseable output.
5. Require explicit confirmation before write actions: `post`, `reply`, `comment`, `like`, `checkin`, `delete`, `follow`, `merge`.
6. If platform command is unknown, ask one clarification question or run `opencli list`/`opencli <site> --help`.
7. Keep fallback safe: prefer read-only command when user intent is ambiguous.

Read workflow docs only when needed:
- `references/workflows/daily-brief.md`
- `references/workflows/content-post.md`

Platform command docs:
- `references/commands/twitter.md`
- `references/commands/xiaohongshu.md`
- `references/commands/reddit.md`
- `references/commands/zhihu.md`
- `references/commands/bilibili.md`
- `references/commands/weibo.md`
- `references/commands/youtube.md`
- `references/commands/hackernews.md`
- `references/commands/v2ex.md`
- `references/commands/xueqiu.md`
- `references/commands/boss.md`
- `references/commands/yahoo.md`
- `references/commands/ctrip.md`
- `references/commands/reuters.md`
- `references/commands/bbc.md`
- `references/commands/smzdm.md`
- `references/commands/github.md`
