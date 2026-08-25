# Deep Recon: efficient API-first adapter discovery

Use this when a site has no documented API, the DOM is lossy, or bundle/network evidence conflicts. The goal is the smallest reliable contract, not the largest endpoint inventory.

## 1. Start from intents and risk

Write an intent matrix before browsing: command, read/write, required completeness, mutation risk, and expected output. Freeze a mutation boundary: passive observation and read actions are allowed; writes need explicit authorization and are never replayed automatically.

## 2. Triangulate three evidence planes

1. **Visible truth**: page rows, counts, URLs, and semantic controls.
2. **Dynamic truth**: DevTools requests caused by one controlled action.
3. **Static candidates**: loaded bundles scanned with syntax-aware tools such as jsluice.

Dynamic evidence proves occurrence; static scanning expands recall. A bundle hit is never an endpoint contract until a real action or safe replay verifies it.

## 3. Use causal diffs, not traffic dumps

Capture a baseline, perform exactly one action, then diff new requests. Repeat with a negative control and one changed input. This attributes request → action and exposes which request fields control query, cursor, filter, or target.

Classify by effect, not HTTP method: POST may be a read query and GET may mutate. Never auto-replay a request whose effect is uncertain.

## 4. Rank candidates before decoding

Prefer candidates that contain the user-visible data, paginate completely, reuse a safe auth source, and remain stable across two inputs. Penalize signatures copied from minified runtime, opaque write semantics, and data already available through a stronger public or visible-UI contract.

## 5. Choose a contract per command

Use the strategy ladder independently for each command. A site may legitimately mix `INTERCEPT` reads, `DOM_STATE` cached fallback, and `UI_SELECTOR` writes. Do not force one site-wide transport.

For positional payloads, freeze only verified indexes, assert outer arity and required identifiers, and fail typed on drift. Preserve the natural site request whenever recreating auth/signing would duplicate fragile runtime logic.

## 6. Validate with invariants

Use two non-empty inputs plus one empty result. Compare API count/identity against the visible page, exercise pagination past one page, and test cache/repeat behavior. Verify exact limits, deduplication, timestamps, auth failures, malformed/truncated payloads, and no-partial behavior.

Tests must execute the production capture/navigation path with sanitized synthetic fixtures. Never commit live user data.

## 7. Leave three durable outputs

- adapter: executable contract and typed errors;
- tests: positional/shape invariants and production-path behavior;
- site knowledge: verified routes, endpoint triggers, fallbacks, pitfalls, and verification date.

Record rejected strategies and lift conditions. That prevents the next author from repeating dead-end reconnaissance.
