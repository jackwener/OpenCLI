# World Bank

**Mode**: 🌐 Public · **Domain**: `api.worldbank.org`

World Bank Open Data API. Country profiles + indicator time series (GDP, population, inflation, etc).

## Commands

| Command | Description |
|---------|-------------|
| `opencli worldbank country <iso>` | Country profile (region, income group, capital, lat/lon) |
| `opencli worldbank indicator --country <iso> --indicator <code>` | Indicator time series for a country |

## Usage Examples

```bash
# Country profile
opencli worldbank country JPN
opencli worldbank country US

# GDP time series for Japan, last 20 years
opencli worldbank indicator --country JPN --indicator NY.GDP.MKTP.CD --years 2005:2024

# Population, default range
opencli worldbank indicator --country IND --indicator SP.POP.TOTL --limit 30
```

## Output Columns

| Command | Columns |
|---------|---------|
| `country` | `iso2, iso3, name, region, incomeLevel, lendingType, capital, longitude, latitude` |
| `indicator` | `rank, country, iso3, indicator, indicatorCode, date, value, unit` |

The `iso3` column from `country` round-trips into `indicator --country`.

## Options

### `country`

| Option | Description |
|--------|-------------|
| `country` (positional) | ISO country code (alpha-2 like `US`, or alpha-3 like `USA`) |

### `indicator`

| Option | Description |
|--------|-------------|
| `--country` | ISO country code |
| `--indicator` | World Bank indicator code (e.g. `NY.GDP.MKTP.CD`, `SP.POP.TOTL`) |
| `--years` | Year range `YYYY:YYYY` (e.g. `2000:2024`); optional |
| `--limit` | Max data points (1–500, default 50) |

## Common Indicator Codes

| Code | Meaning |
|------|---------|
| `NY.GDP.MKTP.CD` | GDP (current US$) |
| `NY.GDP.PCAP.CD` | GDP per capita (current US$) |
| `SP.POP.TOTL` | Population, total |
| `FP.CPI.TOTL.ZG` | Inflation, consumer prices (annual %) |
| `SL.UEM.TOTL.ZS` | Unemployment, total (% of labor force) |

## Notes

- **`[meta, results]` envelope.** Every World Bank response is a 2-element array — meta first, then results. The adapter unwraps so you get rows directly.
- **Empty / unknown lookup.** When you pass an unknown ISO code, World Bank returns `[{message: [...]}]` (no second element) — the adapter promotes this to `EmptyResultError` instead of crashing on `body[1]`.
- **`value: null`** is preserved (not silently coerced to 0) for missing data points, since 0 has real economic meaning.
- **Newest year first.** World Bank's default ordering is descending by `date`; the adapter does not reorder.
- **Errors.** Bad ISO code / bad indicator / malformed `--years` / out-of-range limit → `ArgumentError`; unknown country/indicator → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
