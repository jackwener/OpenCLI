# openFDA

**Mode**: 🌐 Public · **Domain**: `fda.gov`

US Food & Drug Administration public data API. No API key required for modest read traffic (~240 req/min, 1000 req/day per IP). An API key bumps the daily quota but isn't needed for typical use.

## Commands

| Command | Description |
|---------|-------------|
| `opencli openfda drug-label <query>` | Search FDA-approved drug labels by brand or generic name |
| `opencli openfda food-recall` | FDA food recall and enforcement actions, most recent first |

## Usage Examples

```bash
# Drug label search
opencli openfda drug-label aspirin
opencli openfda drug-label lisinopril --limit 3

# Recent food recalls (no filter — all recent)
opencli openfda food-recall --limit 5

# Filter to Class I (most serious) recalls
opencli openfda food-recall --classification "Class I"

# Free-text Lucene search
opencli openfda food-recall --query salmonella
opencli openfda food-recall --query listeria --status Ongoing
```

## Output Columns

| Command | Columns |
|---------|---------|
| `drug-label` | `rank, id, brandName, genericName, manufacturer, productType, route, productNdc, pharmClass, purpose, indications, warnings, dosage, effectiveTime` |
| `food-recall` | `rank, recallNumber, status, classification, voluntary, recallingFirm, city, state, country, productDescription, reasonForRecall, productQuantity, distributionPattern, reportDate, recallInitiationDate, terminationDate` |

## Options

### `drug-label`

| Option | Description |
|--------|-------------|
| `query` (positional) | Brand or generic drug name (e.g. `aspirin`, `lisinopril`) |
| `--limit` | Max rows (1–25, default 5; openFDA caps anonymous tier at 25/page) |

### `food-recall`

| Option | Description |
|--------|-------------|
| `--query` | Free-text Lucene query (e.g. `salmonella`, `listeria`); default: all recent recalls |
| `--status` | `Ongoing`, `Completed`, `Terminated` |
| `--classification` | `Class I` (most serious), `Class II`, `Class III` |
| `--limit` | Max rows (1–100, default 10; openFDA caps anonymous tier at 100/page) |

## Notes

- **`[string]` arrays everywhere.** openFDA returns most label fields as 1-element arrays (e.g. `purpose: ["Pain reliever"]`). The adapter's `firstOrNull` helper unwraps them, preserving `null` when the slot is missing.
- **`pharmClass` fallback chain.** A drug can have several pharmacologic class fields (`pharm_class_epc` = established class, `_moa` = mechanism of action, `_cs` = chemical structure, `_pe` = physiologic effect). The adapter prefers EPC (most user-meaningful) and falls back through MOA → CS → PE.
- **Lucene query syntax.** `--query salmonella` becomes `search=salmonella` — single bare term. Multiple filters are combined with `+AND+` (literal, NOT URL-encoded — openFDA's parser treats the encoded form as a syntax error).
- **`drug-label` brand OR generic match.** The adapter sends `openfda.brand_name:"X"+openfda.generic_name:"X"` so a query like `aspirin` matches the trade-name and the chemical name in one query.
- **`reportDate` / `recallInitiationDate` / `terminationDate`** are `YYYYMMDD` strings (no separator) as openFDA returns them — passed through unchanged.
- **`terminationDate: null`** for ongoing recalls — preserved (not coerced to a sentinel string).
- **404 = no matches.** openFDA returns HTTP 404 instead of an empty `results[]` array when a query has no hits — the adapter promotes that to `EmptyResultError`.
- **Errors.** Empty query / `--limit` out of range → `ArgumentError`; 404 → `EmptyResultError`; 429 / transport / non-200 → `CommandExecutionError`.
