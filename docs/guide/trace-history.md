# Inspect saved execution traces

Capture evidence with `--trace on` or `--trace retain-on-failure`, then inspect
saved runs without connecting to a browser:

```bash
opencli trace list --status failure --since 24h
opencli trace show <trace-id> --issues
opencli trace show <trace-id> --stream network --include-data --limit 20
opencli trace list --profile work -f table
```

`trace` uses normal CLI startup. It reads
`$OPENCLI_CONFIG_DIR/profiles/<context>/traces`, falling back to
`~/.opencli/profiles/<context>/traces`. `--profile` selects a stored context ID
or local alias; otherwise `OPENCLI_PROFILE` applies, then all profiles. A saved
browser default does not narrow the query.

`list` filters exact `--site`, `--command`, `--session` and `--status` metadata,
and sorts by export time, newest first. `--since` uses the same relative duration
syntax as `browser network`: `500ms`, `30s`, `2m`, `24h`, decimals, or bare
milliseconds. ISO dates and day/week suffixes are not supported.

`show` selects an exact receipt ID or unique prefix. Use `--profile` to disambiguate
IDs found in multiple profiles. `--stream` accepts `action`, `network`, `console`,
`screenshot`, `state` or `error`. `--issues` selects action errors, console
warnings/errors/assertions, error events, and failed-network evidence using the
same rule as `summary.md`: HTTP 4xx/5xx or no recorded response (missing/zero
status). A missing status does not prove a transport failure.

Both commands accept `--limit` (maximum 1000) and `--offset`; defaults are 20
traces and 100 events. JSON is the default and uses the normal result envelope.
JSON/YAML retain report metadata and diagnostics; table/plain/Markdown/CSV show
rows. Follow `nextOffset` or `selection.nextOffset` for subsequent pages. Event
counts cover the retained observation window, not necessarily the whole run.

Payloads are omitted unless `--include-data` is set and are redacted again on
read. Screenshot bytes and referenced state files stay separate. Inspect reports
before sharing: redaction cannot identify every kind of personal information.
The reader ignores receipt-supplied absolute paths and refuses symlinks.
Unreadable receipts and malformed/oversized records appear in diagnostics;
receipts are capped at 1 MiB, event files at 64 MiB, and event records at 1 MiB.

An empty list succeeds. An invalid option or ambiguous ID exits 2; a missing
trace returns `TRACE_NOT_FOUND`/66; unreadable or oversized event files return
`TRACE_READ` or `TRACE_TOO_LARGE`/1. Reading does not modify trace artifacts or
extend their retention. See `trace list --help -f json` and `trace show --help -f json`
for machine-readable options.
