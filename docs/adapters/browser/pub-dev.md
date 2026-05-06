# pub.dev

**Mode**: 🌐 Public · **Domain**: `pub.dev`

Fetch latest pub.dev package metadata or list every published version for a Dart / Flutter package. Hits the unauthenticated `pub.dev/api` JSON endpoints.

## Commands

| Command | Description |
|---------|-------------|
| `opencli pub-dev package <name>` | Latest pub.dev package metadata (version, dependencies, SDK constraint) |
| `opencli pub-dev versions <name>` | Published versions of a pub.dev package (newest first) |

## Usage Examples

```bash
# Latest version + pubspec
opencli pub-dev package http
opencli pub-dev package provider
opencli pub-dev package riverpod

# Every published version, newest first
opencli pub-dev versions http
opencli pub-dev versions provider --limit 50
```

## Output Columns

| Command | Columns |
|---------|---------|
| `package` | `package, version, publishedAt, description, repository, homepage, sdk, flutter, dependencies, devDependencies, topics, archive, url` |
| `versions` | `rank, package, version, publishedAt, archive, url` |

The `package` column round-trips between commands; the `version` column from `versions` becomes the `version` field on `package` (latest only — pub.dev's archive URL also shows historical versions).

## Options

### `package`

| Option | Description |
|--------|-------------|
| `package` (positional) | pub.dev package name (e.g. `http`, `provider`, `riverpod`) |

### `versions`

| Option | Description |
|--------|-------------|
| `package` (positional) | pub.dev package name |
| `--limit` | Max rows (1–500, default: 30) |

## Notes

- **Package names are validated as `^[a-z][a-z0-9_]*$`** — Dart's package layout spec, lowercase letters / digits / underscores, leading letter. Bad shapes → `ArgumentError` (no wasted request).
- **`versions` are reversed to newest-first.** pub.dev's API returns `versions[]` oldest-first; the adapter reverses so rank 1 = latest. The latest version also surfaces directly on `package` (`version` + `publishedAt`).
- **`dependencies` / `devDependencies`** are flat name lists (comma-joined). Versions / constraints are not included — fetch the archive (`archive` column) for full pubspec.yaml.
- **`topics`** is the pub.dev tags list (`http`, `network`, `flutter`, etc.) — useful for filtering / discovery.
- **`flutter`** is null for pure-Dart packages; populated when the pubspec sets a Flutter SDK constraint.
- **No API key required.** pub.dev throttles unauthenticated traffic; bursts → `CommandExecutionError`.
- **Errors.** Bad package name / bad limit → `ArgumentError`; unknown package → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
