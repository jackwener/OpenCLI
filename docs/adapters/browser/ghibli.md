# Studio Ghibli

**Mode**: 🌐 Public · **Domain**: `ghibliapi.vercel.app`

Studio Ghibli films + character data from the public REST API at `ghibliapi.vercel.app`. No auth, no API key. Curated dataset (~22 films, ~50 characters) — server returns full collections in one request.

## Commands

| Command | Description |
|---------|-------------|
| `opencli ghibli films` | Studio Ghibli films catalog (title, director, release year, RT score) |
| `opencli ghibli people` | Studio Ghibli characters across all films |

## Usage Examples

```bash
# Films
opencli ghibli films --limit 50
opencli ghibli films --limit 5

# Characters
opencli ghibli people --limit 50
opencli ghibli people --limit 100
```

## Output Columns

| Command | Columns |
|---------|---------|
| `films` | `rank, id, title, originalTitle, originalTitleRomanised, description, director, producer, releaseDate, runningTime, rtScore, image, movieBanner, url` |
| `people` | `rank, id, name, gender, age, eyeColor, hairColor, speciesId, filmsCount, url` |

## Options

### `films`

| Option | Description |
|--------|-------------|
| `--limit` | Max rows (1–50, default 50). The full catalog has ~22 films — the cap is loose. |

### `people`

| Option | Description |
|--------|-------------|
| `--limit` | Max rows (1–100, default 50). |

## Notes

- **Films sorted ascending by release date.** Server order is roughly chronological but unstable across deploys; adapter sorts by `release_date` (year-only string, parsed as `Number`) for stable presentation.
- **`originalTitle` is Japanese.** `originalTitle: 天空の城ラピュタ`, `originalTitleRomanised: Tenkū no shiro Rapyuta` — both surfaced separately for searchability and display.
- **`rtScore` is Rotten Tomatoes percentage.** Upstream returns it as a string (`"95"`); preserved as-is for column-shape stability rather than coerced to int.
- **`releaseDate` is year-only.** Upstream returns `"1986"`, not a full date — preserved as string.
- **`speciesId` extracted from species URL.** Upstream returns `species: "https://ghibliapi.vercel.app/species/<uuid>"`; adapter pulls the trailing UUID via regex for a stable id column. Empty / null URL → `speciesId: null`.
- **`filmsCount` is array length.** `films` field comes back as URL array — counted for stable column shape.
- **`gender: ''` / `age: ''` preserved as `null`.** Many characters have empty `gender` or `age` fields — coerced to `null` rather than rendered as `''`.
- **No filter params.** Upstream supports neither `?title=` nor `?name=`; full catalog is returned and sliced client-side. For filtered work, slice the rows after the call.
- **Errors.** `--limit` out of range → `ArgumentError`; empty response → `EmptyResultError`; 429 → `CommandExecutionError`; other non-200 → `CommandExecutionError`.
