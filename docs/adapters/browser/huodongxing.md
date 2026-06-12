# Huodongxing

**Mode**: 🌐 Public / Browser · **Domain**: `www.huodongxing.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli huodongxing events` | Search Huodongxing events by tag, city, date range, event type, and title keyword |

## Usage Examples

```bash
# AI events across all cities for a date range
opencli huodongxing events --tag AI --city 全部 --date 2026-06-09 --dateTo 2026-06-12

# Offline events only
opencli huodongxing events --tag AI --city 上海 --eventType 1

# Online events only
opencli huodongxing events --eventType 2 --qs Agentic --limit 10

# JSON output
opencli huodongxing events --tag AI --city 北京 -f json
```

## Filters

- `--tag` maps to Huodongxing `tag`
- `--city` maps to Huodongxing `city`
- `--date` maps to Huodongxing `date`
- `--dateTo` maps to Huodongxing `dateTo`
- `--eventType 1` filters offline events
- `--eventType 2` filters online events
- `--qs` filters by event title keyword

## Prerequisites

Chrome running with [Browser Bridge extension](/guide/browser-bridge) installed. Login is not required for public event listings.
