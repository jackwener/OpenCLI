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

# 5. Link globally (optional, for testing `opencli` command)
npm link
```

## Adding a New Site Adapter

This is the most common type of contribution. All adapters use TypeScript with the `cli()` API.

Before you start:

- Prefer positional args for the command's primary subject (`search <query>`, `topic <id>`, `download <url>`). Reserve named flags for optional modifiers such as `--limit`, `--sort`, `--lang`, and `--output`.
- Normalize expected adapter failures to `CliError` subclasses instead of raw `Error` whenever possible. Prefer `AuthRequiredError`, `EmptyResultError`, `CommandExecutionError`, `TimeoutError`, and `ArgumentError` so the top-level CLI can render better messages and hints.
- If you add a new adapter or make a command newly discoverable, update the matching doc page and the user-facing indexes that expose it.

### TypeScript Adapter

Create a file like `clis/<site>/<command>.ts`:

```typescript
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

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
   npm test                   # Default local gate: unit + extension + adapter
   npm run test:adapter       # Adapter-only project (optional while iterating on adapters)
   ```
4. Commit using conventional commit format
5. Push and open a PR

If your PR adds a new adapter or changes user-facing commands, also verify:

- Adapter docs exist under `docs/adapters/`
- `docs/adapters/index.md` is updated for new adapters
- VitePress sidebar includes the new doc page
- `README.md` / `README.zh-CN.md` stay aligned when command discoverability changes
