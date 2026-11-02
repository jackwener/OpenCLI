# Paginated pipeline requests

The `paginate` step collects JSON API pages through the same Node or browser
transport as `fetch`. It supports cursor, page-number, and offset APIs using a
`next` expression, with sequential requests, optional pacing, row deduplication,
and explicit completion information.

Use it for **read endpoints**, including POST-based search/GraphQL queries. It is
not a batch-write step. Existing `fetch` pipelines keep their current behavior.

## Cursor API example

```typescript
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'mysite',
  name: 'catalog',
  description: 'Collect catalog pages with completion metadata',
  access: 'read',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'limit', type: 'int', default: 100, help: 'Maximum unique items' }],
  pipeline: [{
    paginate: {
      request: {
        url: 'https://example.com/api/catalog',
        params: { cursor: '${{ pagination.value }}', page_size: 50 },
      },
      initial: '',
      items: '${{ data.results }}',
      next: '${{ data.next_cursor ?? null }}',
      maxPages: 10,
      maxItems: '${{ args.limit }}',
      dedupeBy: '${{ item.id }}',
      delayMs: 200,
    },
  }],
});
```

The result is an object with `items` and `pagination`. Default CLI JSON output
wraps it in the normal `{ "ok": true, "data": ... }` envelope. `ok` describes
successful command execution; inspect `data.pagination.complete` for coverage.

```json
{
  "items": [{ "id": 1 }, { "id": 2 }],
  "pagination": {
    "pages": 1,
    "fetchedItems": 3,
    "returnedItems": 2,
    "duplicateItems": 0,
    "skippedItems": 0,
    "complete": false,
    "stopReason": "max_items",
    "resume": { "value": "", "skip": 2 }
  }
}
```

## Options and expression context

| Option | Meaning |
| --- | --- |
| `request` | Required single-request object: `url`, optional `method`, `headers`, query `params`, JSON `body`. Only GET and POST; GET cannot have a body. |
| `items` | Required expression returning the current response's row array. Use `${{ data }}` for a top-level array. |
| `next` | Required expression returning the next request value, or an explicit terminal value. |
| `initial` | First request value, default `null`; may be a template. |
| `skip` | Raw rows to skip on the first fetched page, default 0; used with a checkpoint. |
| `maxPages` | Maximum requests: 1–1000, default 10. |
| `maxItems` | Maximum collected rows after deduplication: 1–100000, default 10000. |
| `delayMs` | Delay between requests: 0–60000 ms, default 0. No delay before the first request or after the last. |
| `dedupeBy` | Optional expression returning a string, safe integer, or boolean identity for each row. First occurrence wins. |
| `requireComplete` | Boolean, default false. Throw `PAGINATION_LIMIT` instead of returning a bounded partial result. |

The numeric bounds accept numbers, decimal integer strings, or templates that
resolve to either. Unknown options, batching options such as `forEach`, invalid
bounds, and invalid configuration shapes fail before sending a request.

Request templates have `args`, the preceding pipeline `data`, and
`pagination.value` / `pagination.page` (one-based request number in this run).
In `items`, `next`, and `dedupeBy`, `data` is the current response and `root` is
the preceding pipeline input. `dedupeBy` also receives `item` and its raw page
`index`. None of these bindings modify the caller's args or preceding input.

JSON body rendering and content-type handling match `fetch`. A cursor returned
by the server is treated as data, even if it contains template-looking text.
`paginate` does not change browser routing: use the usual `browser`/`strategy`
metadata and domain navigation for authenticated requests.

## Page numbers and offsets

For page numbers, initialize at 1 and derive the next page from response metadata:

```typescript
{
  paginate: {
    request: { url: 'https://example.com/items', params: { page: '${{ pagination.value }}' } },
    initial: 1,
    items: '${{ data.items }}',
    next: '${{ pagination.value < data.total_pages ? pagination.value + 1 : null }}',
    maxPages: 20,
  },
}
```

For an offset API, initialize at 0 and use the documented page size:

```typescript
{
  paginate: {
    request: {
      url: 'https://example.com/items',
      params: { offset: '${{ pagination.value }}', limit: '${{ args.pageSize }}' },
    },
    initial: 0,
    items: '${{ data.items }}',
    next: '${{ data.items.length === args.pageSize ? pagination.value + args.pageSize : null }}',
  },
}
```

The adapter author owns the API-specific completion rule. Only `null`, `false`,
or an empty string from `next` means exhaustion; numeric zero is a real cursor.
Empty or duplicate-only pages do not stop pagination while a cursor advances.
A missing cursor (`undefined`) is an error rather than silent completion; use
`?? null` only when the API documents omission as its terminal signal.

## Bounds, checkpoints, and completeness

`complete: true` / `stopReason: 'exhausted'` means the configured `next` rule
reported exhaustion and all rows from the fetched final page were consumed.
`max_pages` and `max_items` mean bounded partial results. A final page that
exactly fills a bound still reports complete when there is no next cursor.
Trailing duplicates on an already fetched page are consumed even at the unique
item cap, so they do not incorrectly turn a complete result into a partial one.

For another run, set `initial` to `pagination.resume.value` and `skip` to
`pagination.resume.skip`. At page boundaries this points to the next cursor
with skip 0. If a row cap cuts a page in the middle, it points to the same
cursor and the number of raw rows already consumed, including duplicates.
Replaying that page avoids dropping its remaining rows. A skip beyond the
replayed page's length throws `PAGINATION_RESUME`.

Checkpoints assume stable server ordering and valid cursors; offset-based APIs
can shift while data changes. Deduplication is scoped to one invocation and is
not persisted in a checkpoint, so callers joining separate runs should also
deduplicate their combined output. `fetchedItems` counts all rows received,
including skipped and unconsumed rows; `duplicateItems` counts duplicates among
processed rows. Bounds limit requests and retained rows, not response size or
the duration of an individual transport request.

To produce just a row array, append `{ select: 'items' }` or use `map` with
`select: 'items'`. This intentionally discards the report metadata; set
`requireComplete: true` if the command must never output a partial list.

HTTP, network, browser, and JSON errors propagate instead of returning partial
success. Non-array item selectors and invalid dedupe/next values throw
`PAGINATION_RESPONSE`. Repeated request values throw `PAGINATION_CYCLE` before
another request to that value; cursor values are not included in that error.
Pagination does not add automatic retries.
