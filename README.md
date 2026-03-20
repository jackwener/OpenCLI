# OpenCLI

> **Make any website, Electron App, or Local Tool your CLI.**  
> Zero risk · Reuse Chrome login · AI-powered discovery · Universal CLI Hub

[中文文档](./README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](./LICENSE)

A CLI tool that turns **any website** or **Electron app** into a command-line interface — Bilibili, Zhihu, 小红书, Twitter/X, Reddit, YouTube, Antigravity, and [many more](#built-in-commands) — powered by browser session reuse and AI-native discovery.

💡 **Built for AI Agents**: Simply configure an instruction in your global `AGENT.md` or `.cursorrules` guiding the AI to execute `opencli list` via Bash to discover available tools. Register your favorite local CLIs (`opencli register mycli`), and the AI will automatically learn how to invoke all your tools perfectly!

🔥 **CLI All Electron Apps! The Most Powerful Update Has Arrived!** 🔥
Turn ANY Electron application into a CLI tool! Recombine, script, and extend applications like Antigravity Ultra seamlessly. Now AI can control itself natively. Unlimited possibilities await!

---

## Table of Contents

- [Highlights](#highlights)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Browser Backend Utilities](#browser-backend-utilities)
- [Built-in Commands](#built-in-commands)
  - [Desktop App Adapters](#desktop-app-adapters)
- [Download Support](#download-support)
- [Output Formats](#output-formats)
- [For AI Agents (Developer Guide)](#for-ai-agents-developer-guide)
- [Remote Chrome (Server/Headless)](#remote-chrome-serverheadless)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Releasing New Versions](#releasing-new-versions)
- [License](#license)

---

## Highlights

- **CLI All Electron** — CLI-ify apps like Antigravity Ultra! Now AI can control itself natively using cc/openclaw!
- **Account-safe** — Reuses Chrome's logged-in state; your credentials never leave the browser.
- **AI Agent ready** — `explore` discovers APIs, `synthesize` generates adapters, `cascade` finds auth strategies.
- **External CLI Hub** — Discover, auto-install, and passthrough commands to any external CLI (gh, obsidian, docker, kubectl, etc). Zero setup.
- **Self-healing setup** — `opencli setup` verifies Browser Bridge connectivity; `opencli doctor` diagnoses daemon, extension, and live browser connectivity.
- **Dynamic Loader** — Simply drop `.ts` or `.yaml` adapters into the `clis/` folder for auto-registration.
- **Dual-Engine Architecture** — Supports both YAML declarative data pipelines and robust browser runtime TypeScript injections.

## Prerequisites

- **Node.js**: >= 20.0.0
- **Chrome** running **and logged into the target site** (e.g. bilibili.com, zhihu.com, xiaohongshu.com).

> **⚠️ Important**: Browser commands reuse your Chrome login session. You must be logged into the target website in Chrome before running commands. If you get empty data or errors, check your login status first.

OpenCLI connects to your browser through a lightweight **Browser Bridge** Chrome Extension + micro-daemon (zero config, auto-start).

### Browser Bridge Extension Setup

You can install the extension via either method:

**Method 1: Download Pre-built Release (Recommended)**
1. Go to the GitHub [Releases page](https://github.com/jackwener/opencli/releases) and download the latest `opencli-extension.zip` or `opencli-extension.crx`.
2. Open `chrome://extensions` and enable **Developer mode** (top-right toggle).
3. Drag and drop the `.crx` file or the unzipped folder into the extensions page.

**Method 2: Load Unpacked Source (For Developers)**
1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` directory from this repository.

That's it! The daemon auto-starts when you run any browser command. No tokens, no manual configuration.

> **Tip**: Use `opencli doctor` for ongoing diagnosis:
> ```bash
> opencli doctor            # Check extension + daemon connectivity
> opencli doctor --live     # Also test live browser commands
> ```

## Quick Start

### Install via npm (recommended)

```bash
npm install -g @jackwener/opencli
```

Then use directly:

```bash
opencli list                              # See all commands
opencli list -f yaml                      # List commands as YAML
opencli hackernews top --limit 5          # Public API, no browser
opencli bilibili hot --limit 5            # Browser command
opencli zhihu hot -f json                 # JSON output
opencli zhihu hot -f yaml                 # YAML output
```

### Install from source (for developers)

```bash
git clone git@github.com:jackwener/opencli.git
cd opencli 
npm install
npm run build
npm link      # Link binary globally
opencli list  # Now you can use it anywhere!
```

### Update

```bash
npm install -g @jackwener/opencli@latest
```

## Browser Backend Utilities

OpenCLI also ships an additive `browser` command group for managing extension/CDP workflows without changing any existing site commands.

```bash
opencli browser list
opencli browser launch --port 9222
opencli browser launch --port 9222 --profile zhihu
opencli browser launch --port 9222 --browser-arg=--window-size=1440,900
opencli browser run --backend cdp --cdp-endpoint http://127.0.0.1:9222 -- zhihu search --keyword AI
opencli browser stop --port 9222
opencli browser profiles
opencli browser profiles rm zhihu
opencli browser profiles prune --temporary
```

- `launch` uses a temporary browser profile by default.
- Pass `--profile <name>` when you want to preserve login state or browser data.
- Use `--browser-arg <arg>` to pass extra raw Chrome/Chromium launch flags.
- `stop` only stops browser processes.
- `profiles rm <name>` removes a named persistent profile.
- `profiles prune --temporary` removes unused temporary profiles.
- `doctor` works for both extension mode and direct CDP mode.

For remote or headless CDP setups, see [Connecting OpenCLI via CDP](./docs/advanced/cdp.md).

## Built-in Commands

Run `opencli list` for the live registry.

| Site | Commands | Mode |
|------|----------|------|
| **twitter** | `trending` `bookmarks` `profile` `search` `timeline` `thread` `following` `followers` `notifications` `post` `reply` `delete` `like` `article` `follow` `unfollow` `bookmark` `unbookmark` `download` `accept` `reply-dm` | Browser |
| **reddit** | `hot` `frontpage` `popular` `search` `subreddit` `read` `user` `user-posts` `user-comments` `upvote` `save` `comment` `subscribe` `saved` `upvoted` | Browser |
| **cursor** | `status` `send` `read` `new` `dump` `composer` `model` `extract-code` `ask` `screenshot` `history` `export` | Desktop |
| **bilibili** | `hot` `search` `me` `favorite` `history` `feed` `subtitle` `dynamic` `ranking` `following` `user-videos` `download` | Browser |
| **codex** | `status` `send` `read` `new` `extract-diff` `model` `ask` `screenshot` `history` `export` | Desktop |
| **chatwise** | `status` `new` `send` `read` `ask` `model` `history` `export` `screenshot` | Desktop |
| **notion** | `status` `search` `read` `new` `write` `sidebar` `favorites` `export` | Desktop |
| **discord-app** | `status` `send` `read` `channels` `servers` `search` `members` | Desktop |
| **v2ex** | `hot` `latest` `topic` `daily` `me` `notifications` | Public / Browser |
| **xueqiu** | `feed` `hot-stock` `hot` `search` `stock` `watchlist` | Browser |
| **antigravity** | `status` `send` `read` `new` `dump` `extract-code` `model` `watch` | Desktop |
| **chatgpt** | `status` `new` `send` `read` `ask` | Desktop |
| **xiaohongshu** | `search` `notifications` `feed` `me` `user` `download` | Browser |
| **apple-podcasts** | `search` `episodes` `top` | Public |
| **xiaoyuzhou** | `podcast` `podcast-episodes` `episode` | Public |
| **zhihu** | `hot` `search` `question` `download` | Browser |
| **youtube** | `search` `video` `transcript` | Browser |
| **boss** | `search` `detail` | Browser |
| **coupang** | `search` `add-to-cart` | Browser |
| **bbc** | `news` | Public |
| **bloomberg** | `main` `markets` `economics` `industries` `tech` `politics` `businessweek` `opinions` `feeds` `news` | Public / Browser |
| **ctrip** | `search` | Browser |
| **github** | `search` | Public |
| **arxiv** | `search` `paper` | Public |
| **wikipedia** | `search` `summary` | Public |
| **hackernews** | `top` | Public |
| **linkedin** | `search` | Browser |
| **reuters** | `search` | Browser |
| **smzdm** | `search` | Browser |
| **weibo** | `hot` | Browser |
| **yahoo-finance** | `quote` | Browser |
| **sinafinance** | `news` | 🌐 Public |

> **Bloomberg note**: The RSS-backed Bloomberg listing commands (`main`, section feeds, `feeds`) work without a browser. `bloomberg news` is for standard Bloomberg story/article pages that your current Chrome session can already access. Audio and some other non-standard pages may fail, and OpenCLI does not bypass Bloomberg paywall or entitlement checks.

### External CLI Hub

OpenCLI acts as a universal hub for your existing command-line tools. It provides unified discovery, automatic installation, and pure passthrough execution.

| External CLI | Description | Commands Example |
|--------------|-------------|------------------|
| **gh** | GitHub CLI | `opencli gh pr list --limit 5` |
| **obsidian** | Obsidian vault management | `opencli obsidian search query="AI"` |
| **docker** | Docker command-line interface | `opencli docker ps` |
| **kubectl** | Kubernetes command-line tool | `opencli kubectl get pods` |
| **readwise** | Readwise & Reader CLI | `opencli readwise login` |

**Zero Configuration**: OpenCLI purely passes your inputs to the underlying binary via standard I/O streams. The external CLI works exactly as it naturally would, maintaining its standard output formats.

**Auto-Installation**: If you run `opencli gh ...` and `gh` is not installed on your system, OpenCLI will automatically try to install it using your system's package manager (e.g., `brew install gh`) before seamlessly re-running the command.

**Register Your Own**:
Add any local CLI to your OpenCLI registry so AI agents can automatically discover it via the `opencli list` command.
```bash
opencli register mycli
```

### Desktop App Adapters

Each desktop adapter has its own detailed documentation with commands reference, setup guide, and examples:

| App | Description | Doc |
|-----|-------------|-----|
| **Cursor** | Control Cursor IDE — Composer, chat, code extraction | [Doc](./docs/adapters/desktop/cursor.md) |
| **Codex** | Drive OpenAI Codex CLI agent headlessly | [Doc](./docs/adapters/desktop/codex.md) |
| **Antigravity** | Control Antigravity Ultra from terminal | [Doc](./docs/adapters/desktop/antigravity.md) |
| **ChatGPT** | Automate ChatGPT macOS desktop app | [Doc](./docs/adapters/desktop/chatgpt.md) |
| **ChatWise** | Multi-LLM client (GPT-4, Claude, Gemini) | [Doc](./docs/adapters/desktop/chatwise.md) |
| **Notion** | Search, read, write Notion pages | [Doc](./docs/adapters/desktop/notion.md) |
| **Discord** | Discord Desktop — messages, channels, servers | [Doc](./docs/adapters/desktop/discord.md) |
| **Feishu** | 飞书/Lark Desktop via AppleScript | [Doc](./docs/adapters/desktop/feishu.md) |
| **WeChat** | 微信 Desktop via AppleScript + Accessibility | [Doc](./docs/adapters/desktop/wechat.md) |
| **NeteaseMusic** | 网易云音乐 Desktop via CEF/CDP | [Doc](./docs/adapters/desktop/neteasemusic.md) |

## Download Support

OpenCLI supports downloading images, videos, and articles from supported platforms.

### Supported Platforms

| Platform | Content Types | Notes |
|----------|---------------|-------|
| **xiaohongshu** | Images, Videos | Downloads all media from a note |
| **bilibili** | Videos | Requires `yt-dlp` installed |
| **twitter** | Images, Videos | Downloads from user media tab or single tweet |
| **zhihu** | Articles (Markdown) | Exports articles with optional image download |

### Prerequisites

For video downloads from streaming platforms, you need to install `yt-dlp`:

```bash
# Install yt-dlp
pip install yt-dlp
# or
brew install yt-dlp
```

### Usage Examples

```bash
# Download images/videos from Xiaohongshu note
opencli xiaohongshu download --note_id abc123 --output ./xhs

# Download Bilibili video (requires yt-dlp)
opencli bilibili download --bvid BV1xxx --output ./bilibili
opencli bilibili download --bvid BV1xxx --quality 1080p  # Specify quality

# Download Twitter media from user
opencli twitter download --username elonmusk --limit 20 --output ./twitter

# Download single tweet media
opencli twitter download --tweet-url "https://x.com/user/status/123" --output ./twitter

# Export Zhihu article to Markdown
opencli zhihu download --url "https://zhuanlan.zhihu.com/p/xxx" --output ./zhihu

# Export with local images
opencli zhihu download --url "https://zhuanlan.zhihu.com/p/xxx" --download-images
```

### Pipeline Step (for YAML adapters)

The `download` step can be used in YAML pipelines:

```yaml
pipeline:
  - fetch: https://api.example.com/media
  - download:
      url: ${{ item.imageUrl }}
      dir: ./downloads
      filename: ${{ item.title | sanitize }}.jpg
      concurrency: 5
      skip_existing: true
```

## Output Formats

All built-in commands support `--format` / `-f` with `table`, `json`, `yaml`, `md`, and `csv`.
The `list` command supports the same format options, and keeps `--json` for backward compatibility.

```bash
opencli list -f yaml            # Command registry as YAML
opencli bilibili hot -f table   # Default: rich terminal table
opencli bilibili hot -f json    # JSON (pipe to jq or LLMs)
opencli bilibili hot -f yaml    # YAML (human-readable structured output)
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
opencli bilibili hot -v         # Verbose: show pipeline debug steps
```

## For AI Agents (Developer Guide)

If you are an AI assistant tasked with creating a new command adapter for `opencli`, please follow the AI Agent workflow below:

> **Quick mode**: To generate a single command for a specific page URL, see [CLI-ONESHOT.md](./CLI-ONESHOT.md) — just a URL + one-line goal, 4 steps done.

> **Full mode**: Before writing any adapter code, read [CLI-EXPLORER.md](./CLI-EXPLORER.md). It contains the complete browser exploration workflow, the 5-tier authentication strategy decision tree, and debugging guide.

```bash
# 1. Deep Explore — discover APIs, infer capabilities, detect framework
opencli explore https://example.com --site mysite

# 2. Synthesize — generate YAML adapters from explore artifacts
opencli synthesize mysite

# 3. Generate — one-shot: explore → synthesize → register
opencli generate https://example.com --goal "hot"

# 4. Strategy Cascade — auto-probe: PUBLIC → COOKIE → HEADER
opencli cascade https://api.example.com/data
```

Explore outputs to `.opencli/explore/<site>/` (manifest.json, endpoints.json, capabilities.json, auth.json).

## Testing

See **[TESTING.md](./TESTING.md)** for the full testing guide, including:

- Current test coverage (unit + E2E tests across browser and desktop adapters)
- How to run tests locally
- How to add tests when creating new adapters
- CI/CD pipeline with sharding
- Headless browser mode (`OPENCLI_HEADLESS=1`)

```bash
# Quick start
npm run build
npx vitest run                              # All tests
npx vitest run src/                          # Unit tests only
npx vitest run tests/e2e/                    # E2E tests
```

## Troubleshooting

- **"Extension not connected"**
  - Ensure the opencli Browser Bridge extension is installed and **enabled** in `chrome://extensions`.
- **Empty data returns or 'Unauthorized' error**
  - Your login session in Chrome might have expired. Open a normal Chrome tab, navigate to the target site, and log in or refresh the page.
- **Node API errors**
  - Make sure you are using Node.js >= 20. Some dependencies require modern Node APIs.
- **Daemon issues**
  - Check daemon status: `curl localhost:19825/status`
  - View extension logs: `curl localhost:19825/logs`

## Releasing New Versions

```bash
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
git push --follow-tags
```

The CI will automatically build, create a GitHub release, and publish to npm.

## License

[Apache-2.0](./LICENSE)
