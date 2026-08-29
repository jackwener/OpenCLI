# gmail

## Domain and auth

- Desktop UI: `mail.google.com/mail/u/<account>/`.
- Requires Google session cookies and a signed-in Gmail surface.
- The official Gmail API requires separate OAuth; browser cookies are not an official API credential.

## Verified read paths

- `POST /sync/u/<account>/i/bv`: natural search/list response. Positional array, arity 19. Labels may appear at `[1]`, threads at `[2]`, counts at `[6]`.
- `POST /sync/u/<account>/i/fd`: natural thread/message detail response. Cached threads may render without a fresh request.
- `POST /sync/u/<account>/i/s`: incremental synchronization; not needed by the initial adapter.
- Legacy `POST /mail/u/<account>/?ui=2` still appears during bootstrap. Do not assume a single transport variant.

## Positional fields verified in 2026-08

- Thread: subject `[0]`, snippet `[1]`, timestamp `[2]`, sync id `[3]`, summaries `[4]`.
- Summary: sender card `[1]`, label ids `[10]`.
- FD thread: id `[0]`, message wrappers `[2]`; wrapper is `[messageId, record]`.
- Message: to `[0]`, cc `[1]`, subject `[4]`, body `[5]`, snippet `[6]`, sender `[10]`, attachments `[13]`, date `[16]`, legacy id `[34]`.
- Sender: display name `[14]`, address `[16]`.
- Attachment node: id `[1]`, data `[3]`; data contains name `[2]`, MIME `[3]`, size `[4]`.

## Strategy

- Reads: `INTERCEPT`. Let Gmail submit the visible search/open action, then parse the natural `bv/fd` response. Never reconstruct private XSRF/BTAI request bodies.
- Cached thread fallback: rendered message containers (`data-message-id`, `.a3s`, scoped attachment cards).
- Writes: no supported browser-session API contract is currently available. Gmail's private `/sync` operations require page-runtime state, and the official Gmail API requires separate OAuth credentials and scopes.

## Durable pitfalls

1. Synthetic `.value` + synthetic key events do not reliably submit Gmail search. Use native insertion and raw CDP Enter; verify the exact field value before submission.
2. `thread-f:<decimal>` converts to legacy hex with `BigInt(decimal).toString(16)`; never use Number.
3. `bv` search responses may omit label definitions. The complete visible fallback is `#settings/labels`.
4. A new `/fd` response is not guaranteed for cached messages. Treat rendered content as a legitimate visible-ui fallback.
5. Responses are anti-XSSI-prefixed positional arrays. Enforce arity/required-field guards and fail typed on drift.
6. Network capture is a destructive drain; a relevant bodyless/truncated entry means possible data loss, not an empty/short page.
7. Never store live subjects, addresses, message bodies, attachment names, cookies, or account-specific ids in fixtures/site memory.
8. Do not replay legacy `?ui=2` write actions or fabricate `/sync` write payloads. Current send commits include a page-generated WAA anti-abuse token; supported API-backed writes require Google OAuth.
