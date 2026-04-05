# Pull Request: Add PubMed Adapter

## Summary

This PR adds comprehensive PubMed academic literature search capabilities to OpenCLI, enabling researchers and clinicians to access the PubMed database directly from the command line.

## Features

### New Commands (6 total)

| Command | Description |
|---------|-------------|
| `pubmed search` | Advanced article search with multiple filters |
| `pubmed article` | Detailed article metadata retrieval |
| `pubmed author` | Search by author name and affiliation |
| `pubmed citations` | Get citation relationships |
| `pubmed related` | Find semantically similar articles |
| `pubmed config` | Configure API key for higher rate limits |

### Key Capabilities

- **Advanced Search Filters**: date range, author, journal, article type, abstract availability, free full text, human studies, language
- **Complete Author Information**: first author, corresponding author, all authors, affiliations
- **Publication Metadata**: title, abstract, journal, volume, issue, pages, publication date
- **Academic Identifiers**: PMID, DOI, PMC ID
- **Classification**: MeSH terms, keywords, article type
- **Citation Analysis**: find articles that cite a given article or articles cited by it
- **Related Articles**: discover semantically similar articles using PubMed's algorithm

## API Integration

Uses NCBI E-utilities APIs:
- **ESearch**: Search for articles and retrieve PMIDs
- **ESummary**: Get summary information for PMIDs
- **EFetch**: Retrieve full article details including abstracts
- **ELink**: Get citation relationships and related articles

## Technical Implementation

- **Language**: TypeScript with full type safety
- **Strategy**: `Strategy.PUBLIC` (PubMed E-utilities is a public API)
- **Rate Limiting**: Automatic delays to respect NCBI limits (3 req/s public, 10 req/s with API key)
- **Error Handling**: Consistent use of `CliError` for all error cases
- **Code Quality**: Follows existing OpenCLI patterns (similar to arXiv adapter)

## Files Added

```
clis/pubmed/
├── utils.ts      # Shared utilities for API calls and data parsing
├── search.ts     # Article search with advanced filters
├── article.ts    # Detailed article information
├── author.ts     # Author-based search
├── citations.ts  # Citation relationships
├── related.ts    # Related articles discovery
└── config.ts     # API key configuration for higher rate limits
```

## Usage Examples

```bash
# Search with filters
opencli pubmed search "machine learning cancer" --year-from 2023 --has-abstract

# Get article details
opencli pubmed article 37780221 --format json

# Search by author
opencli pubmed author "Smith J" --affiliation "Stanford" --position first

# Citation analysis
opencli pubmed citations 37780221 --direction citedby --limit 50

# Find related articles
opencli pubmed related 37780221 --score

# Configure API key for higher rate limits (10 req/s vs 3 req/s)
opencli pubmed config set --key api-key --value YOUR_NCBI_API_KEY

# View current configuration
opencli pubmed config get

# Remove API key
opencli pubmed config remove --key api-key
```

## Testing

- [x] Built successfully with `npm run build`
- [x] Manifest compiled: 260 entries (121 YAML, 139 TS)
- [x] All TypeScript files compile without errors
- [ ] Runtime testing (requires NCBI API access)

## Documentation

A comprehensive README is available in the contribution package with:
- Installation instructions
- Detailed usage examples
- API reference
- Rate limit information
- File structure explanation

## Rate Limits & API Key Configuration

The adapter implements automatic rate limiting:
- **Without API key**: 350ms delay between requests (≈3 req/s)
- **With API key**: 100ms delay between requests (≈10 req/s)

### Getting an API Key

1. Create an NCBI account at https://www.ncbi.nlm.nih.gov/account/
2. Go to https://www.ncbi.nlm.nih.gov/account/settings/
3. Generate an API key

### Configuring Your API Key

```bash
# Set your API key
opencli pubmed config set --key api-key --value YOUR_API_KEY

# Set your email (recommended for identification)
opencli pubmed config set --key email --value your@email.com

# View current configuration
opencli pubmed config get

# Remove configuration
opencli pubmed config remove --key api-key
```

Configuration is stored in `~/.opencli/pubmed-config.json`.

### Environment Variables

Alternatively, you can use environment variables:
- `NCBI_API_KEY` - Your NCBI API key
- `NCBI_EMAIL` - Your email address

## Backwards Compatibility

This is a new adapter with no impact on existing functionality.

## Checklist

- [x] Code follows OpenCLI conventions
- [x] TypeScript types are properly defined
- [x] Error handling uses CliError
- [x] Rate limiting is implemented
- [x] Build passes successfully
- [x] No breaking changes to existing code

## Author

**GreatKai** working with WorkBuddy - Building tools to help researchers access scientific literature more efficiently.

## References

- [NCBI E-utilities Documentation](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
- [PubMed](https://pubmed.ncbi.nlm.nih.gov/)

---

**Related Issue**: N/A (new feature)

**Breaking Changes**: None

**Dependencies**: None (uses native fetch API)
