# OEIS

**Mode**: 🌐 Public · **Domain**: `oeis.org`

Search the Online Encyclopedia of Integer Sequences by keyword or pattern, and fetch full sequence detail by A-number. OEIS is the canonical reference for integer sequences in mathematics — every sequence has a unique `Annnnnn` id.

## Commands

| Command | Description |
|---------|-------------|
| `opencli oeis search <query>` | Search OEIS sequences by keyword or numeric pattern |
| `opencli oeis sequence <id>` | Full OEIS sequence detail by A-number |

## Usage Examples

```bash
# Keyword search
opencli oeis search fibonacci
opencli oeis search "prime gaps" --limit 5

# Numeric pattern search (find sequences matching a prefix)
opencli oeis search "1,1,2,3,5,8"            # Fibonacci
opencli oeis search "2,3,5,7,11,13,17"       # primes

# Sequence detail (A-number round-trips from search)
opencli oeis sequence A000045                  # Fibonacci
opencli oeis sequence A000040                  # Primes
opencli oeis sequence A000041                  # Partitions
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, id, name, keywords, preview, author, created, url` |
| `sequence` | `id, name, keywords, preview, termCount, offset, author, created, revision, commentCount, formulaCount, referenceCount, xrefCount, linkCount, url` |

The `id` column round-trips between commands.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Keyword or comma-separated terms |
| `--limit` | Max sequences (1–100, default: 10). OEIS' wire format returns 10 per page; the adapter paginates server-side until `limit` is satisfied or upstream runs out. |

### `sequence`

| Option | Description |
|--------|-------------|
| `id` (positional) | OEIS A-number (e.g. `A000045`). Full URLs (`https://oeis.org/A000045`) and lowercase (`a000045`) are accepted. |

## Notes

- **`id` is always zero-padded to 6 digits** (`A000045`, `A000040`) — OEIS' canonical form. Search responses have raw integers (`number: 45`); the adapter formats them into the canonical id.
- **`preview` is the first 12 terms**, comma-joined. The full term sequence can be hundreds of integers; we cap with `(+N)` suffix so rows stay scannable. Use `sequence` + the `data` API tier (not exposed here) for the full term stream.
- **`keywords` is a comma-joined string**, OEIS' raw format. Common keywords:
  - `core` — universally referenced
  - `nice` — pleasing / well-known
  - `easy` — easy to compute
  - `nonn` — non-negative
  - `mult` — multiplicative
  - `cofr` — continued-fraction ish
- **`offset`** is OEIS' notation for where the sequence begins (`'0,4'` means first term is at index 0, first term ≥ 2 is at index 4). Useful for sequences that start with `1, 1` and you need to know where the "interesting" terms are.
- **`commentCount` / `formulaCount` / `referenceCount` / `xrefCount` / `linkCount`** are integer counts of how rich the OEIS page is. The full graphs are not surfaced — they can be enormous (Fibonacci has 250 links).
- **No API key required.** OEIS' free service is generous; bursts → `CommandExecutionError`.
- **Errors.** Empty query / bad A-number / bad limit → `ArgumentError`; unknown id / no matches → `EmptyResultError`; transport / 429 / non-200 → `CommandExecutionError`.
