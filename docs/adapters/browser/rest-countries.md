# REST Countries

**Mode**: 🌐 Public · **Domain**: `restcountries.com`

Look up countries by name (substring match) and list every country in a region. REST Countries is a free public country-metadata registry covering ISO codes, capitals, languages, currencies, lat/lon, timezones, UN membership, and more.

## Commands

| Command | Description |
|---------|-------------|
| `opencli rest-countries country <name>` | Look up countries by common / official name |
| `opencli rest-countries region <region>` | List every country in a region |

## Usage Examples

```bash
# Name search (substring, returns 1 or many)
opencli rest-countries country japan
opencli rest-countries country "united kingdom"
opencli rest-countries country guinea          # matches Guinea, Guinea-Bissau, etc.

# Region listing (sorted by population desc)
opencli rest-countries region europe
opencli rest-countries region asia --limit 20
opencli rest-countries region oceania
```

## Output Columns

Both commands share the same column set:

| Column | Description |
|--------|-------------|
| `rank` | Population rank within the response |
| `commonName` / `officialName` | Common and official country names |
| `cca2` / `cca3` / `ccn3` | ISO 3166-1 alpha-2 / alpha-3 / numeric codes |
| `capital` | Comma-joined capitals (most countries have 1, but South Africa has 3) |
| `region` / `subregion` | Geographic region & subregion |
| `population` / `area` | Population (people), area (km²) |
| `languages` | Comma-joined official language names |
| `currencies` | Comma-joined `CODE (Name)` pairs |
| `latitude` / `longitude` | Country centroid in decimal degrees |
| `timezones` | Comma-joined UTC offsets |
| `independent` / `unMember` / `landlocked` | Boolean flags |
| `flag` | Unicode flag emoji |
| `url` | REST Countries `alpha/<cca3>` lookup URL |

## Options

### `country`

| Option | Description |
|--------|-------------|
| `name` (positional) | Country name (substring match across common & official names) |
| `--limit` | Max rows (1–250, default: 25) |

### `region`

| Option | Description |
|--------|-------------|
| `region` (positional) | One of: `africa`, `americas`, `asia`, `europe`, `oceania`, `antarctic` (case-insensitive) |
| `--limit` | Max rows (1–250, default: 250) |

## Notes

- **Population-sorted by default.** Both `country` and `region` sort responses by `population` descending so the most-populous match appears at rank 1. This makes `rest-countries country guinea --limit 1` reliably surface Guinea (the country) rather than Guinea-Bissau or Papua New Guinea.
- **`languages` / `currencies` are comma-joined**, not nested objects. REST Countries' raw shape is `{eng: 'English'}` / `{USD: {name, symbol}}`; we flatten to `'English'` / `'USD (United States dollar)'` for agent-readable rows.
- **`capital` is comma-joined**, since some countries have multiple capitals (e.g. South Africa: `Pretoria, Cape Town, Bloemfontein`).
- **`independent` / `unMember` / `landlocked`** are tri-state (boolean or `null`) — REST Countries doesn't fill them for every entity (rare territories may omit).
- **No API key required.** REST Countries' free tier is very generous; bursts → `CommandExecutionError`.
- **Errors.** Empty name / unknown region / bad limit → `ArgumentError`; unknown name (HTTP 404) → `EmptyResultError`; transport / 429 / non-200 → `CommandExecutionError`.
