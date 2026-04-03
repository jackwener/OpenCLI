# Plugins

OpenCLI supports community-contributed plugins. Install third-party adapters from GitHub, and they're automatically discovered alongside built-in commands.

## Quick Start

```bash
# Install a plugin
opencli plugin install github:ByteYue/opencli-plugin-github-trending

# List installed plugins
opencli plugin list

# Update one plugin
opencli plugin update github-trending

# Update all installed plugins
opencli plugin update --all

# Use the plugin (it's just a regular command)
opencli github-trending repos --limit 10

# Remove a plugin
opencli plugin uninstall github-trending
```

## How Plugins Work

Plugins live in `~/.opencli/plugins/<name>/`. Each subdirectory is scanned at startup for `.yaml`, `.ts`, or `.js` command files — the same formats used by built-in adapters.

### Supported Source Formats

```bash
# GitHub shorthand
opencli plugin install github:user/repo
opencli plugin install github:user/repo/subplugin   # install specific sub-plugin from monorepo
opencli plugin install https://github.com/user/repo

# Any git-cloneable URL
opencli plugin install https://gitlab.example.com/team/repo.git
opencli plugin install ssh://git@gitlab.example.com/team/repo.git
opencli plugin install git@gitlab.example.com:team/repo.git

# Local plugin (for development)
opencli plugin install file:///path/to/plugin
opencli plugin install /path/to/plugin
```

The repo name prefix `opencli-plugin-` is automatically stripped for the local directory name. For example, `opencli-plugin-hot-digest` becomes `hot-digest`.

## Plugin Manifest (`opencli-plugin.json`)

Plugins can include an `opencli-plugin.json` manifest file at the repo root to declare metadata:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "opencli": ">=1.0.0",
  "description": "My awesome plugin"
}
```

| Field | Description |
|-------|-------------|
| `name` | Plugin name (overrides repo-derived name) |
| `version` | Semantic version |
| `opencli` | Required opencli version range (e.g. `>=1.0.0`, `^1.2.0`) |
| `description` | Human-readable description |
| `plugins` | Monorepo sub-plugin declarations (see below) |

The manifest is optional — plugins without one continue to work exactly as before.

## Monorepo Plugins

A single repository can contain multiple plugins by declaring a `plugins` field in `opencli-plugin.json`:

```json
{
  "version": "1.0.0",
  "opencli": ">=1.0.0",
  "description": "My plugin collection",
  "plugins": {
    "polymarket": {
      "path": "packages/polymarket",
      "description": "Prediction market analysis",
      "version": "1.2.0"
    },
    "defi": {
      "path": "packages/defi",
      "description": "DeFi protocol data",
      "version": "0.8.0",
      "opencli": ">=1.2.0"
    },
    "experimental": {
      "path": "packages/experimental",
      "disabled": true
    }
  }
}
```

### Installing

```bash
# Install ALL enabled sub-plugins from a monorepo
opencli plugin install github:user/opencli-plugins

# Install a SPECIFIC sub-plugin
opencli plugin install github:user/opencli-plugins/polymarket
```

### How It Works

- The monorepo is cloned once to `~/.opencli/monorepos/<repo>/`
- Each sub-plugin gets a symlink in `~/.opencli/plugins/<name>/` pointing to its subdirectory
- Command discovery works transparently — symlinks are scanned just like regular directories
- Disabled sub-plugins (with `"disabled": true`) are skipped during install
- Sub-plugins can specify their own `opencli` compatibility range

### Updating

Updating any sub-plugin from a monorepo pulls the entire repo and refreshes all sub-plugins:

```bash
opencli plugin update polymarket   # updates the monorepo, refreshes all
```

### Uninstalling

```bash
opencli plugin uninstall polymarket   # removes just this sub-plugin's symlink
```

When the last sub-plugin from a monorepo is uninstalled, the monorepo clone is automatically cleaned up.

## Version Tracking

OpenCLI records installed plugin versions in `~/.opencli/plugins.lock.json`. Each entry stores the plugin source, current git commit hash, install time, and last update time. `opencli plugin list` shows the short commit hash when version metadata is available.

## Creating a Plugin

### Option 1: YAML Plugin (Simplest)

Zero dependencies, no build step. Just create a `.yaml` file:

```
my-plugin/
├── my-command.yaml
└── README.md
```

Example `my-command.yaml`:

```yaml
site: my-plugin
name: my-command
description: My custom command
strategy: public
browser: false

args:
  limit:
    type: int
    default: 10

pipeline:
  - fetch:
      url: https://api.example.com/data
  - map:
      title: ${{ item.title }}
      score: ${{ item.score }}
  - limit: ${{ args.limit }}

columns: [title, score]
```

### Option 2: TypeScript Plugin

For richer logic (multi-source aggregation, custom transformations, etc.):

```
my-plugin/
├── package.json
├── my-command.ts
└── README.md
```

`package.json`:

```json
{
  "name": "opencli-plugin-my-plugin",
  "version": "0.1.0",
  "type": "module",
  "peerDependencies": {
    "@jackwener/opencli": ">=1.0.0"
  }
}
```

`my-command.ts`:

```typescript
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'my-plugin',
  name: 'my-command',
  description: 'My custom command',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
  ],
  columns: ['title', 'score'],
  func: async (_page, kwargs) => {
    const res = await fetch('https://api.example.com/data');
    const data = await res.json();
    return data.items.slice(0, kwargs.limit).map((item: any, i: number) => ({
      title: item.title,
      score: item.score,
    }));
  },
});
```

### TS Plugin Install Lifecycle

When you run `opencli plugin install`, TS plugins are automatically set up:

1. **Clone** — `git clone --depth 1` from GitHub
2. **npm install** — Resolves regular dependencies
3. **Host symlink** — Links the running `@jackwener/opencli` into the plugin's `node_modules/` so `import from '@jackwener/opencli/registry'` always resolves against the host
4. **Transpile** — Compiles `.ts` → `.js` via `esbuild` (production `node` cannot load `.ts` directly)

On startup, if both `my-command.ts` and `my-command.js` exist, the `.js` version is loaded to avoid duplicate registration.

## Example Plugins

| Repo | Type | Description |
|------|------|-------------|
| [opencli-plugin-github-trending](https://github.com/ByteYue/opencli-plugin-github-trending) | YAML | GitHub Trending repositories |
| [opencli-plugin-hot-digest](https://github.com/ByteYue/opencli-plugin-hot-digest) | TS | Multi-platform trending aggregator (zhihu, weibo, bilibili, v2ex, stackoverflow, reddit, linux-do) |
| [opencli-plugin-juejin](https://github.com/Astro-Han/opencli-plugin-juejin) | YAML | 稀土掘金 (Juejin) hot articles, categories, and article feed |
| [opencli-plugin-rubysec](https://github.com/nullptrKey/opencli-plugin-rubysec) | TS | RubySec advisory archive and advisory article reader |

## Troubleshooting

### Command not found after install

Restart opencli (or open a new terminal) — plugins are discovered at startup.

### TS plugin import errors

If you see `Cannot find module '@jackwener/opencli/registry'`, the host symlink may be broken. Reinstall the plugin:

```bash
opencli plugin uninstall my-plugin
opencli plugin install github:user/opencli-plugin-my-plugin
```
