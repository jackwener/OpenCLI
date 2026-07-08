# Lichess

**Mode**: 🌐 Public · **Domain**: `lichess.org`

Look up public Lichess player profiles and per-perf top-N leaderboards. Lichess is a free open-source chess platform; its REST API is fully public and unauthenticated for these read-only endpoints.

## Commands

| Command | Description |
|---------|-------------|
| `opencli lichess user <username>` | Lichess player profile (rating, perfs, win/loss counts) |
| `opencli lichess top <perf>` | Top-N leaderboard for a perf type (bullet/blitz/rapid/classical/...) |

## Usage Examples

```bash
# Player profile
opencli lichess user DrNykterstein
opencli lichess user penguingm1

# Top-N leaderboards (username round-trips into `lichess user`)
opencli lichess top blitz
opencli lichess top bullet --limit 50
opencli lichess top rapid --limit 25
opencli lichess top chess960
```

## Output Columns

| Command | Columns |
|---------|---------|
| `user` | `username, id, title, patron, online, tosViolation, createdAt, seenAt, gamesAll, gamesWin, gamesLoss, gamesDraw, topPerfName, topPerfRating, topPerfGames, fideRating, country, bio, url` |
| `top` | `rank, username, id, title, rating, progress, patron, url` |

The `username` column round-trips from `top` into `user`.

## Options

### `user`

| Option | Description |
|--------|-------------|
| `username` (positional) | Lichess username (case-insensitive, 2–30 chars, letters/digits/underscore/dash) |

### `top`

| Option | Description |
|--------|-------------|
| `perf` (positional) | Perf type: `ultraBullet`, `bullet`, `blitz`, `rapid`, `classical`, `chess960`, `crazyhouse`, `antichess`, `atomic`, `horde`, `kingOfTheHill`, `racingKings`, `threeCheck` |
| `--limit` | Top-N rows (1–200, default: 10) |

## Notes

- **`topPerfName`/`topPerfRating`/`topPerfGames`** picks the perf with the most games played, excluding non-game perfs (`puzzle`, `storm`, `racer`, `streak`). For most active accounts this is `bullet` or `blitz`. For inactive accounts the field surfaces whatever the account played most before going quiet.
- **Closed accounts → `EmptyResultError`.** Lichess marks deleted/closed accounts with `disabled: true` and strips most fields; surfacing a row of nulls would be silent-fallback. We surface as `EmptyResultError` instead so the agent knows the account is gone.
- **`tosViolation`** is `true` when the account has been flagged for cheating / TOS abuse — important when interpreting their rating progression.
- **`progress`** (top only) is the perf's recent rating delta (last 12 games). `null` when not enough recent games to compute.
- **`fideRating` / `country` / `bio`** are user-supplied profile fields; commonly `null` for accounts that haven't filled them in.
- **No API key required.** Lichess throttles anonymous traffic at ~60 req/min per IP; bursts → `CommandExecutionError`.
- **Errors.** Bad username / unknown perf / bad limit → `ArgumentError`; unknown / disabled user → `EmptyResultError`; transport / 429 / non-200 → `CommandExecutionError`.
