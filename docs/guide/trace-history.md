# Inspect saved execution traces

OpenCLI can retain execution evidence with `--trace on` or
`--trace retain-on-failure`. Use `trace list` to find saved runs and `trace show`
to inspect their captured events after the browser session has ended.

```bash
opencli bilibili hot --trace on
opencli trace list --status failure --since 7d
opencli trace show <trace-id> --issues
opencli trace show <trace-id> --stream network --limit 10
```

Both commands run offline through a dedicated startup path. They read the store
under `$OPENCLI_CONFIG_DIR/profiles/<context>/traces`, or
`~/.opencli/profiles/<context>/traces` when that variable is unset. This also
supports a copied configuration directory through `OPENCLI_CONFIG_DIR`.

## Find a saved run

```bash
opencli trace list --site bilibili --command bilibili/hot
opencli trace list --session site:bilibili --since 2026-11-01
opencli trace list --limit 10 --offset 10
opencli trace list -f plain
```

`--site`, `--command`, and `--session` match exact recorded metadata. `--status`
accepts `success` or `failure`. `--since` selects export timestamps using an ISO
date or a duration in minutes, hours, days, or weeks, such as `30m`, `24h`, `7d`,
or `2w`.

Results are ordered by export time, newest first, with stable trace/profile
tie-breakers. Pagination applies after filtering. The default limit is 20,
the maximum is 1000, and `nextOffset` is `null` on the final page. The JSON
envelope includes `schemaVersion`, `traces`, `total`, `offset`, `limit`,
`nextOffset`, and discovery diagnostics.

Each row identifies the trace, stored profile, outcome, export timestamp,
retention timestamp, command/session context, and any recorded error. Older
receipts with missing optional fields return `null` for those fields.
`expired` reports whether the advisory retention date has elapsed. Retained
files remain available for inspection until the existing retention policy
removes them.

## Select a stored profile

The default query covers all stored profiles. A saved browser default does not
narrow historical queries. Use `--profile` or `OPENCLI_PROFILE` to select a
stored context ID or a saved local alias. The command-line flag takes precedence
over the environment variable.

```bash
opencli trace list --profile work
opencli --profile work trace show <trace-id>
opencli trace --profile work show <trace-id>
```

Aliases are read from the local `browser-profiles.json`. A disconnected profile
can still be inspected. Output uses the profile directory name, matching the
exporter's normalization of context IDs.

## Inspect captured events

`trace show` accepts a complete trace ID or a unique prefix. Exact IDs take
precedence over longer prefix matches. When an ID appears in more than one
profile, supply `--profile` to resolve the ambiguity.

```bash
opencli trace show <trace-id> --stream action
opencli trace show <trace-id> --issues --offset 0 --limit 20
opencli trace show <trace-id> --include-data -f plain
opencli trace show <trace-id> --help -f json
```

Supported streams are `action`, `network`, `console`, `screenshot`, `state`, and
`error`. `--issues` includes explicit action errors, HTTP responses with status
400–599, captured network status 0, console error/warning/warn/assert entries,
and error events. Missing network status remains unknown.

The report includes a trace header, summary counts across the captured events,
an event page, selection metadata, and read diagnostics. Event rows retain the
source line number and file order. Summary counts and time bounds cover all
valid events before filtering or pagination. The default event-page limit is
100, and the maximum is 1000. Follow `selection.nextOffset` with the same filters
to continue reading.

Trace exports contain a bounded observation window. Counts describe the retained
evidence. A run can contain earlier activity that was evicted before export.
For an export being written concurrently, rerun after its writer finishes to
obtain a complete view. Event reads are bounded to the file size observed when
the file is opened.

## Data and file handling

The default event projection includes action names/phases, network URLs and
status, console/error text, and relative screenshot/state artifact references.
`--include-data` additionally exposes recorded action data, headers, request and
response bodies, inline state snapshots, and error stacks. The existing trace
redactor applies to these fields during inspection, including older exports.
Payload depth, array lengths, object fields, and strings use the existing
redaction bounds. Screenshot bytes and referenced state files stay separate
artifacts.

Console text, error text, URLs, and payloads can still contain personal data
outside the recognized redaction patterns. Review reports before sharing them.
Plain output removes terminal control characters from labels. JSON preserves
escaped strings for machine consumers.

The reader discovers paths from the store directory structure and opens only
regular receipt/event files. Symlinked profile/trace directories and receipts
are skipped. A symlinked event file returns a read error. Receipt-supplied
absolute paths never determine which file is opened. Artifact references are
restricted to relative `screenshots/` and `state/` paths.

Receipts larger than 1 MiB are skipped. Event files larger than 64 MiB return
`TRACE_TOO_LARGE`. Individual event records larger than 1 MiB are skipped with
an `oversizedRecords` diagnostic. Invalid JSON, partial trailing records, and
unsupported event shapes have separate diagnostic counts. An unreadable,
incomplete, or unsupported receipt increments `diagnostics.skipped` in the list
response, allowing the remaining valid traces to be inspected.

## Output and errors

JSON is the default format and uses the standard `{ "ok": true, "data": ... }`
envelope. `-f plain` provides a readable summary. Redirect stdout to save a
report using normal shell redirection. Namespace and command help also support
structured help through `--help -f json`.

| Exit code | Meaning |
| --- | --- |
| 0 | Query completed, including an empty list or event selection |
| 2 | Invalid options or an ambiguous trace selector |
| 66 | No trace matched the selector in the selected profiles |
| 1 | Artifact read failure or event file larger than the inspection limit |

Errors use the standard `{ "ok": false, "error": ... }` envelope. Missing traces
return `TRACE_NOT_FOUND`, read failures return `TRACE_READ`, and oversized event
files return `TRACE_TOO_LARGE`.
