# Contributing to OpenCLI

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
npx vitest run src/

# 5. Link globally (optional, for testing `opencli` command)
npm link
```

## Adding a New Site Adapter

This is the most common type of contribution. Start with YAML when possible, and use TypeScript only when you need browser-side logic or multi-step flows.

### YAML Adapter (Recommended for data-fetching commands)

Create a file like `src/clis/<site>/<command>.yaml`:

```yaml
site: mysite
name: trending
description: Trending posts on MySite
domain: www.mysite.com
strategy: public      # public | cookie | header
browser: false        # true if browser session is needed

args:
  query:
    positional: true
    type: str
    required: true
    description: Search keyword
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

See [`hackernews/top.yaml`](src/clis/hackernews/top.yaml) for a real example.

### TypeScript Adapter (For complex browser interactions)

Create a file like `src/clis/<site>/<command>.ts`:

```typescript
import { cli, Strategy } from '../../registry.js';

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
    await page.goto('https://www.mysite.com');

    const data = await page.evaluate(`
      (async () => {
        const res = await fetch('/api/search?q=${encodeURIComponent(query)}', {
          credentials: 'include'
        });
        return (await res.json()).results;
      })()
    `);

    return data.slice(0, Number(limit)).map((item: any) => ({
      title: item.title,
      url: item.url,
      date: item.created_at,
    }));
  },
});
```

Use `opencli explore <url>` to discover APIs and see [CLI-EXPLORER.md](./CLI-EXPLORER.md) if you need the full adapter workflow.

### Validate Your Adapter

```bash
# Validate YAML syntax and schema
opencli validate

# Test your command
opencli <site> <command> --limit 3 -f json

# Verbose mode for debugging
opencli <site> <command> -v
```

## Arg Design Convention

Use **positional** for the primary, required argument of a command (the "what" — query, symbol, id, url, username). Use **named options** (`--flag`) for secondary/optional configuration (limit, format, sort, page, filters, language, date).

**Rule of thumb**: Think about how the user will type the command. `opencli xueqiu stock SH600519` is more natural than `opencli xueqiu stock --symbol SH600519`.

| Arg type | Positional? | Examples |
|----------|-------------|----------|
| Main target (query, symbol, id, url, username) | ✅ `positional: true` | `search '茅台'`, `stock SH600519`, `download BV1xxx` |
| Configuration (limit, format, sort, page, type, filters) | ❌ Named `--flag` | `--limit 10`, `--format json`, `--sort hot`, `--location seattle` |

Do **not** convert an argument to positional just because it appears first in the file. If the argument is optional, acts like a filter, or selects a mode/configuration, it should usually stay a named option.

YAML example:
```yaml
args:
  query:
    positional: true     # ← primary arg, user types it directly
    type: str
    required: true
  limit:
    type: int            # ← config arg, user types --limit 10
    default: 20
```

TS example:
```typescript
args: [
  { name: 'query', positional: true, required: true, help: 'Search query' },
  { name: 'limit', type: 'int', default: 10, help: 'Max results' },
]
```

## Testing

See [TESTING.md](./TESTING.md) for the full guide and exact test locations.

```bash
npx vitest run src/           # Unit tests
npx vitest run tests/e2e/     # E2E tests
npx vitest run                # All tests
```

## Code Style

- **TypeScript strict mode** — avoid `any` where possible.
- **ES Modules** — use `.js` extensions in imports (TypeScript output).
- **Naming**: `kebab-case` for files, `camelCase` for variables/functions, `PascalCase` for types/classes.
- **No default exports** — use named exports.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(twitter): add thread command
fix(browser): handle CDP timeout gracefully
docs: update CONTRIBUTING.md
test(reddit): add e2e test for save command
chore: bump vitest to v4
```

Common scopes: site name (`twitter`, `reddit`) or module name (`browser`, `pipeline`, `engine`).

## Submitting a Pull Request

1. Create a feature branch: `git checkout -b feat/mysite-trending`
2. Make your changes and add tests when relevant
3. Run the checks that apply:
   ```bash
   npx tsc --noEmit           # Type check
   npx vitest run src/        # Unit tests
   opencli validate           # YAML validation (if applicable)
   ```
4. Commit using conventional commit format
5. Push and open a PR

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](./LICENSE).
