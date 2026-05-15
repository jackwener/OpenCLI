---
name: opencli-usage
description: Use at the start of any OpenCLI session — this is the top-level map of what `opencli` can do, how to discover adapters, what flags and output formats are universal, and which specialized skill to load next. Point here when an agent asks "what can opencli do?" or "how do I find the right command?".
allowed-tools: Bash(opencli:*), Read
---

# opencli-usage

OpenCLI turns any website, Electron desktop app, or external CLI into a uniform `opencli <site> <command>` surface that agents can drive without screen-scraping. This skill is the orientation layer — once you know what you want to do, load one of the specialized skills below.

## The three pillars

- **Adapter commands** — `opencli <site> <command> [...]`. Built-in adapters live in `clis/`, user adapters in `~/.opencli/clis/`. Each is backed by a strategy (`PUBLIC | COOKIE | INTERCEPT | UI | LOCAL`) that tells you whether a Chrome session is needed.
- **Browser driving** — `opencli browser *` subcommands (`open`, `state`, `click`, `type`, `select`, `find`, `extract`, `network`, …) for ad-hoc interaction and scraping when no adapter covers the task. See `opencli-browser`.
- **Current-tab binding** — `opencli browser <session> bind` attaches the Chrome tab the user already opened/logged into to that browser session. Follow-up commands use `opencli browser <session> ...`. See `opencli-browser` before using it; bound sessions still block tab mutation.
- **External CLI passthrough** — `opencli gh`, `opencli docker`, `opencli vercel`, etc. Managed via `opencli external install <name>` (auto-install from `external-clis.yaml`) or `opencli external register <name>` (bring your own).

## Install

```bash
# npm global
npm install -g @jackwener/opencli          # binary: opencli, requires Node >= 21
opencli doctor                              # run before browser-dependent work (see below)

# From source
git clone git@github.com:jackwener/OpenCLI.git
cd OpenCLI && npm install
npx tsx src/main.ts <command>               # same surface, no global install
```

`opencli doctor` prints a structured `DoctorReport` — daemon status, extension connection, version checks, and a live browser connectivity probe. Scope is narrow: it diagnoses the **browser bridge** (daemon + extension + Chrome wiring). `PUBLIC` / `LOCAL` adapters, `opencli list`, `validate`, `verify`, plugin commands, and external-CLI passthrough don't need it to be green — only `COOKIE` / `INTERCEPT` / `UI` adapters and the `opencli browser *` subcommands do. Flag: `-v` (verbose).

## Prerequisites by command type

| Strategy tag on `opencli list` | What it needs |
|--------------------------------|---------------|
| `PUBLIC` | Nothing — pure HTTP, no browser. |
| `COOKIE` | Chrome logged into the target site + **OpenCLI** extension installed from the [Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk). Command captures the credential from your live session — no re-login. |
| `INTERCEPT` | Same as COOKIE, plus opencli opens an automation window to capture a signed request. |
| `UI` | Same as COOKIE, full DOM interaction. |
| `LOCAL` | No browser; talks to a local/dev endpoint. |

Electron desktop apps (cursor, codex, chatwise, discord-app, doubao-app, antigravity, chatgpt-app) route through CDP against the running app — same cookie-less flow as a logged-in browser. Make sure the app is running before invoking.

## Discover what's installed — don't read this file, run a command

```bash
opencli list                    # table, grouped by site
opencli list -f json            # machine-readable; pipe to jq or your agent
opencli list | grep -i twitter  # find commands for a specific site
opencli <site> --help           # see that site's commands + flags
opencli <site> <command> --help # see positional args and command-specific flags
```

Do not hard-code adapter lists — there are 100+ sites and the count moves every week. `opencli list -f json` is the source of truth; it emits one entry per command with `{site, name, aliases, description, strategy, browser, args, columns, ...}`. For an agent, that is always better than grepping a doc.

## Universal flags (work on every adapter command)

| flag | effect |
|------|--------|
| `-f, --format <fmt>` | `table` (default in TTY) · `yaml` (default in non-TTY) · `json` · `plain` · `md` · `csv`. Pass explicitly when you want a specific shape; agents almost always want `-f json`. |
| `-v, --verbose` | Debug logs + stack traces on failure; also sets `OPENCLI_VERBOSE=1` for the process. |

Command-specific flags (`--limit`, `--tab`, `--filter`, …) are not universal — consult `<site> <command> --help`.

## Output formats

- `json` — pretty-printed, 2-space indent. Default choice for agents.
- `plain` — prints a single primary field for chat-style commands (`response`/`content`/`text`/`value`). Useful for piping to another tool.
- `yaml` — fallback when output is not a TTY and `-f` is not explicit.
- `table` — color-coded, site-grouped; meant for humans.
- `md`, `csv` — straightforward tabular dumps.

