# MusicBrainz

**Mode**: 🌐 Public · **Domain**: `musicbrainz.org`

Search MusicBrainz artists by name and fetch full release detail by MBID. MusicBrainz is the canonical open music metadata registry; every entity has a UUID-shaped MBID. No API key required.

## Commands

| Command | Description |
|---------|-------------|
| `opencli musicbrainz artist <query>` | Search MusicBrainz artists by name (MBID, type, country, lifespan) |
| `opencli musicbrainz release <mbid>` | Full release detail (artist credit, label, catalog number, packaging) |

## Usage Examples

```bash
# Artist search
opencli musicbrainz artist "radiohead"
opencli musicbrainz artist "aretha franklin" --limit 5

# Release detail (MBID from MusicBrainz; not yet round-trip from search — search
# returns artist MBIDs, releases need a separate browse pass)
opencli musicbrainz release 76df3287-6cda-33eb-8e9a-044b5e15ffdd
```

## Output Columns

| Command | Columns |
|---------|---------|
| `artist` | `rank, mbid, name, sortName, type, country, begin, ended, disambiguation, score, url` |
| `release` | `mbid, title, artistCredit, status, releaseGroup, primaryType, firstReleaseDate, releaseCountry, releaseDate, label, catalogNumber, barcode, packaging, language, script, url` |

## Options

### `artist`

| Option | Description |
|--------|-------------|
| `query` (positional) | Artist name (e.g. `Radiohead`, `Aretha Franklin`) |
| `--limit` | Max rows (1–100, default: 20) |

### `release`

| Option | Description |
|--------|-------------|
| `mbid` (positional) | Release MBID (UUID v4 form, e.g. `76df3287-6cda-33eb-8e9a-044b5e15ffdd`) |

## Notes

- **`artistCredit` preserves MusicBrainz `joinphrase` whitespace verbatim** — for collaborations, MB emits join glue like `' & '`, `' feat. '` between credits. Trimming would corrupt formatting; the adapter keeps the spaces inside the join and only trims the final string.
- **`ended`**: MusicBrainz uses three states. `null` when the artist is still active, an ISO date when there's a known end date, or `'true'` when the artist explicitly ended without a date on file.
- **`releaseCountry` prefers ISO-3166-1 codes** (`'GB'`, `'US'`) when available; falls back to area name for super-national releases (`'XE'` for Europe, etc.).
- **`type`** classifies artists as `Group`, `Person`, `Orchestra`, `Choir`, `Character`, or `Other`.
- **`score`** (artist search only) is MusicBrainz's relevance score (0–100). Higher = stronger title match.
- **No API key required**, but **MusicBrainz strictly rate-limits anonymous traffic to ~1 req/s.** Bursts → `CommandExecutionError`. The adapter sets a polite User-Agent so MB can route abusers if necessary.
- **Errors.** Bad MBID shape / bad limit → `ArgumentError`; unknown MBID → `EmptyResultError`; transport / 503 / 429 → `CommandExecutionError`.
