# Chess.com

**Mode**: 🌐 Public · **Domain**: `api.chess.com` / `www.chess.com`

Read-only adapter against the public Chess.com endpoints. `stats`, `games`, `game` use no-auth REST; `analyze` opens the Chess.com analysis board in a bound browser session.

## Commands

| Command | Description |
|---------|-------------|
| `opencli chess stats <username>` | Player rating + win/loss/draw record across game kinds (rapid / blitz / bullet / daily / chess960) |
| `opencli chess games <username>` | Recent games newest-first across one or more monthly archives |
| `opencli chess game <game-url>` | Single-game detail (white, black, result, ECO, termination, ply count) by full game URL |
| `opencli chess analyze <game-url>` | Open the game in Chess.com's analysis board in the bound browser session |

## Usage Examples

```bash
# Stats
opencli chess stats hikaru
opencli chess stats magnuscarlsen -f json

# Recent games (default 10, max 100)
opencli chess games hikaru
opencli chess games erik --limit 25

# Single-game detail from a game URL
opencli chess game https://www.chess.com/game/live/168842570216
opencli chess game https://www.chess.com/game/daily/947761777

# Open in Chess.com analysis board (browser session required)
opencli chess analyze https://www.chess.com/game/live/168842570216
```

## Columns

### `stats`

| Column | Notes |
|--------|-------|
| `kind` | `rapid` / `blitz` / `bullet` / `daily` / `chess960_daily` (only kinds the player has played) |
| `rating_current` | Latest rating |
| `rating_best` | All-time best rating |
| `wins` / `losses` / `draws` | Cumulative record |

### `games`

| Column | Notes |
|--------|-------|
| `date` | Game end date in `YYYY-MM-DD` (UTC) |
| `time_class` | `rapid` / `blitz` / `bullet` / `daily` |
| `rated` | Boolean |
| `my_color` | `white` or `black` from the viewer's perspective |
| `my_rating` | Viewer's rating in this game |
| `my_result` | `win` / `resigned` / `timeout` / `checkmated` / `agreed` / `repetition` / etc |
| `opponent` | Opponent's Chess.com username |
| `opponent_rating` | Opponent's rating at game time |
| `accuracy_white` / `accuracy_black` | Chess.com move-accuracy percentage (0-100) when computed by Game Review; empty when the game wasn't analyzed (unrated / very short / abandoned) |
| `eco` | Raw ECO opening tag or full opening URL chess.com encodes on the row |
| `opening_name` | Human-readable opening name parsed from the eco URL (e.g. `Reti Opening Nimzo Larsen Variation`); empty when `eco` is the short-code form (`A01`) which carries no name |
| `url` | Game URL on chess.com |

## Username Validation

Usernames are normalized to lowercase and matched against `^[a-zA-Z0-9_-]{3,25}$`. Invalid inputs raise `ArgumentError` before any HTTP call.

## Archive Walk

`games` calls `/pub/player/<user>/games/archives` first to list every month the player has games in, then walks the list newest-first fetching one monthly archive at a time until `--limit` is filled. Capped at 6 monthly fetches per invocation so an obscure account with a long archive history doesn't fan out.

## Limit Validation

`--limit` accepts integers in `[1, 100]`. Out-of-range / non-integer values raise `ArgumentError` (no silent clamp).

### `game`

| Column | Notes |
|--------|-------|
| `kind` | `live` or `daily` parsed from the URL |
| `game_id` | Numeric id parsed from the URL |
| `date` | `YYYY-MM-DD` from PGN headers (end-time fallback) |
| `white` / `black` | Usernames; resolved from `players.{top,bottom}` keyed by `.color`, with `pgnHeaders.{White,Black}` fallback |
| `white_rating` / `black_rating` | Per-player rating at game time |
| `result` | PGN result token: `1-0`, `0-1`, `1/2-1/2` |
| `winner_color` | `white`, `black`, or empty on draw |
| `termination` | Human-readable reason (e.g. "Hikaru won by resignation") |
| `eco` | ECO opening code |
| `time_control` | Wire `TimeControl` header for live (`180` = 3 min), `<N>d/turn` for daily |
| `rated` | Boolean |
| `ply_count` | Half-move count |
| `url` | Canonical game URL |

### `analyze`

| Column | Notes |
|--------|-------|
| `kind` | `live` / `daily` parsed from the URL |
| `game_id` | Numeric id parsed from the URL |
| `analysis_url` | Resolved `/analysis/game/<kind>/<id>` URL the bound browser session navigated to |

## Endpoint Notes

`game` uses `/callback/{live\|daily}/game/{id}` on `www.chess.com` (the same JSON the Chess.com web client hits when rendering a game page). The public REST surface at `api.chess.com/pub` has no single-game endpoint; the callback path is the cleanest way to honour "PGN for specific game" without DOM scraping.

`analyze` is a thin wrapper around `page.goto('/analysis/game/<kind>/<id>')`. Requires a bound browser session; if you only need to open a URL, `opencli browser <session> open <url>` is the more general primitive.

## Out of Scope

- Live game tracking (live moves streaming): outside the public REST surface.
- Move-by-move engine evaluation: separate concern, would belong in a future `chess engine` adapter.
