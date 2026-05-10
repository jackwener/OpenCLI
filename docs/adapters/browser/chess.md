# Chess.com

**Mode**: 🌐 Public/🍪 Cookie · **Domain**: `www.chess.com`

Access Chess.com player statistics, game archives, and analysis via CLI. Chess.com is the most popular chess platform with millions of active players.

## Commands

| Command | Description |
|---------|-------------|
| `opencli chess stats <username>` | Player profile and ratings (bullet/blitz/rapid/daily) |
| `opencli chess games <username>` | List player's recent games (by month) |
| `opencli chess game <gameId>` | Get details for a specific game |
| `opencli chess game <gameId> --pgn` | Get full PGN for a game |
| `opencli chess pgn <gameId>` | Extract PGN via browser (Share → Copy PGN flow) |
| `opencli chess analyze <gameId>` | Open game in browser for visual analysis |
| `opencli chess snapshot <gameId>` | Extract structured game state for AI agents |

## Usage Examples

```bash
# Player statistics and ratings
opencli chess stats GMHikaru
opencli chess stats aaronwang2026

# Game archives by month (default: current month)
opencli chess games GMHikaru --limit 10
opencli chess games aaronwang2026 --year 2026 --month 4

# Game details
opencli chess game 167564728910
opencli chess game 167564728910 --pgn

# Browser-based PGN extraction (more reliable when API PGN is corrupted)
opencli chess pgn 167564728910

# Open in browser for visual analysis
opencli chess analyze 167564728910

# Extract structured game state for AI agent analysis
opencli chess snapshot 167564728910
```

## Output Columns

| Command | Columns |
|---------|---------|
| `stats` | `username, title, status, joined, lastOnline, chessBullet, chessBlitz, chessRapid, chessDaily, tacticsHighest, puzzleRushBest, gamesAll, url` |
| `games` | `date, white, whiteRating, black, blackRating, result, timeControl, eco, opening, url, gameId` |
| `game` | `gameId, date, white, whiteRating, black, blackRating, result, timeControl, eco, opening, moves, url` |
| `analyze` | `gameId, url, status` |
| `pgn` | `gameId, pgn` |
| `snapshot` | `gameId, turn, fen, moveList, evaluation, clock, result` |

## Options

### `stats`

| Option | Description |
|--------|-------------|
| `username` (positional) | Chess.com username (3–30 chars, letters/digits/underscore/hyphen) |

### `games`

| Option | Description |
|--------|-------------|
| `username` (positional) | Chess.com username |
| `--year` | Year (default: current year) |
| `--month` | Month 1–12 (default: current month) |
| `--limit` | Max games to return (1–100, default: 20) |

### `game`

| Option | Description |
|--------|-------------|
| `gameId` (positional) | Chess.com game ID (numeric) |
| `--pgn` | Return full PGN instead of table |

### `pgn`, `analyze`, `snapshot`

| Option | Description |
|--------|-------------|
| `gameId` (positional) | Chess.com game ID |

## Notes

- **Public API** (`stats`, `games`, `game`): Uses `api.chess.com/pub/` endpoints. Rate limit ~1000 req/day per IP.
- **PGN corruption**: Chess.com API returns corrupted/malformed PGN in ~20–30% of games (especially truncation around move 11+). For reliable PGN extraction, use `opencli chess pgn` which uses the browser-based Share → Copy PGN flow.
- **Browser commands** (`pgn`, `analyze`, `snapshot`): Use the logged-in Chrome session via OpenCLI browser bridge. These bypass API rate limits and provide 100% accurate PGN extraction.
- **Time control classification**: `ultraBullet` (<30s), `bullet` (30s–3min), `blitz` (3–10min), `rapid` (10–30min), `classical` (>30min).
- **AI Agent integration**: The `snapshot` command extracts structured game state (move list, clock times, evaluation, result) for AI agent analysis. Combine with Stockfish for deep analysis.
- **Errors**: Bad username → `ArgumentError`; not found → `EmptyResultError`; rate limited → `CommandExecutionError`.

## See Also

- [Lichess adapter](./lichess.md) — Similar adapter for the Lichess open-source platform
- [chess-ai-coach-skills](https://github.com/wldandan/chess-ai-coach-skills) — AI agent skills for chess analysis with Stockfish
