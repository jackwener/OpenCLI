# Chess.com Adapter

**Mode**: 🌐 Public/🍪 Cookie · **Domain**: `www.chess.com`

Access Chess.com player statistics, game archives, and analysis via CLI.

## Commands

| Command | Description |
|---------|-------------|
| `opencli chess stats <username>` | Player profile and ratings (bullet/blitz/rapid/daily) |
| `opencli chess games <username>` | List player's recent games (by month) |
| `opencli chess game <gameId>` | Get details for a specific game |
| `opencli chess game <gameId> --pgn` | Get full PGN for a game |
| `opencli chess analyze <gameId>` | Open game in browser for visual analysis |
| `opencli chess pgn <gameId>` | Extract PGN via browser (Share → Copy PGN flow) |
| `opencli chess snapshot <gameId>` | Extract structured game state (moves, clock, eval) |

## Usage Examples

```bash
# Player stats
opencli chess stats GMHikaru
opencli chess stats aaronwang2026

# Game archives by month
opencli chess games GMHikaru --limit 10
opencli chess games aaronwang2026 --year 2026 --month 4

# Game details
opencli chess game 167564728910

# With PGN (for analysis)
opencli chess game 167564728910 --pgn

# Browser-based PGN extraction (more reliable when API PGN is corrupted)
opencli chess pgn 167564728910

# Open in browser for visual analysis
opencli chess analyze 167564728910
```

## API Notes

- **Public endpoints** (`stats`, `games`): ~1000 req/day per IP
- **Browser-based** (`pgn`, `analyze`, `snapshot`): Uses Chrome session for 100% reliable PGN extraction
- **PGN corruption**: Chess.com API returns corrupted PGN in ~20-30% of games; use `opencli chess pgn` for reliable extraction

## Output Columns

| Command | Columns |
|---------|---------|
| `stats` | `username, title, status, joined, lastOnline, chessBullet, chessBlitz, chessRapid, chessDaily, tacticsHighest, puzzleRushBest, gamesAll, url` |
| `games` | `date, white, whiteRating, black, blackRating, result, timeControl, eco, opening, url, gameId` |
| `game` | `gameId, date, white, whiteRating, black, blackRating, result, timeControl, eco, opening, moves, url` |
| `analyze` | `gameId, url, status` |
| `pgn` | `gameId, pgn` |
| `snapshot` | `gameId, turn, fen, moveList, evaluation, clock, result` |

## Browser Commands (for AI Agents)

These commands use the logged-in Chrome session to extract game data:

- `navigate` to game page
- `wait` for board to load
- `evaluate` to click Share → PGN
- `extract` the PGN text

This bypasses API rate limits and provides 100% accurate PGN extraction.

## Dependencies

- OpenCLI browser bridge extension
- Chrome/Chromium with Chess.com session (for browser-based commands)
- Node.js >= 21

## References

- [Chess.com Public API Documentation](https://www.chess.com/news/view/pieces-of-the-puzzle)
- [Lichess adapter](./lichess/) - Similar adapter for the Lichess platform
