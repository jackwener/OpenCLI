# Hex.pm

**Mode**: 🌐 Public · **Domain**: `hex.pm`

Fetch full Hex.pm package metadata or list every published version for an Erlang / Elixir package. Hits the unauthenticated `hex.pm/api` JSON endpoints.

## Commands

| Command | Description |
|---------|-------------|
| `opencli hex-pm package <name>` | Hex.pm package metadata (latest version, downloads, owners, license) |
| `opencli hex-pm versions <name>` | Published Hex.pm package versions (newest first) |

## Usage Examples

```bash
# Latest version + downloads + owners
opencli hex-pm package phoenix
opencli hex-pm package ecto
opencli hex-pm package plug

# Every released version, newest first
opencli hex-pm versions phoenix
opencli hex-pm versions ecto --limit 50
```

## Output Columns

| Command | Columns |
|---------|---------|
| `package` | `package, latestVersion, latestStableVersion, description, licenses, github, docsUrl, downloadsAll, downloadsRecent, downloadsWeek, downloadsDay, owners, releaseCount, insertedAt, updatedAt, url` |
| `versions` | `rank, package, version, insertedAt, hasDocs, url` |

The `package` column round-trips between commands.

## Options

### `package`

| Option | Description |
|--------|-------------|
| `package` (positional) | Hex package name (e.g. `phoenix`, `ecto`, `plug`) |

### `versions`

| Option | Description |
|--------|-------------|
| `package` (positional) | Hex package name |
| `--limit` | Max rows (1–500, default: 30) |

## Notes

- **`latestVersion` vs `latestStableVersion`** — Hex distinguishes pre-release tags (`1.8.0-rc.0`) from stable (`1.8.0`). Both fields are surfaced; for production lookups use `latestStableVersion`.
- **`downloads*` covers four windows**: `all` (lifetime), `recent` (last ~90 days), `week`, `day`. All are integers; `null` when the registry hasn't computed a value yet (rare, only for brand-new packages).
- **`owners` is comma-joined Hex usernames** — the people who can publish new versions. Useful for ecosystem mapping.
- **`hasDocs` (versions only)** indicates whether HexDocs has built API docs for that release. `true` / `false` / `null` (not yet known).
- **Versions are returned newest-first** as Hex.pm API stores them. No client-side semver sort needed.
- **No API key required.** Hex.pm throttles unauthenticated traffic; bursts → `CommandExecutionError`.
- **Errors.** Bad package name / bad limit → `ArgumentError`; unknown package → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
