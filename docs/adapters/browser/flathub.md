# Flathub

**Mode**: 🌐 Public · **Domain**: `flathub.org`

Search the Flathub Linux flatpak app registry and fetch full appstream metadata for any app. Flathub is the canonical flatpak distribution channel for Linux desktop applications.

## Commands

| Command | Description |
|---------|-------------|
| `opencli flathub search <query>` | Search Flathub apps by keyword |
| `opencli flathub app <appId>` | Full Flathub appstream metadata for an app id |

## Usage Examples

```bash
# Keyword search
opencli flathub search firefox
opencli flathub search "image editor" --limit 10
opencli flathub search blender

# App detail (appId round-trips from search)
opencli flathub app org.mozilla.firefox
opencli flathub app org.gnome.Calculator
opencli flathub app org.blender.Blender
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, appId, name, summary, developer, license, isFreeLicense, mainCategories, installsLastMonth, updatedAt, url` |
| `app` | `appId, name, summary, developer, license, isFreeLicense, isEol, categories, keywords, latestVersion, latestReleaseDate, homepage, bugtracker, donation, url` |

The `appId` column round-trips between commands.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Search keyword |
| `--limit` | Max apps (1–100, default: 25) |

### `app`

| Option | Description |
|--------|-------------|
| `appId` (positional) | AppStream id, reverse-DNS form (e.g. `org.mozilla.firefox`, `org.gnome.Calculator`) |

## Notes

- **`appId` is the reverse-DNS AppStream id** (`org.mozilla.firefox`), not the underscored cache id (`org_mozilla_firefox`) Flathub returns alongside it. We always emit the dotted form so the `search → app` round-trip works without translation.
- **`updatedAt` normalisation**: Flathub's `/search` endpoint emits `updated_at` as unix-seconds (integer); `/appstream/<id>` emits it as ISO date strings. The adapter normalises `/search` to ISO date (`YYYY-MM-DD`) so both surfaces look consistent.
- **`releases[].timestamp` is a numeric string**, not an int — quirk of the appstream layer. The adapter coerces both shapes when picking the latest release.
- **`isEol`** is `true` for end-of-life apps (no longer maintained).
- **`isFreeLicense`** uses Flathub's classification of `project_license` (e.g. `MPL-2.0`, `GPL-3.0-or-later`). Don't use this in lieu of reading the actual license; useful as a quick filter.
- **`installsLastMonth` (search only)** is Flathub's 30-day install count per app. Useful for popularity ranking; `null` when not yet aggregated.
- **`mainCategories`** is a single string in `/search` (e.g. `'network'`); on `/appstream/<id>` the broader `categories` list is used (`'Network, WebBrowser'`).
- **No API key required.** Flathub's API is public and unauthenticated; bursts → `CommandExecutionError`.
- **Errors.** Empty query / bad appId / bad limit → `ArgumentError`; unknown appId (HTTP 404) → `EmptyResultError`; transport / 429 / non-200 → `CommandExecutionError`.
