## Context

OpenCLI already supports browser-backed adapters that run against a user's Chrome session. Threads search is different from public HTTP adapters because the useful search surface depends on the logged-in web UI and internal web responses, while the official keyword search API requires permissions that this change explicitly avoids.

The source design in `designs/threads-login-search-adapter.md` treats `www.threads.com` as the primary domain, with `threads.net` only as a legacy redirect source to observe during recon. The adapter must only expose content the user can already view in the normal Threads UI.

## Goals / Non-Goals

**Goals:**
- Provide `opencli threads search <query>` with bounded result collection.
- Use the logged-in Chrome session through OpenCLI's browser bridge.
- Prefer reusable JSON or GraphQL-style web responses captured from Threads over DOM scraping.
- Normalize search results into stable agent-readable rows.
- Fail clearly when login, checkpoint, throttling, endpoint, timeout, or response-shape assumptions do not hold.

**Non-Goals:**
- Do not use `https://graph.threads.net/keyword_search`.
- Do not automate login or bypass checkpoints, CAPTCHA, permissions, or private-content boundaries.
- Do not implement high-volume crawling, deep pagination, or archival collection in the first version.
- Do not merge profile search and post search unless the observed endpoint naturally returns both and the fields are clearly separated.

## Decisions

1. Use `Strategy.INTERCEPT` for the first implementation unless recon proves a simpler cookie-backed fetch is stable.

   Rationale: Threads web search is likely backed by dynamic headers, tokens, GraphQL payloads, or Relay responses. Intercepting the live web app gives the adapter better evidence before replaying a request. Alternative considered: `Strategy.COOKIE` with a direct `page.evaluate(fetch(...))`; this remains acceptable if recon verifies ordinary cookies and stable headers are sufficient.

2. Implement a narrow post-search command before pagination or profile search.

   Rationale: The first adapter needs to be repairable when Threads changes. A small command surface with `query` and `limit` reduces ambiguity and avoids adding cursor semantics before the endpoint contract is known. Alternative considered: add `tab`, `cursor`, and `raw` immediately; those are deferred until field discovery confirms they are useful.

3. Normalize only fields that can be decoded from observed data.

   Rationale: Agents need stable columns, but fabricated or guessed metrics are worse than missing data. The minimum acceptable output is `rank`, `username`, `text`, `timestamp`, and `url`; engagement counts are nullable when absent or unreliable. Alternative considered: scrape visible counts from DOM as a fallback; this is too brittle for the initial JSON-first path.

4. Treat live recon as a required implementation step.

   Rationale: Internal Threads endpoints and response shapes are not stable public contracts. Before final adapter code is committed, the endpoint, request parameters, required headers, response format, and field mapping must be validated against visible UI results for at least two queries.

## Risks / Trade-offs

- Threads login is missing or checkpointed -> report an auth/checkpoint error and stop; the adapter must not automate login.
- Threads changes internal endpoints or field names -> keep normalization isolated and return response-shape errors with enough context to repair.
- JSON response contains mixed result types -> include post rows only unless profile rows are explicitly modeled later.
- Counts or timestamps are absent or encoded unexpectedly -> return `null` rather than inventing values.
- Live recon cannot be performed in CI -> cover pure input validation and normalization helpers with fixture-driven tests; verify the full adapter manually with `opencli browser verify`.
