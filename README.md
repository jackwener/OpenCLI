# OpenCLI

> **Turn websites, browser sessions, Electron apps, and local tools into deterministic interfaces for humans and AI agents.**
> Reuse your logged-in browser, automate live workflows, and crystallize repeated actions into reusable CLI commands.

[![中文文档](https://img.shields.io/badge/docs-%E4%B8%AD%E6%96%87-0F766E?style=flat-square)](./README.zh-CN.md)
[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](./LICENSE)

OpenCLI gives you one surface for three different kinds of automation:

- **Use built-in adapters** for sites like Bilibili, Zhihu, Xiaohongshu, Reddit, HackerNews, Twitter/X, and [many more](#built-in-commands).
- **Let AI Agents operate any website** — install the `opencli-browser` skill in your AI agent (Claude Code, Cursor, etc.), and it can navigate, click, type, extract, and inspect any page using your logged-in browser.
- **Generate new adapters** from real browser behavior with `explore`, `synthesize`, `generate`, and `cascade`.

It also works as a **CLI hub** for local tools such as `gh`, `docker`, and other binaries you register yourself, plus **desktop app adapters** for Electron apps like Cursor, Codex, Antigravity, ChatGPT, and Notion.

## Highlights

- **Desktop App Control** — Drive Electron apps (Cursor, Codex, ChatGPT, Notion, etc.) directly from the terminal via CDP.
- **Browser Automation for AI Agents** — Install the `opencli-browser` skill, and your AI agent can operate any website: navigate, click, type, extract, screenshot — all through your logged-in Chrome session.
- **Website → CLI** — Turn any website into a deterministic CLI: 90+ pre-built adapters, or generate your own with `opencli generate`.
- **Account-safe** — Reuses Chrome/Chromium logged-in state; your credentials never leave the browser.
- **AI Agent ready** — `explore` discovers APIs, `synthesize` generates adapters, `cascade` finds auth strategies. The `opencli-browser` skill gives any AI agent full browser control.
- **CLI Hub** — Discover, auto-install, and passthrough commands to any external CLI (gh, docker, obsidian, etc).
- **Zero LLM cost** — No tokens consumed at runtime. Run 10,000 times and pay nothing.
- **Deterministic** — Same command, same output schema, every time. Pipeable, scriptable, CI-friendly.

---

## Quick Start

### 1. Install OpenCLI

```bash
npm install -g @jackwener/opencli
```

### 2. Install the Browser Bridge Extension

OpenCLI connects to Chrome/Chromium through a lightweight Browser Bridge extension plus a small local daemon. The daemon auto-starts when needed.

1. Download the latest `opencli-extension-v{version}.zip` from the GitHub [Releases page](https://github.com/jackwener/opencli/releases).
2. Unzip it, open `chrome://extensions`, and enable **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

### 3. Verify the setup

```bash
opencli doctor
```

### 4. Run your first commands

```bash
opencli list
opencli hackernews top --limit 5
opencli bilibili hot --limit 5
```

## For Humans

Use OpenCLI directly when you want a reliable command instead of a live browser session:

- `opencli list` shows every registered command.
- `opencli <site> <command>` runs a built-in or generated adapter.
- `opencli register mycli` exposes a local CLI through the same discovery surface.
- `opencli doctor` helps diagnose browser connectivity.

## For AI Agents

OpenCLI's browser commands are designed to be used by AI Agents — not run manually. Install skills into your AI agent (Claude Code, Cursor, etc.), and the agent operates websites on your behalf using your logged-in Chrome session.

### Install skills

```bash
npx skills add jackwener/opencli
```

Or install only what you need:

```bash
npx skills add jackwener/opencli --skill opencli-usage
npx skills add jackwener/opencli --skill opencli-browser
npx skills add jackwener/opencli --skill opencli-explorer
npx skills add jackwener/opencli --skill opencli-oneshot
```

### Which skill to use

| Skill | When to use | Example prompt to your AI agent |
|-------|------------|-------------------------------|
| **opencli-browser** | Operate any website in real time | "Help me post this content on Xiaohongshu" / "Check my Twitter notifications and summarize them" |
| **opencli-explorer** | Create a reusable CLI for a site | "Generate an adapter for douyin trending" |
| **opencli-oneshot** | Quick one-off: URL + goal → adapter | "Make a command that grabs the top posts from this page" |
| **opencli-usage** | Use existing built-in adapters | "Get the top 5 Bilibili trending videos" |

### How it works

Once the `opencli-browser` skill is installed, your AI agent can:

1. **Navigate** to any URL using your logged-in browser
2. **Read** page content via structured DOM snapshots (not screenshots)
3. **Interact** — click buttons, fill forms, select options, press keys
4. **Extract** data from the page or intercept network API responses
5. **Wait** for elements, text, or page transitions

The agent handles all the `opencli browser` commands internally — you just describe what you want done in natural language.

**Skill references:**
- [`skills/opencli-browser/SKILL.md`](./skills/opencli-browser/SKILL.md) — real-time browser operation
- [`skills/opencli-explorer/SKILL.md`](./skills/opencli-explorer/SKILL.md) — adapter creation workflow

Available browser commands include `open`, `state`, `click`, `type`, `select`, `keys`, `wait`, `get`, `screenshot`, `scroll`, `back`, `eval`, `network`, `tab list`, `tab new`, `tab select`, `tab close`, `init`, `verify`, and `close`.

`opencli browser open <url>` and `opencli browser tab new [url]` both return a target ID. Use `opencli browser tab list` to inspect the target IDs of tabs that already exist, then pass `--tab <targetId>` to route a command to a specific tab. `tab new` creates a new tab without changing the default browser target; only `tab select <targetId>` promotes that tab to the default target for later untargeted `opencli browser ...` commands.

## Core Concepts

### `browser`: AI Agent browser control

`opencli browser` commands are the low-level primitives that AI Agents use to operate websites. You don't run these manually — instead, install the `opencli-browser` skill into your AI agent, describe what you want in natural language, and the agent handles the browser operations.

For example, tell your agent: *"Help me check my Xiaohongshu notifications"* — the agent will use `opencli browser open`, `state`, `click`, etc. under the hood.

### Built-in adapters: stable commands

Use site-specific commands such as `opencli hackernews top` or `opencli reddit hot` when the capability already exists. These are deterministic and work without browser — ideal for both humans and AI agents.

### `explore` / `synthesize` / `generate`: create new CLIs

Use these commands when the site you need is not covered yet:

- `explore` inspects the page, network activity, and capability surface.
- `synthesize` turns exploration artifacts into evaluate-based JS adapters.
- `generate` runs the verified generation path and returns either a usable command or a structured explanation of why completion was blocked or needs human review.

### `cascade`: auth strategy discovery

Use `cascade` to probe fallback auth paths such as public endpoints, cookies, and custom headers before you commit to an adapter design.

### CLI Hub and desktop adapters

OpenCLI is not only for websites. It can also:

- expose local binaries like `gh`, `docker`, `obsidian`, or custom tools through `opencli <tool> ...`
- control Electron desktop apps through dedicated adapters and CDP-backed integrations

## Prerequisites

- **Node.js**: >= 21.0.0 (or **Bun** >= 1.0)
- **Chrome or Chromium** running and logged into the target site for browser-backed commands

> **Important**: Browser-backed commands reuse your Chrome/Chromium login session. If you get empty data or permission-like failures, first confirm the site is already open and authenticated in Chrome/Chromium.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLI_DAEMON_PORT` | `19825` | HTTP port for the daemon-extension bridge |
| `OPENCLI_WINDOW_FOCUSED` | `false` | Set to `1` to open automation windows in the foreground (useful for debugging) |
| `OPENCLI_BROWSER_CONNECT_TIMEOUT` | `30` | Seconds to wait for browser connection |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | `60` | Seconds to wait for a single browser command |
| `OPENCLI_BROWSER_EXPLORE_TIMEOUT` | `120` | Seconds to wait for explore/record operations |
| `OPENCLI_CDP_ENDPOINT` | — | Chrome DevTools Protocol endpoint for remote browser or Electron apps |
| `OPENCLI_CDP_TARGET` | — | Filter CDP targets by URL substring (e.g. `detail.1688.com`) |
| `OPENCLI_VERBOSE` | `false` | Enable verbose logging (`-v` flag also works) |
| `OPENCLI_DIAGNOSTIC` | `false` | Set to `1` to capture structured diagnostic context on failures |
| `DEBUG_SNAPSHOT` | — | Set to `1` for DOM snapshot debug output |

## Update

```bash
npm install -g @jackwener/opencli@latest

# If you use the packaged OpenCLI skills, refresh them too
npx skills add jackwener/opencli
```

Or refresh only the skills you actually use:

```bash
npx skills add jackwener/opencli --skill opencli-usage
npx skills add jackwener/opencli --skill opencli-browser
npx skills add jackwener/opencli --skill opencli-explorer
npx skills add jackwener/opencli --skill opencli-oneshot
```

## For Developers

Install from source:

```bash
git clone git@github.com:jackwener/opencli.git
cd opencli
npm install
npm run build
npm link
```

To load the source Browser Bridge extension:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this repository's `extension/` directory.

## Built-in Commands

| Site | Commands |
|------|----------|
| **xiaohongshu** | `search` `note` `comments` `feed` `user` `download` `publish` `notifications` `creator-notes` `creator-notes-summary` `creator-note-detail` `creator-profile` `creator-stats` |
| **bilibili** | `hot` `search` `history` `feed` `ranking` `download` `comments` `dynamic` `favorite` `following` `me` `subtitle` `user-videos` |
| **tieba** | `hot` `posts` `search` `read` |
| **hupu** | `hot` `search` `detail` `mentions` `reply` `like` `unlike` |
| **twitter** | `trending` `search` `timeline` `lists` `list-tweets` `list-add` `list-remove` `bookmarks` `post` `download` `profile` `article` `like` `likes` `notifications` `reply` `reply-dm` `thread` `follow` `unfollow` `followers` `following` `block` `unblock` `bookmark` `unbookmark` `delete` `hide-reply` `accept` |
| **reddit** | `hot` `frontpage` `popular` `search` `subreddit` `read` `user` `user-posts` `user-comments` `upvote` `upvoted` `save` `saved` `comment` `subscribe` |
| **zhihu** | `hot` `search` `question` `download` `follow` `like` `favorite` `comment` `answer` |
| **amazon** | `bestsellers` `search` `product` `offer` `discussion` `movers-shakers` `new-releases` |
| **1688** | `search` `item` `assets` `download` `store` |
| **gitee** | `trending` `search` `user` |
| **gemini** | `new` `ask` `image` `deep-research` `deep-research-result` |
| **yuanbao** | `new` `ask` |
| **notebooklm** | `status` `list` `open` `current` `get` `history` `summary` `note-list` `notes-get` `source-list` `source-get` `source-fulltext` `source-guide` |
| **spotify** | `auth` `status` `play` `pause` `next` `prev` `volume` `search` `queue` `shuffle` `repeat` |
| **xianyu** | `search` `item` `chat` |
| **xiaoe** | `courses` `detail` `catalog` `play-url` `content` |
| **quark** | `ls` `mkdir` `mv` `rename` `rm` `save` `share-tree` |
| **uiverse** | `code` `preview` |
| **baidu-scholar** | `search` |
| **google-scholar** | `search` |
| **gov-law** | `search` `recent` |
| **gov-policy** | `search` `recent` |
| **nowcoder** | `hot` `trending` `topics` `recommend` `creators` `companies` `jobs` `search` `suggest` `experience` `referral` `salary` `papers` `practice` `notifications` `detail` |
| **wanfang** | `search` |
| **xiaoyuzhou** | `podcast*` `podcast-episodes*` `episode*` `download*` `transcript*` |

90+ adapters in total — **[→ see all supported sites & commands](./docs/adapters/index.md)**

`*` `opencli xiaoyuzhou podcast`, `podcast-episodes`, `episode`, `download`, and `transcript` require local Xiaoyuzhou credentials in `~/.opencli/xiaoyuzhou.json`.

## CLI Hub

OpenCLI acts as a universal hub for your existing command-line tools — unified discovery, pure passthrough execution, and auto-install (if a tool isn't installed, OpenCLI runs `brew install <tool>` automatically before re-running the command).

| External CLI | Description | Example |
|--------------|-------------|---------|
| **gh** | GitHub CLI | `opencli gh pr list --limit 5` |
| **obsidian** | Obsidian vault management | `opencli obsidian search query="AI"` |
| **docker** | Docker | `opencli docker ps` |
| **lark-cli** | Lark/Feishu — messages, docs, calendar, tasks, 200+ commands | `opencli lark-cli calendar +agenda` |
| **dingtalk** | DingTalk — cross-platform CLI for DingTalk's full suite, designed for humans and AI agents | `opencli dingtalk msg send --to user "hello"` |
| **wecom** | WeCom/企业微信 — CLI for WeCom open platform, for humans and AI agents | `opencli wecom msg send --to user "hello"` |
| **vercel** | Vercel — deploy projects, manage domains, env vars, logs | `opencli vercel deploy --prod` |

**Register your own** — add any local CLI so AI agents can discover it via `opencli list`:

```bash
opencli register mycli
```

### Desktop App Adapters

Control Electron desktop apps directly from the terminal. Each adapter has its own detailed documentation:

| App | Description | Doc |
|-----|-------------|-----|
| **Cursor** | Control Cursor IDE — Composer, chat, code extraction | [Doc](./docs/adapters/desktop/cursor.md) |
| **Codex** | Drive OpenAI Codex CLI agent headlessly | [Doc](./docs/adapters/desktop/codex.md) |
| **Antigravity** | Control Antigravity Ultra from terminal | [Doc](./docs/adapters/desktop/antigravity.md) |
| **ChatGPT App** | Automate ChatGPT macOS desktop app | [Doc](./docs/adapters/desktop/chatgpt-app.md) |
| **ChatWise** | Multi-LLM client (GPT-4, Claude, Gemini) | [Doc](./docs/adapters/desktop/chatwise.md) |
| **Notion** | Search, read, write Notion pages | [Doc](./docs/adapters/desktop/notion.md) |
| **Discord** | Discord Desktop — messages, channels, servers | [Doc](./docs/adapters/desktop/discord.md) |
| **Doubao** | Control Doubao AI desktop app via CDP | [Doc](./docs/adapters/desktop/doubao-app.md) |

To add a new Electron app, start with [docs/guide/electron-app-cli.md](./docs/guide/electron-app-cli.md).

## Download Support

OpenCLI supports downloading images, videos, and articles from supported platforms.

| Platform | Content Types | Notes |
|----------|---------------|-------|
| **xiaohongshu** | Images, Videos | Downloads all media from a note |
| **bilibili** | Videos | Requires `yt-dlp` installed |
| **twitter** | Images, Videos | From user media tab or single tweet |
| **douban** | Images | Poster / still image lists |
| **pixiv** | Images | Original-quality illustrations, multi-page |
| **1688** | Images, Videos | Downloads page-visible product media from item pages |
| **xiaoyuzhou** | Audio, Transcript | Downloads episode audio and transcript JSON/text with local credentials |
| **zhihu** | Articles (Markdown) | Exports with optional image download |
| **weixin** | Articles (Markdown) | WeChat Official Account articles |

For video downloads, install `yt-dlp` first: `brew install yt-dlp`

```bash
opencli xiaohongshu download "https://www.xiaohongshu.com/search_result/<id>?xsec_token=..." --output ./xhs
opencli xiaohongshu download "https://xhslink.com/..." --output ./xhs
opencli bilibili download BV1xxx --output ./bilibili
opencli twitter download elonmusk --limit 20 --output ./twitter
opencli 1688 download 841141931191 --output ./1688-downloads
opencli xiaoyuzhou download 69b3b675772ac2295bfc01d0 --output ./xiaoyuzhou
opencli xiaoyuzhou transcript 69dd0c98e2c8be31551f6a33 --output ./xiaoyuzhou-transcripts
```

`opencli xiaoyuzhou download` and `transcript` require local Xiaoyuzhou credentials in `~/.opencli/xiaoyuzhou.json`.

## Output Formats

Registry-backed commands, `opencli list`, and `opencli plugin list` support `--format` / `-f` with `yaml` as the default path. Rich-text formats such as `table`, `md`, and `csv` remain explicit opt-ins.

```bash
opencli bilibili hot -f json    # Pipe to jq or LLMs
opencli bilibili hot -f csv     # Spreadsheet-friendly
opencli bilibili hot -v         # Verbose: show pipeline debug steps
```

## Exit Codes

opencli follows Unix `sysexits.h` conventions so it integrates naturally with shell pipelines and CI scripts:

| Code | Meaning | When |
|------|---------|------|
| `0` | Success | Command completed normally |
| `1` | Generic error | Unexpected / unclassified failure |
| `2` | Usage error | Bad arguments or unknown command |
| `66` | Empty result | No data returned (`EX_NOINPUT`) |
| `69` | Service unavailable | Browser Bridge not connected (`EX_UNAVAILABLE`) |
| `75` | Temporary failure | Command timed out — retry (`EX_TEMPFAIL`) |
| `77` | Auth required | Not logged in to target site (`EX_NOPERM`) |
| `78` | Config error | Missing credentials or bad config (`EX_CONFIG`) |
| `130` | Interrupted | Ctrl-C / SIGINT |

```bash
opencli spotify status || echo "exit $?"   # 69 if browser not running
opencli github issues 2>/dev/null
[ $? -eq 77 ] && opencli github auth       # auto-auth if not logged in
```

## Plugins

Extend OpenCLI with community-contributed adapters:

```bash
opencli plugin install github:user/opencli-plugin-my-tool
opencli plugin list
opencli plugin update --all
opencli plugin uninstall my-tool
```

| Plugin | Type | Description |
|--------|------|-------------|
| [opencli-plugin-github-trending](https://github.com/ByteYue/opencli-plugin-github-trending) | JS | GitHub Trending repositories |
| [opencli-plugin-hot-digest](https://github.com/ByteYue/opencli-plugin-hot-digest) | JS | Multi-platform trending aggregator |
| [opencli-plugin-juejin](https://github.com/Astro-Han/opencli-plugin-juejin) | JS | 稀土掘金 (Juejin) hot articles |
| [opencli-plugin-vk](https://github.com/flobo3/opencli-plugin-vk) | JS | VK (VKontakte) wall, feed, and search |

See [Plugins Guide](./docs/guide/plugins.md) for creating your own plugin.

## For AI Agents (Developer Guide)

> **Quick mode**: To generate a single command for a specific page URL, see [opencli-oneshot skill](./skills/opencli-oneshot/SKILL.md) — just a URL + one-line goal, 4 steps done.

> **Full mode**: Before writing any adapter code, read [opencli-explorer skill](./skills/opencli-explorer/SKILL.md). It contains the complete browser exploration workflow, the 5-tier authentication strategy decision tree, and debugging guide.

```bash
opencli explore https://example.com --site mysite   # Discover APIs + capabilities
opencli synthesize mysite                            # Generate JS adapters
opencli generate https://example.com --goal "hot"   # One-shot: explore → synthesize → register
opencli cascade https://api.example.com/data         # Auto-probe: PUBLIC → COOKIE → HEADER
```

## Testing

See **[TESTING.md](./TESTING.md)** for how to run and write tests.

## Troubleshooting

- **"Extension not connected"** — Ensure the Browser Bridge extension is installed and **enabled** in `chrome://extensions` in Chrome or Chromium.
- **"attach failed: Cannot access a chrome-extension:// URL"** — Another extension may be interfering. Try disabling other extensions temporarily.
- **Empty data or 'Unauthorized' error** — Your Chrome/Chromium login session may have expired. Navigate to the target site and log in again.
- **Node API errors** — Ensure Node.js >= 21. Some features require `node:util` styleText (stable in Node 21+).
- **Daemon issues** — Check status: `curl localhost:19825/status` · View logs: `curl localhost:19825/logs`

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jackwener/opencli&type=Date)](https://star-history.com/#jackwener/opencli&Date)

## License

[Apache-2.0](./LICENSE)
