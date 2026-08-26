# Deep Recon: evidence-first discovery for undocumented sites

Use this when a site has no documented API, the DOM is lossy, a command needs more than one page, writes are requested, or bundle/network/UI evidence conflicts. The goal is the smallest reproducible contract—not the largest endpoint inventory and not a demo that only works once.

## 1. Freeze the command surface and mutation boundary

Before browsing, make an intent matrix:

| Command | User intent | Read/write | Completeness | Exact target | Allowed live action |
|---|---|---|---|---|---|
| `search` | find matching entities | read | exact limit or upstream exhaustion | query | safe replay after proof |
| `send` | create external side effect | write | one confirmed mutation | recipient + content | only with explicit authorization |

Group aliases that share one proven query primitive; do not create many commands by cloning scripts. A “rich” CLI is broad in verified user goals, not broad in unproven endpoints.

Write the mutation boundary in one sentence. Passive observation and clearly read-only actions are normally safe. Any send/delete/publish/follow/payment action needs explicit authorization that names the target and permitted count. Authorization to observe one write is not authorization to replay it repeatedly.

## 2. Build an evidence ledger, not a traffic dump

Track one row per candidate:

| Intent | Visible action | Source | Method/path | Effect | Auth/signing | Response shape | Replay result | Decision |
|---|---|---|---|---|---|---|---|---|---|

`Source` is one of `dynamic`, `state`, `bundle`, or `memory`. `Effect` is `read`, `write`, or `uncertain`; HTTP method does not decide it. `Decision` is `chosen`, `rejected`, or `blocked`, with the exact reason and lift condition.

Never paste credentials or response bodies into the ledger. Store structural facts: status, content type, arity/paths, row counts, cursor behavior, and source location.

## 3. Triangulate three evidence planes

1. **Visible truth**: page rows, counts, URLs, identity, and semantic controls.
2. **Dynamic truth**: DevTools requests caused by one controlled action.
3. **Static candidates**: loaded bundles scanned manually or with syntax-aware tools such as jsluice.

Dynamic evidence proves that a request occurred. Static scanning expands recall to lazy pagination, detail, search, and routes that this session did not trigger. Neither alone proves a production contract.

Do not equate “structured” with JSON. React Server Components (`text/x-component`), streamed HTML fragments, protobuf-like payloads, and positional arrays may carry the authoritative data. Preserve their content type, request context, truncation state, and structural shape even when the default network view would normally hide them.

jsluice is optional and stays outside adapter runtime. Feed it script text through stdin, keep source locations, and treat `EXPR` as unknown. Do not persist suspected secret values. A candidate becomes useful only after dynamic occurrence or a safe replay verifies its shape and semantics.

## 4. Attribute requests with causal diffs

For each intent:

1. establish a network/state baseline;
2. perform exactly one visible action;
3. inspect only newly added requests/state;
4. repeat with one changed input;
5. run a negative control when ambiguity remains.

The changed-input run should reveal which field controls query, filter, cursor, or target identity. If several requests arrive, do not select the largest response or last URL by guess—compare payload identity against visible results.

For writes, the user performs or authorizes exactly one natural action. Capture before and after state, confirmation UI, and any request/response pair. Do not auto-replay the captured write during discovery or tests.

## 5. Rank candidates before decoding

Prefer a candidate that:

- contains the user-visible target data or mutation identity;
- works across two inputs without copying ephemeral values;
- has a safe, explainable auth source;
- paginates to the requested completeness;
- returns typed, distinguishable auth/HTTP/upstream failures;
- is cheaper to maintain than the strongest UI/DOM alternative.

Penalize opaque signatures, rotating query IDs, positional writes, one-time tokens, page-only controllers, responses unrelated to the visible action, and candidates whose only evidence is a bundle string.

## 6. Pass the contract gate

A read contract must prove all of these:

1. **Occurrence**: the page naturally sends it, or it is documented/public.
2. **Reproducibility**: a safe replay works across two non-empty inputs; if replay is impossible, `INTERCEPT` preserves the page-owned request.
3. **Identity**: returned rows match visible target identity, not adjacent recommendations/ads/sidebars.
4. **Completeness**: pagination reaches exact limit or proven upstream exhaustion.
5. **Auth boundary**: cookies/CSRF/origin/runtime requirements are explicit and do not leak secrets.
6. **Failure semantics**: auth, HTTP, malformed/truncated body, repeated cursor/page, timeout, and partial data fail typed.

