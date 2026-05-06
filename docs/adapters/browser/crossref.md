# Crossref

**Mode**: 🌐 Public · **Domain**: `api.crossref.org`

Search the Crossref scholarly metadata index by keyword and fetch full metadata for any DOI. Crossref is the canonical DOI registry behind ~140M scholarly works (papers, chapters, datasets, preprints). No API key required.

## Commands

| Command | Description |
|---------|-------------|
| `opencli crossref works <query>` | Crossref scholarly works by keyword (DOI, title, authors, container, citations) |
| `opencli crossref work <doi>` | Full metadata for a DOI (authors, abstract, license, references, ISSN/ISBN) |

## Usage Examples

```bash
# Title / author search
opencli crossref works "quantum computing"
opencli crossref works "Hopfield networks" --limit 10

# DOI detail (round-trips from `works`)
opencli crossref work 10.1038/nature12373
opencli crossref work "https://doi.org/10.1038/nature12373"   # courtesy: full URL accepted
opencli crossref work "doi:10.1038/nature12373"               # courtesy: doi: prefix accepted
```

## Output Columns

| Command | Columns |
|---------|---------|
| `works` | `rank, doi, title, authors, container, publisher, type, published, citations, url` |
| `work` | `doi, title, authors, container, publisher, type, published, pages, volume, issue, issn, isbn, language, citations, referenceCount, license, subject, abstract, url` |

The `doi` column from `works` round-trips into `work`.

## Options

### `works`

| Option | Description |
|--------|-------------|
| `query` (positional) | Search keyword (title / author / abstract) |
| `--limit` | Max rows (1–100, default: 20) |

### `work`

| Option | Description |
|--------|-------------|
| `doi` (positional) | DOI (e.g. `10.1038/nature12373`); `doi:` and `https://doi.org/` prefixes are stripped automatically |

## Notes

- **`abstract` is the full Crossref abstract** with HTML stripped (`<jats:p>...</jats:p>` becomes plain text). `null` when no abstract is registered with Crossref — many papers don't deposit one even if the published version has one.
- **`authors` in `works`** is capped at the first 6 names + `et al. (+N)` suffix to keep rows scannable. The `work` detail returns up to 50 names so you can dump full author lists.
- **`published`** prefers `published-print` → `published-online` → `issued` → `created`, returning the first non-empty date as `YYYY[-MM[-DD]]`.
- **`type`** distinguishes work kinds (`journal-article`, `book-chapter`, `posted-content` for preprints, `dataset`, etc.). Useful for filtering.
- **`citations`** is `is-referenced-by-count` — how many other Crossref-indexed works cite this DOI. `referenceCount` (only on `work`) is the inverse: how many works *this* one cites.
- **No API key required.** Crossref asks for a polite User-Agent + contact email; the adapter sets one. Anonymous traffic is rate-limited but generous.
- **Errors.** Bad DOI shape / bad limit → `ArgumentError`; unknown DOI → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
