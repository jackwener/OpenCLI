# AppMagic

**Mode**: 🌐 Public · **Domain**: `appmagic.rocks`

Mobile app & game market intelligence from [AppMagic](https://appmagic.rocks) — top charts, app/publisher lookup, competitor and genre discovery, and "rising star" detection. All commands are public (no login) and fetch JSON directly; none drive the browser.

## Commands

| Command | Description |
|---------|-------------|
| `opencli appmagic top-charts` | App rankings (top free / grossing / featuring) filtered by tag, store, country, period |
| `opencli appmagic top-chart-tags` | The tags `top-charts --tag` and `game-* --genre` accept, grouped and sized by app count |
| `opencli appmagic tags` | Raw tag taxonomy lookup (resolve a tag id by name / type) |
| `opencli appmagic search` | Find apps and publishers by name |
| `opencli appmagic app` | Store listing detail for one app |
| `opencli appmagic app-releases` | Version history for one app, newest first |
| `opencli appmagic publisher` | Publisher profile and portfolio size |
| `opencli appmagic app-competitors` | AppMagic's Competitors Dashboard for an app |
| `opencli appmagic app-sdks` | SDKs / third-party tech detected in an app |
| `opencli appmagic app-similar` | Apps similar to a given app |
| `opencli appmagic app-featuring` | Store featuring placements for an app (latest date) |
| `opencli appmagic game-competitors` | The competitive field around a game: top games in its auto-detected genre |
| `opencli appmagic game-risers` | Fast-climbing "rising star" games ranked by chart rank-change |
| `opencli appmagic game-genres` | Genre saturation map: how many games each sub-genre holds |

## Usage Examples

```bash
# Worldwide top apps this month (downloads / revenue / featuring)
opencli appmagic top-charts --limit 20

# Top games in a genre, filtered by tag name or id
opencli appmagic top-charts --tag Messenger --limit 20

# Discover which tags you can filter by, biggest first
opencli appmagic top-chart-tags --type games --min-apps 5000

# Search apps or publishers
opencli appmagic search "knit away" --kind app
opencli appmagic search openai --kind publisher

# One app: listing, version history, competitors, SDKs, similar apps, featuring
opencli appmagic app com.ig.wool.rescue
opencli appmagic app-releases com.ig.wool.rescue --limit 10
opencli appmagic app-competitors com.ig.wool.rescue
opencli appmagic app-featuring com.snapchat.android

# --- Game market discovery ---

# Who leads your game's genre (genre auto-detected from the seed app)
opencli appmagic game-competitors com.ig.wool.rescue --chart grossing

# Fast-climbing new games (breakouts): big rank jump + released recently
opencli appmagic game-risers --genre Puzzle --period month --new-within 12

# How crowded a genre and its sub-genres are, by app count
opencli appmagic game-genres --genre Puzzle
```

## Output Columns

- **top-charts**: `rank` · `freeApp` · `freePublisher` · `downloadsMin` · `downloadsMax` · `grossingApp` · `grossingPublisher` · `revenueMin` · `revenueMax` · `featuringApp` · `featuringPublisher` · `featuring`
- **game-risers**: `chartRank` · `rankChange` · `name` · `publisher` · `hq` · `genre` · `downloadsMin` · `downloadsMax` · `releaseDate` · `ageMonths` · `unitedId`
- **game-competitors**: `rank` · `name` · `publisher` · `hq` · `downloadsMin` · `downloadsMax` · `rankChange` · `releaseDate` · `isSeed` · `genre` · `unitedId`
- **game-genres**: `genre` · `subGenre` · `tagId` · `appCount` · `sharePct` · `genreTotal`

Run any command with `--help` for its full option and column list.

## Notes

- **Downloads / revenue are bucketed lower bounds, not exact figures.** The site renders them as `> 20,000,000` / `< $5,000` / `—`, so metrics are exposed as `Min` / `Max` pairs (`0` → both `null` = no data; `1` → `Max: 5000` = "< $5,000"; any other value → `Min` = lower bound). These figures cover the trailing 30 days, not lifetime.
- **`top-charts` metrics** only populate for `--store all` + `--country WW` + `--aggregation month|year`; other combinations still return valid ranks with `null` metrics.
- **"Rising star" is rank-change, not % growth.** AppMagic's exact download/revenue growth, new-release feeds, and time-series are premium-gated (HTTP 401/403). The only public growth signal is a chart's rank movement (`diff`), so `game-risers` ranks by that; pair it with `--new-within` for breakout new releases.
- **Soft paywalls**: `app-competitors` returns ~3 of `competitorTotal` and `app-sdks` returns 1 of `sdkTotal` on the public tier — both surface the true total on every row so the gap is visible.

## Prerequisites

None — all commands are public and require no login or browser extension.
