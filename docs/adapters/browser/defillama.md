# DefiLlama

**Mode**: 🌐 Public · **Domain**: `defillama.com`

Browse top DeFi protocols by TVL and fetch detailed protocol metadata. Both commands hit the unauthenticated `api.llama.fi` directly.

## Commands

| Command | Description |
|---------|-------------|
| `opencli defillama protocols` | Top DeFi protocols by current TVL (slug, name, category, TVL, mcap, change, chains) |
| `opencli defillama protocol <slug>` | Single protocol details (current TVL, mcap, chains, twitter, github, description) |

## Usage Examples

```bash
# Top 30 protocols by TVL (default)
opencli defillama protocols

# Top 100, JSON output
opencli defillama protocols --limit 100 -f json

# Single protocol details (slug from protocols rows)
opencli defillama protocol aave-v3
opencli defillama protocol lido

# Parent protocols (e.g. "aave") aggregate their children's chains
opencli defillama protocol aave
```

## Output Columns

| Command | Columns |
|---------|---------|
| `protocols` | `rank, slug, name, category, tvl, mcap, change_1d, change_7d, chains, listedAt, url` |
| `protocol` | `slug, name, category, isParent, tvl, tvlAt, mcap, chains, twitter, github, audits, listedAt, description, website, url` |

The `slug` column from `protocols` round-trips into `protocol`.

## Options

### `protocols`

| Option | Description |
|--------|-------------|
| `--limit` | Number of rows to return (1–500, default: 30). DefiLlama lists ~7400 protocols total. |

### `protocol`

| Option | Description |
|--------|-------------|
| `slug` (positional) | DefiLlama protocol slug (e.g. `aave-v3`, `lido`, `pancakeswap-amm`) |

## Notes

- **TVL is in USD.** `tvl` and `mcap` are scalar floats; consumers should format as money.
- **Parent vs child protocols.** "Parent" entries (`isParent=true`, e.g. `aave` covers `aave-v3`, `aave-v2`, etc.) are present on `protocol` but not on `protocols`. The adapter aggregates child chains so parents still surface a useful `chains` value.
- **`change_1d` / `change_7d` are percentages** (already as percent, e.g. `0.84` = +0.84%).
- **No API key required.** DefiLlama throttles unauthenticated traffic; an `HTTP 429` surfaces as `CommandExecutionError`.
- **Errors.** Bad slug → `ArgumentError`; unknown slug → `EmptyResultError` (DefiLlama returns `HTTP 400 "Protocol not found"` which is normalised); other 4xx/5xx → `CommandExecutionError`.
