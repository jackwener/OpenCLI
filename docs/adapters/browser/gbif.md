# GBIF

**Mode**: 🌐 Public · **Domain**: `api.gbif.org`

Search the GBIF Backbone Taxonomy and look up biodiversity occurrence records. Public REST API, no auth.

## Commands

| Command | Description |
|---------|-------------|
| `opencli gbif species <query>` | Search the GBIF Backbone Taxonomy by name (returns full kingdom→species lineage + taxonKey) |
| `opencli gbif occurrence` | Find observation / specimen records by taxon key, name, or country |

## Usage Examples

```bash
# Find a taxon by common or scientific name
opencli gbif species "Panthera leo"
opencli gbif species lion --limit 5

# Occurrences for a known taxon (round-trips from `species`)
opencli gbif occurrence --taxon-key 5219404 --country KE --limit 10

# Or by name (GBIF resolves to a taxonKey internally)
opencli gbif occurrence --query "Panthera leo" --limit 5
```

## Output Columns

| Command | Columns |
|---------|---------|
| `species` | `rank, taxonKey, scientificName, canonicalName, rank_taxon, taxonomicStatus, kingdom, phylum, class, order, family, genus, species, url` |
| `occurrence` | `rank, occurrenceKey, taxonKey, scientificName, eventDate, country, stateProvince, latitude, longitude, basisOfRecord, datasetName, recordedBy, url` |

The `taxonKey` from `species` round-trips into `occurrence --taxon-key`.

## Options

### `species`

| Option | Description |
|--------|-------------|
| `query` (positional) | Scientific or common name |
| `--limit` | Max rows (1–100, default: 20) |

### `occurrence`

| Option | Description |
|--------|-------------|
| `--taxon-key` | GBIF Backbone taxon key (preferred — exact match) |
| `--query` | Free-text scientific name (used when `--taxon-key` not supplied) |
| `--country` | ISO 3166-1 alpha-2 country code (e.g. `KE`, `US`, `JP`) |
| `--limit` | Max rows (1–300, default: 20) |

At least one of `--taxon-key` or `--query` is required.

## Notes

- **Backbone-scoped search.** `species` pins `datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c` (GBIF Backbone Taxonomy) so every row carries the full kingdom→species lineage. Without this filter, third-party datasets dominate and most rows have empty kingdom/phylum/class — a silent-empty-column trap.
- **`taxonKey` prefers `nubKey`** (Backbone identity) over `key` (per-dataset id) for clean round-trip into `occurrence`.
- **`rank_taxon`** is the taxonomic rank (`SPECIES`, `GENUS`, `FAMILY`, …) — named to avoid colliding with the `rank` ordinal column.
- **Country code is ISO alpha-2.** `--country usa` is rejected; use `--country US`.
- **Errors.** Empty query / bad country / out-of-range limit → `ArgumentError`; GBIF returning zero matches → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
