## 1. Recon

- [x] 1.1 Run `opencli doctor` and confirm the browser bridge is healthy.
- [x] 1.2 Check existing Threads site memory and adapter references for reusable endpoint or field information.
- [x] 1.3 Confirm the user is logged in at `https://www.threads.com/` and no checkpoint, CAPTCHA, or login wall blocks normal UI access.
- [x] 1.4 Run Threads search UI recon for at least two queries and capture the candidate structured response endpoint, method, parameters, headers, pagination signals, and result shape.
- [x] 1.5 Verify the candidate endpoint or intercepted response against visible UI values for one known result.

## 2. Adapter Implementation

- [x] 2.1 Scaffold or add the `threads/search` adapter with `query` and bounded `limit` inputs.
- [x] 2.2 Implement browser-backed search using the verified Threads web response path without calling `graph.threads.net/keyword_search`.
- [x] 2.3 Normalize post rows to stable output columns, returning nullable optional metrics when unavailable.
- [x] 2.4 Add typed handling for validation, unauthenticated session, checkpoint/CAPTCHA, rate limit, timeout, empty results, and response-shape failures.

## 3. Verification

- [x] 3.1 Add focused fixture/unit coverage for validation and normalization helpers where live Threads access is not required.
- [x] 3.2 Run `opencli browser verify threads/search` with live browser access and compare at least one row against the visible Threads UI.
- [x] 3.3 Record verified endpoint and field notes in Threads site memory after live verification succeeds.
- [x] 3.4 Run focused tests and build/manifest checks needed for the touched adapter files.
