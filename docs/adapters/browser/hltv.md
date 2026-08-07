# HLTV

**Mode**: 🌐 Browser · **Domain**: `hltv.org`

The HLTV adapter reads visible CS2/CS:GO stats pages through the Browser
Bridge. HLTV does not expose a stable public JSON API for these views, so the
commands parse search results, player stats, match mapstats, team stats, and
series pages from the rendered DOM.

## Commands

| Command | Description |
|---------|-------------|
| `opencli hltv search <query>` | Search players, teams, events, and articles |
| `opencli hltv player-summary` | Read a player's summary page and complete stats link |
| `opencli hltv player-matches` | Read a player's stats Matches tab |
| `opencli hltv player-form` | Aggregate recent player maps by summary, map, and opponent |
| `opencli hltv player-map-pool` | Aggregate a player's recent maps into map-pool buckets |
| `opencli hltv player-vs-team <team>` | Filter a player's maps against one team |
| `opencli hltv player-teammate-impact <playerA> <playerB>` | Compare shared and non-shared map samples for two teammates |
| `opencli hltv player-duel <playerA> <playerB>` | Compare two players on shared maps, including direct kills when available |
| `opencli hltv match-map <match>` | Read all player rows from one mapstats page |
| `opencli hltv match-series <match>` | Expand a BO1/BO3/BO5 into summary, map, and player rows |
| `opencli hltv team-matches <team>` | Read recent team map results |
| `opencli hltv team-map-pool <team>` | Read a team's visible map-pool stats |
| `opencli hltv event-matches <event>` | Read stats match rows for one event |

## Usage Examples

```bash
# Search and discover HLTV entity links
opencli hltv search niko --limit 5

# Read player pages and recent form
opencli hltv player-summary --player 3741/niko
opencli hltv player-matches --player 3741/niko --limit 10 -f json
opencli hltv player-form --player 19230/m0nesy --limit 30

# Compare two players
opencli hltv player-duel 3741/niko 21167/donk
opencli hltv player-duel 19230/m0nesy 3741/niko --mode history --limit 10

# Expand a series or inspect one mapstats URL
opencli hltv match-series https://www.hltv.org/stats/matches/126993/spirit-vs-falcons
opencli hltv match-map "https://www.hltv.org/stats/matches/mapstatsid/231594/falcons-vs-natus-vincere" -f json

# Team and event views
opencli hltv team-matches 6667/falcons --limit 10
opencli hltv team-map-pool 11283/falcons
opencli hltv event-matches 8301 --limit 10
```

## Common Subjects

- Player refs accept `id/slug`, player URLs, and compatible stats player URLs.
- Team refs accept `id/slug`, team URLs, and compatible stats team URLs.
- Match refs accept normal match URLs, stats series URLs, and mapstats URLs where
  supported.
- Event refs accept event IDs, `/events/:id/:slug` URLs, and stats URLs with an
  `event=` query parameter.

## Prerequisites

- Chrome running with the [Browser Bridge extension](/guide/browser-bridge)
  installed
- HLTV accessible in the active browser session
- If HLTV shows a Cloudflare or human-verification page, complete it in Chrome
  before retrying the command

## Notes

- The adapter is read-only and does not require HLTV login.
- Heavy match or duel commands may load multiple HLTV pages and can take longer
  than search or summary commands.
- Use `--window foreground --keep-tab true` when debugging HLTV page structure
  or Cloudflare interruptions.
- Primary subjects use positional arguments; filters such as `--limit`,
  `--period`, `--ranking`, `--map`, and `--version` remain named options.

## Error Behaviour

| Condition | Error |
|-----------|-------|
| Invalid player, team, event, match, limit, offset, or filter argument | `ArgumentError` |
| Visible HLTV page contains no rows for the requested subject/filter | `EmptyResultError` |
| HLTV page structure changed or parser returns an unexpected shape | `CommandExecutionError` |
| Browser navigation or selector wait exceeds the command timeout | `TimeoutError` |
