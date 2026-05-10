# OSV.dev

**Mode**: 🌐 Public · **Domain**: `osv.dev`

Look up open-source vulnerabilities by id (GHSA / CVE / PYSEC / etc.), or query by package + ecosystem (+ optional version) to find every vuln affecting it. Hits the unauthenticated `api.osv.dev` directly.

## Commands

| Command | Description |
|---------|-------------|
| `opencli osv vulnerability <id>` | Single OSV.dev vulnerability detail (severity, affected packages, CVE/GHSA aliases) |
| `opencli osv query <package> --ecosystem <eco>` | Vulnerabilities affecting a package (optionally pinned to a version) |

## Usage Examples

```bash
# Specific advisory by GHSA id
opencli osv vulnerability GHSA-29mw-wpgm-hmr9

# Same advisory by CVE alias
opencli osv vulnerability CVE-2020-28500

# All known npm-lodash vulns (newest first)
opencli osv query lodash --ecosystem npm

# Vulns affecting a pinned version
opencli osv query lodash --ecosystem npm --version 4.17.20

# Cross-ecosystem queries
opencli osv query django --ecosystem PyPI --limit 10
opencli osv query log4j-core --ecosystem Maven
```

## Output Columns

| Command | Columns |
|---------|---------|
| `vulnerability` | `id, summary, severity, aliases, published, modified, affectedPackages, cwes, referenceCount, url` |
| `query` | `rank, id, summary, severity, aliases, published, modified, affectedPackages, url` |

The `id` column from `query` round-trips into `vulnerability`.

## Options

### `vulnerability`

| Option | Description |
|--------|-------------|
| `id` (positional) | OSV vulnerability id (e.g. `GHSA-29mw-wpgm-hmr9`, `CVE-2020-28500`, `PYSEC-2021-1`) |

### `query`

| Option | Description |
|--------|-------------|
| `package` (positional) | Package name (e.g. `lodash`, `django`, `log4j-core`) |
| `--ecosystem` | OSV ecosystem (`npm`, `PyPI`, `Go`, `Maven`, `NuGet`, `RubyGems`, `crates.io`, `Packagist`, `Pub`, `Hex`, `Hackage`, `CRAN`, `Bitnami`, `GitHub Actions`, `SwiftURL`) |
| `--version` | Optional version pin (e.g. `4.17.20`); omit to get all known vulns |
| `--limit` | Max rows to return (1–200, default: 30) |

## Notes

- **Ecosystem strings are case-sensitive** — they match the [OSV defined ecosystem list](https://ossf.github.io/osv-schema/#defined-ecosystems) verbatim. `npm` is lowercase, `PyPI` capitalised, etc. Bad values → `ArgumentError`.
- **`severity`** prefers `database_specific.severity` (`LOW`/`MODERATE`/`HIGH`/`CRITICAL`); falls back to the first `severity[].score` (CVSS string) when the registry didn't compute a label. `null` when both are missing.
- **`affectedPackages`** is a flat `ecosystem:name` list across all entries in `affected[]` — useful for a quick "what packages does this advisory touch" view.
- **`query` results are sorted newest-first** by `published`; pre-sort makes "what's the latest issue for X?" a single read.
- **No API key required.** Rate-limit hits → `CommandExecutionError`.
- **Errors.** Bad id / ecosystem / limit → `ArgumentError` (before fetch); unknown id or no vulns matched → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
