# amazon

## Commands

### bestsellers
- Purpose: Amazon Best Sellers pages for category candidate discovery
- Args:
  - `input`(optional); Best sellers URL or /zgbs path. Omit to use the root Best Sellers page.
  - `limit`(optional; type: int; default: 100); Maximum number of ranked items to return (default 100)
- Usage: `opencli amazon bestsellers [options] -f json`

### discussion
- Purpose: Amazon review summary and sample customer discussion from product review pages
- Args:
  - `input`(required); ASIN or product URL, for example B0FJS72893
  - `limit`(optional; type: int; default: 10); Maximum number of review samples to return (default 10)
- Usage: `opencli amazon discussion [options] -f json`

### offer
- Purpose: Amazon seller, buy box, and fulfillment facts from the product page
- Args:
  - `input`(required); ASIN or product URL, for example B0FJS72893
- Usage: `opencli amazon offer [options] -f json`

### product
- Purpose: Amazon product page facts for candidate validation
- Args:
  - `input`(required); ASIN or product URL, for example B0FJS72893
- Usage: `opencli amazon product [options] -f json`

### search
- Purpose: Amazon search results for product discovery and coarse filtering
- Args:
  - `query`(required); Search query, for example "desk shelf organizer"
  - `limit`(optional; type: int; default: 20); Maximum number of results to return (default 20)
- Usage: `opencli amazon search [options] -f json`
