# Frankfurter

**Mode**: 🌐 Public · **Domain**: `api.frankfurter.dev`

ECB-published foreign-exchange rates from `frankfurter.dev`. No auth, no signup.

## Commands

| Command | Description |
|---------|-------------|
| `opencli frankfurter latest` | Latest FX rates against a base currency |
| `opencli frankfurter historical <date>` | Historical rates for a single day or a date range |

## Usage Examples

```bash
# Latest USD rates
opencli frankfurter latest --base USD

# Specific targets
opencli frankfurter latest --base EUR --symbols USD,JPY,GBP

# Single historical day
opencli frankfurter historical 2024-01-02 --base USD

# Range (newest-first)
opencli frankfurter historical 2026-05-01 --to 2026-05-05 --base USD --symbols JPY
```

## Output Columns

| Command | Columns |
|---------|---------|
| `latest` | `rank, base, target, rate, date` |
| `historical` | `rank, date, base, target, rate` |

## Options

### `latest`

| Option | Description |
|--------|-------------|
| `--base` | Base currency (ISO 4217, default `EUR`) |
| `--symbols` | Comma-separated target currencies (e.g. `USD,JPY`); default: all |

### `historical`

| Option | Description |
|--------|-------------|
| `date` (positional) | Start date `YYYY-MM-DD` (or single day if `--to` omitted) |
| `--to` | End date; if set, returns daily rates from `date` to `to` |
| `--base` | Base currency (default `EUR`) |
| `--symbols` | Comma-separated target currencies |

## Notes

- **ECB midmarket rates.** Frankfurter republishes the European Central Bank's daily reference rates — published ~16:00 CET on TARGET2 trading days. Weekends/holidays return the most recent trading day.
- **Newest-first range.** Frankfurter's range response is `{rates: {date: {...}}}` keyed by date; the adapter sorts dates desc so the first row is the latest.
- **Currency validator** rejects anything that isn't 3 ASCII letters — `--base usa`, `--base us`, `--base US$` all `ArgumentError`.
- **No API key.** Public ECB data; bursts may return HTTP 422 (parameter validation) which surfaces as `EmptyResultError`.
- **Errors.** Bad currency / bad date / `--to < date` → `ArgumentError`; 404/422 → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
