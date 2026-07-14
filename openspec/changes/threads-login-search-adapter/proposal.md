## Why

Agents need a way to search Threads content that the user can already view in their logged-in Chrome session, without depending on the official Threads API Keyword Search permission. A browser-backed OpenCLI adapter gives agents structured search results while keeping the scope narrow and tied to normal user-visible access.

## What Changes

- Add a `threads search` OpenCLI command that searches Threads posts by keyword through the logged-in browser session.
- Return normalized result rows with stable fields for rank, author identity, post text, timestamp, permalink, and engagement counts when reliable.
- Prefer captured or replayed Threads web JSON responses over DOM scraping.
- Validate query and limit inputs, with conservative bounds.
- Handle unauthenticated, checkpoint, rate-limit, empty-result, timeout, and response-shape failures with typed errors.
- Do not use the official `graph.threads.net/keyword_search` API or require Meta developer credentials.

## Capabilities

### New Capabilities
- `threads-login-search`: Browser-backed Threads post search using the user's existing web login state.

### Modified Capabilities

## Impact

- Adds a new Threads adapter command under the OpenCLI adapter surface.
- May add or update adapter manifest/build coverage for the new command.
- Adds focused tests for input validation and normalization logic where feasible without live Threads access.
- Requires live recon against `www.threads.com` before finalizing the endpoint strategy.