Replay the complete request contract, not a URL-shaped fragment. A captured URL returning 4xx/5xx does not reject the underlying endpoint when headers, body, cookies, runtime action identifiers, or page-owned signing were omitted. Record the missing context and use `INTERCEPT` until it can be reproduced safely; never guess absent request fields from a bundle string.

A direct API-backed write contract additionally must prove:

1. target identity is deterministically bound in the request;
2. auth/CSRF/signing can be reproduced without fabricating or exfiltrating runtime secrets;
3. idempotency or duplicate-risk semantics are known;
4. pre-write failure is distinguishable from post-write uncertainty;
5. success is verified independently of the edited control/request echo;
6. retries are disabled after an uncertain write unless the user first checks state.

“The browser sent it once” is not enough. A page-generated one-time anti-abuse token, an opaque positional write, or a controller method that clicks/dispatches UI means there is no direct URL/API contract yet. If the requested surface requires direct API and this gate fails, do not substitute UI automation: record the blocker and lift condition (for example, official OAuth scopes).

## 7. Handle capture, pagination, and cache explicitly

Browser capture queues may be destructive drains. Before relying on them:

- install capture before the action and drain stale entries;
- cache the raw selected capture before applying display-only MIME, static-resource, or shape filters;
- allow in-flight responses to settle;
- treat bodyless or truncated relevant entries as possible data loss;
- inspect non-JSON structured streams with request method, safely redacted headers, body shape, and size/truncation metadata;
- merge all relevant completed responses in the action window;
- identify pages/cursors by content, not arrival order alone;
- deduplicate by stable entity ID;
- reject repeated pages/cursors and page-cap exhaustion rather than return accumulated partial rows.

Never copy authorization, cookies, CSRF/XSRF values, API keys, session identifiers, or token-bearing request bodies into output, ledgers, fixtures, or site memory. Redact keyed values; if a positional or opaque body cannot be sanitized confidently, preserve only its kind, shape, full size, and truncation/omission state.

A cached page may render without a fresh request. A DOM fallback is valid only when it is strictly scoped to the target container, preserves the public columns, and can distinguish empty state from structure drift. Do not silently switch to a weaker page-wide selector.

## 8. Choose strategy per command

Use the repository strategy ladder after the contract gate. One site may legitimately mix strategies:

- `PUBLIC_API` / `COOKIE_API` for reproducible contracts;
- `PAGE_FETCH` for a verified same-origin read contract that must execute in page context;
- `DOM_STATE` for stable hydration or cached state;
- `INTERCEPT` when page-owned signing is unavoidable for reads;
- `UI_SELECTOR` for user-visible writes only when that surface is allowed and safer;
- no command when the requested contract cannot be proved.

Preserve page-owned auth/signing rather than reimplementing adversarial logic. “API-first” means prefer a verified structured contract for completeness and maintainability; it does not mean force every command onto an internal endpoint.

## 9. Decode and test against invariants

For positional payloads, freeze only verified indexes, assert outer arity and required identifiers, and fail typed on drift. For object payloads, validate the minimum required keys and distinguish legitimate null from missing/malformed.

Validation set:

- two non-empty inputs plus one true empty result;
- more than one page when pagination exists;
- exact limit and upstream exhaustion;
- cache/repeat behavior;
- auth, HTTP, JSON/shape, truncated/bodyless capture, timeout, repeated cursor/page, and page cap;
- every public column and target identity.

Tests must exercise the production navigation/capture/fetch path, not only a parser helper. Use sanitized synthetic fixtures; high-sensitivity live responses never enter the repository. When fixing a silent bug, reverse-validate that the new regression test fails against the old implementation.

## 10. Deliver a clean, reviewable artifact set

Leave durable outputs at the right layer:

- **adapter**: executable contract, shared helpers, typed errors;
- **tests**: production-path behavior and structural invariants;
- **docs**: command surface, limits, auth, uncertainty, examples;
- **site memory/sitemap**: verified routes, triggers, fallbacks, rejected strategies, pitfalls, and verification date;
- **recon conclusion**: evidence ledger without secrets or private bodies.

Before PR:

1. regenerate manifest and validate the site;
2. run focused/site tests, typecheck, build, docs coverage, typed-error and silent-column gates;
3. scan the diff for live addresses, account IDs, tokens, message IDs, bodies, attachments, raw captures, and temporary dumps;
4. delete raw capture/cache artifacts and release browser sessions;
5. obtain independent exact-head review for writes, auth/signing, positional schemas, or no-partial pagination.

Record rejected approaches with a concrete lift condition. A well-proven “no safe command yet” is a successful Deep Recon outcome; it prevents the next author from repeating unsafe dead ends.
