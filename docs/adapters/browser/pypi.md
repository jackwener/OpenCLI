# PyPI

**Mode**: 🌐 Public · **Domain**: `pypi.org` (+ `pypistats.org` for download stats)

Inspect Python packages on the Python Package Index. Two commands: registry metadata for one package and download stats over a recent or historical window.

## Commands

| Command | Description |
|---------|-------------|
| `opencli pypi package <name>` | Single PyPI package metadata (latest version, summary, repo, license, release timeline) |
| `opencli pypi downloads <name>` | Download stats from pypistats.org (recent totals or daily history) |

## Usage Examples

```bash
# Single-package metadata
opencli pypi package requests
opencli pypi package fastapi

# Download stats — three rows (last-day / last-week / last-month) totals
opencli pypi downloads requests --period recent

# Daily history for ~180 days (pypistats default window)
opencli pypi downloads requests --period overall

# JSON output
opencli pypi package requests -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `package` | `name, latestVersion, summary, author, license, homepage, repository, requiresPython, keywords, releases, firstReleased, lastReleased, url` |
| `downloads` | `rank, package, period, date, downloads` |

## Options

### `package`

| Option | Description |
|--------|-------------|
| `name` (positional) | PyPI package name (e.g. `requests`, `numpy`). Validates 1–64 chars and PyPI's naming rule. |

### `downloads`

| Option | Description |
|--------|-------------|
| `name` (positional) | PyPI package name |
| `--period` | `recent` (3-row totals: last_day / last_week / last_month) or `overall` (daily history). Default: `recent`. |

## Caveats

- pypistats only goes back ~180 days for `overall`; older history is not exposed.
- `requires_python` reflects the latest release's metadata; older releases may declare different ranges.
- `firstReleased` / `lastReleased` are computed from the full release index, so they reflect the upload time of the earliest / latest **uploaded file**, not necessarily the version listed under `latestVersion`.
- `--period` is validated upfront — `recent` or `overall` only; anything else raises `ArgumentError`.

## Prerequisites

- No browser required — uses `pypi.org/pypi/<pkg>/json` and `pypistats.org/api/packages/<pkg>/...`.
