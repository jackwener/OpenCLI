# Contributing

Thanks for your interest in contributing to OpenCLI.

## Quick Start

```bash
# 1. Fork & clone
git clone git@github.com:<your-username>/opencli.git
cd opencli

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Run a few checks
npx tsc --noEmit
npm test
npm run test:adapter

# 5. Link globally (optional, for testing `opencli` command)
npm link
```

## Adding a New Site Adapter

This is the most common type of contribution. Start with YAML when possible, and use TypeScript only when you need browser-side logic or multi-step flows.

Before you start:

- Prefer positional args for the command's primary subject (`search <query>`, `topic <id>`, `download <url>`). Reserve named flags for optional modifiers such as `--limit`, `--sort`, `--lang`, and `--output`.
- Normalize expected adapter failures to `CliError` subclasses instead of raw `Error` whenever possible. Prefer `AuthRequiredError`, `EmptyResultError`, `CommandExecutionError`, `TimeoutError`, and `ArgumentError` so the top-level CLI can render better messages and hints.
- If you add a new adapter or make a command newly discoverable, update the matching doc page and the user-facing indexes that expose it.

### YAML Adapter (Recommended for data-fetching commands)

Create a file like `src/clis/<site>/<command>.yaml`:

::: v-pre
```yaml
site: mysite
name: trending
description: Trending posts on MySite
domain: www.mysite.com
strategy: public      # public | cookie | header
browser: false        # true if browser session is needed

args:
  limit:
    type: int
    default: 20
    description: Number of items

pipeline:
  - fetch:
      url: https://api.mysite.com/trending

  - map:
      rank: ${{ index + 1 }}
      title: ${{ item.title }}
      score: ${{ item.score }}
      url: ${{ item.url }}

  - limit: ${{ args.limit }}

columns: [rank, title, score, url]
```
:::

See [`hackernews/top.yaml`](https://github.com/jackwener/opencli/blob/main/src/clis/hackernews/top.yaml) for a real example.

### TypeScript Adapter (For complex browser interactions)

Create a file like `src/clis/<site>/<command>.ts`:

```typescript
import { cli, Strategy } from '../../src/registry.js';
import { CommandExecutionError, EmptyResultError } from '../../src/errors.js';

cli({
  site: 'mysite',
  name: 'search',
  description: 'Search MySite',
  domain: 'www.mysite.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results' },
  ],
  columns: ['title', 'url', 'date'],

  func: async (page, kwargs) => {
    const { query, limit = 10 } = kwargs;
    // ... browser automation logic
    if (!Array.isArray(data)) throw new CommandExecutionError('MySite returned an unexpected response');
    if (!data.length) throw new EmptyResultError('mysite search', 'Try a different keyword');
    return data.slice(0, Number(limit)).map((item: any) => ({
      title: item.title,
      url: item.url,
      date: item.created_at,
    }));
  },
});
```

### Validate Your Adapter

```bash
opencli validate               # Validate YAML syntax and schema
opencli <site> <command> --limit 3 -f json   # Test your command
opencli <site> <command> -v    # Verbose mode for debugging
```

## Code Style

- **TypeScript strict mode** — avoid `any` where possible.
- **ES Modules** — use `.js` extensions in imports (TypeScript output).
- **Naming**: `kebab-case` for files, `camelCase` for variables/functions, `PascalCase` for types/classes.
- **No default exports** — use named exports.
- **Errors** — throw `CliError` subclasses for expected adapter failures; avoid raw `Error` for normal adapter control flow.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(twitter): add thread command
fix(browser): handle CDP timeout gracefully
docs: update CONTRIBUTING.md
test(reddit): add e2e test for save command
chore: bump vitest to v4
```

## Submitting a Pull Request

1. Create a feature branch: `git checkout -b feat/mysite-trending`
2. Make your changes and add tests when relevant
3. Run the checks:
   ```bash
   npx tsc --noEmit           # Type check
   npm test                   # Core unit tests
   npm run test:adapter       # Focused adapter tests (if adapter logic changed)
   opencli validate           # YAML validation (if applicable)
   ```
4. Commit using conventional commit format
5. Push and open a PR

If your PR adds a new adapter or changes user-facing commands, also verify:

- Adapter docs exist under `docs/adapters/`
- `docs/adapters/index.md` is updated for new adapters
- VitePress sidebar includes the new doc page
- `README.md` / `README.zh-CN.md` stay aligned when command discoverability changes
