---
name: opencli-skill
description: Make any website or Electron app your CLI — reuse Chrome login to search, post, download, publish, follow, automate, and more across 60+ platforms (bilibili, zhihu, twitter, xiaohongshu, douyin, youtube, reddit, linkedin, pixiv, jd, weibo, xueqiu, notion, discord, etc.) with zero credential risk. Covers browser-based, public API, and desktop (CDP/Electron) adapters, plus AI-powered API discovery and record workflows for new sites.
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
