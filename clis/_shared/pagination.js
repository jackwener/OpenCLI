/**
 * Pagination constants shared by paginated adapters (10jqka news-flash, 51job,
 * jianyu, ...). Each upstream endpoint accepts a configurable page_size but
 * the value that produces the densest first-hop return without re-paginating
 * for typical --limit values varies. The constants here give a single source
 * of truth so future adapters don't drift.
 */

export const PAGE_SIZE = 50;

// Number of pages to fetch in parallel on the first round-trip when a
// --market filter is in play or --limit exceeds a single page. Capped at 3
// because the typical matches-to-page ratio makes >3 hops rare; adjust per
// endpoint empirically.
export const PAGE_PARALLEL_HOPS = 3;
