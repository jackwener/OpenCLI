# Summarize captured network traffic

`browser network --summary` groups captured requests so you can find frequently
called APIs, failed requests, and large responses without inspecting every body.
It uses the existing Browser Bridge capture and session cache. It does not issue
API requests or start a separate capture mechanism.

```bash
opencli browser network --session research --summary
opencli browser network --session research --summary --sort failures
opencli browser network --session research --summary --group-by origin --sort size
opencli browser network --session research --summary --since 2m --failed
opencli browser network --session research --summary --filter items,title
```

## Grouping and pagination

The default `--group-by endpoint` joins requests by exact HTTP method, URL origin,
and pathname. Query values and fragments do not split groups. Methods are
normalized to uppercase; schemes, ports, different paths, and trailing slashes
remain distinct. Dynamic IDs in paths are not guessed into route templates.
GraphQL calls sharing an endpoint are grouped together; operation names inside
request bodies are not inspected. Operations encoded in distinct URL paths stay
separate.

`--group-by origin` combines all methods and paths for each origin and reports
method counts. Invalid and non-HTTP URLs go into unknown-origin groups; their raw
URLs and fallback keys are omitted. `diagnostics` reports invalid URLs and missing
or malformed methods. These entries still contribute to totals.

| Option | Behavior |
| --- | --- |
| `--sort requests` | Most requests first (default) |
| `--sort failures` | Most failed/no-response captures first |
| `--sort size` | Largest recorded response-character total first |
| `--sort recent` | Most recently observed group first |
| `--limit <n>` | Return 1–500 groups (default 20) |
| `--offset <n>` | Skip a non-negative number of groups (default 0) |

Unknown sort measurements appear last; ties are broken by group identity.
`summary.pagination` includes `total_groups`, `offset`, `limit`, and `next_offset`
(`null` when finished). Totals cover **all matching requests**, including groups
outside the page. An offset beyond the final group returns an empty group list
with unchanged totals. A new live capture may change group ordering; paginate a
stable cached batch when consistent pages are needed.

```bash
opencli browser network --session research --summary --sort requests --limit 10
opencli browser network --session research --summary --sort requests --limit 10 --offset 10
```

## Metrics and limits of the evidence

The JSON success envelope contains `data.summary` with `schema_version: 1`,
`group_by`, `sort`, `totals`, `diagnostics`, `pagination`, and `groups`. Summary mode
omits the normal per-request `entries` array. Each group contains its identity,
the same metrics as totals, method/content-type counts, and up to three
`example_keys` for subsequent detail lookups.

- `requests` counts captured entries. Identical repeated requests are counted
  separately; cache fallback is not added to a non-empty live batch.
- `statuses` separates informational (1xx), success (2xx), redirect (3xx), client
  error (4xx), server error (5xx), `no_response` (status 0), and `unknown`.
  `status_codes` includes counts for each recorded valid status.
- `failed` matches the existing `--failed` convention for valid statuses: 4xx,
  5xx, and status 0. Status 0 means no HTTP response status was recorded; it is not
  proof of a transport failure. `failure_rate` is a fraction from 0 to 1 over
  entries with known statuses (including 0); it is `null` when none are known.
  HTTP success is not proof of application-level success.
- `response_size` describes decoded response **characters**, as recorded by the
  capture protocol, not wire bytes, compressed bytes, or bandwidth. It includes
  `total`, `min`, `max`, `mean`, measurement coverage, and an `overflow` flag.
  Missing/invalid measurements stay unknown; measured zero remains zero.
  An unsafe integer sum produces `null` total/mean rather than a rounded total.
- `truncated_bodies` counts captures whose stored preview was truncated. Recorded
  `body_full_size` takes precedence over preview size when available. Sizes are
  not inferred by serializing response objects.
- `observed` reports first/last timestamps, their span, and timestamp coverage.
  These are observation timestamps, including capture-layer fallbacks. The span
  is not request latency; capture metadata does not provide reliable per-request
  duration measurements.

These statistics describe the selected capture batch, not all traffic ever sent
by a site. The existing capture buffer is bounded and may exclude or truncate
traffic. There is no claim of complete site coverage.

## Filters, cache, and detail lookup

`--all`, `--since`, `--until`, `--failed`, and `--filter` compose with summary mode.
They select requests **before** aggregation; grouping pagination never changes
the selection. The default MIME/static-resource filtering remains in effect, so
use `--all` to include static resources. `--filter` still checks response shapes;
without it, the summary aggregator does not inspect request or response bodies.

The existing cache behavior is preserved: a non-empty live capture saves its
time/failure-selected raw batch before MIME and shape display filters. When the
live buffer is empty, a fresh cache is reused with the same filters. `--ttl`
controls cache freshness. Summary mode reports `capture_source` as `live`, `cache`,
or `empty`, and includes `cache_saved_at` when reusing the cache. `captured_at` is
the report creation time; it is not the original cached capture time.

Cache write failures retain the summary and include `cache_warning`. Grouping,
sorting, and pagination do not rewrite cache keys or evict hidden entries:

```bash
# Copy one of the returned group's example_keys:
opencli browser network --session research --detail 'GET api.example.com/items#2'
```

Cache files remain scoped to the selected browser profile and session.
`--summary` cannot be combined with `--raw`, `--detail`, `--static`, or `--follow`.
`--group-by`, `--sort`, `--limit`, and `--offset` require `--summary`. Invalid summary
options return an `ARGUMENT` error (exit 2) before draining the live buffer.
Normal browser/session setup still applies.

## Data included in summaries

Summaries contain endpoint paths, methods, origins, content-type labels, valid
cache keys, timestamps, and aggregate counts. They omit URL userinfo, query values,
fragments, headers, and request/response bodies. Paths and operation names are
metadata and are not anonymized; review them before sharing. Normal capture cache
and `--detail` retain their existing body-handling behavior.
