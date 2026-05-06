# disease.sh

**Mode**: 🌐 Public · **Domain**: `disease.sh`

COVID-19 statistics from `disease.sh` (free, no auth, sourced from Worldometers + JHU + others).

## Commands

| Command | Description |
|---------|-------------|
| `opencli disease-sh global` | Worldwide COVID-19 totals (single row) |
| `opencli disease-sh country <country>` | Country-level totals (ISO2 / ISO3 / full name accepted) |

## Usage Examples

```bash
# Global
opencli disease-sh global

# By ISO2 / ISO3 / name
opencli disease-sh country US
opencli disease-sh country JPN
opencli disease-sh country "United Kingdom"
```

## Output Columns

| Command | Columns |
|---------|---------|
| `global` | `updated, cases, todayCases, deaths, todayDeaths, recovered, active, critical, casesPerMillion, deathsPerMillion, tests, population, affectedCountries` |
| `country` | `country, iso2, iso3, continent, updated, cases, todayCases, deaths, todayDeaths, recovered, active, critical, casesPerMillion, deathsPerMillion, tests, population, flag` |

## Options

### `country`

| Option | Description |
|--------|-------------|
| `country` (positional) | ISO2 (`US`), ISO3 (`USA`), or full country name |

## Notes

- **`updated`** is converted from epoch milliseconds to ISO 8601 UTC for readability.
- **Per-million columns** (`casesPerMillion`, `deathsPerMillion`) come straight from the API and let you compare burdens across countries with very different population sizes.
- **`recovered` / `active` may be 0** for some countries — many national agencies stopped publishing recovery counts in 2022. The values are reported as the API supplies them; no silent extrapolation.
- **No API key.** Public; rate-limited only for very high bursts (HTTP 5xx surfaces as `CommandExecutionError`).
- **Errors.** Empty country / unknown country → `ArgumentError` / `EmptyResultError` (404 from API); transport / non-200 → `CommandExecutionError`.