A few commands override the default via `cmd.defaultFormat` (e.g. chat commands default to `plain`), so don't assume without reading `--help`.

## Environment variables

| variable | default | purpose |
|----------|---------|---------|
| `OPENCLI_DAEMON_PORT` | `19825` | Daemon ↔ extension bridge port. |
| `OPENCLI_BROWSER_CONNECT_TIMEOUT` | `30` | Seconds to wait for the browser bridge. |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | `60` | Per-command timeout. |
| `OPENCLI_CDP_ENDPOINT` | — | Manual CDP endpoint override (dev / remote Chrome / Electron). |
| `OPENCLI_CACHE_DIR` | `~/.opencli/cache` | Network capture + browser-state cache. |
| `OPENCLI_WINDOW` | command-specific | `foreground` or `background` browser window mode. |
| `OPENCLI_VERBOSE` | `false` | Verbose logging (also triggered by `-v`). |

## Self-repair

When an adapter command fails because the site changed (selectors drifted, API rotated, response schema shifted), re-run with `--trace retain-on-failure`. The error envelope includes a `trace` block pointing at `summary.md`; patch only the `adapterSourcePath` from that summary and retry. Max 3 repair rounds. The full flow is in `opencli-autofix`.

## Writing your own adapter

Two-path storage:

- **Private**: `~/.opencli/clis/<site>/<command>.js` — no build step, hot-available, not visible in the public package.
- **Public / PR**: `clis/<site>/<command>.js` — for upstream contribution; requires build.

Scaffolding & verification:

```bash
opencli browser init <site>/<command>   # generates a skeleton
opencli validate [target]               # semantic checks on the loaded registry (description, domain, pipeline step names, func|pipeline|_lazy presence, arg duplicates) — no network, no browser
opencli verify [target] [--smoke]       # run the command with synthetic args
opencli browser verify <site>/<command> # end-to-end smoke inside the bridge
```

Adapters import only `@jackwener/opencli/registry` and `@jackwener/opencli/errors`. `columns` must align 1:1 (in name and order) with keys of the object returned by `func`. For the full workflow see `opencli-adapter-author`.

## Plugins

Plugins are third-party extensions pulled from git, separate from the main adapter registry:

```bash
opencli plugin install github:user/repo    # install
opencli plugin list [-f json]              # see installed
opencli plugin update [name] | --all       # keep current
opencli plugin uninstall <name>
opencli plugin create <name>               # scaffold a new plugin
```

## External CLI passthrough

Wraps external command-line tools so you can discover + invoke them through the same `opencli …` entrypoint:

```bash
opencli external install gh    # auto-install via brew/apt/npm per external-clis.yaml
opencli external register my-tool \
    --binary my-tool \
    --install "npm i -g my-tool" \
    --desc "My internal CLI"
opencli external list
opencli gh pr list --limit 5   # passthrough; stdio is inherited, exit code propagated
opencli docker ps
```

Built-in entries live in `src/external-clis.yaml`; user overrides and additions in `~/.opencli/external-clis.yaml`. Commonly shipped: `gh`, `docker`, `vercel`, `lark-cli`, `dws`, `wecom-cli`, `obsidian`, `ntn`, `tg(tg-cli)`, `discord(discord-cli)`, `wx(wx-cli)`.

Some official CLIs use shell-script installers instead of a shell-free package-manager command. Entries without an `install` config, such as `ntn`, must be installed manually from their homepage before passthrough use.

## Shell completion

```bash
opencli completion bash   # also: zsh, fish
# -> script on stdout; source or save per your shell's convention
```

## Where to go next

| If you're about to… | Load this skill |
|---------------------|-----------------|
| Drive a live browser ad-hoc (no adapter available, or prototyping) | `opencli-browser` |
| Write a new adapter, or add a command to an existing site | `opencli-adapter-author` |
| Fix a broken adapter after a command failure | `opencli-autofix` |
| Route a search / lookup / research request to the right adapter | `smart-search` |

## Commands that used to exist

The following were removed in the PR #1094 consolidation — don't try to invoke them:

- `opencli explore <url>` — superseded by `opencli browser network` + `opencli browser find` for live API discovery, and by the `opencli-adapter-author` workflow for capture.
- `opencli record <url>` — removed; manual capture now lives in `opencli browser network --detail`.
- `opencli web read` / `opencli desktop *` as top-level groups — folded into their respective adapters (`opencli web read` still exists as the `web` adapter's `read` command, but there is no standalone `web` / `desktop` top-level group command).

## Don't

- Don't paste this skill's command list into your plan; it will rot. Call `opencli list -f json` at the start of a task instead.
- Don't assume every adapter needs a browser — strategy `PUBLIC` and `LOCAL` don't. Check the `strategy` field.
- Don't silently fall back from a failing adapter to a hand-rolled `fetch` — `--trace retain-on-failure` gives you the browser evidence and adapter source path. Do that first.
