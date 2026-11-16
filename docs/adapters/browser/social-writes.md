# Ordinary-user social writes (Web only)

These tools use the logged-in ordinary-user website, not creator center or mobile APIs. **Implementation and simulated tests are complete; live preflights passed, but no real message, new-author server conversation, follow or unfollow has been exercised against an authorized test recipient.** They are not a verified end-to-end Agent workflow.

## Commands

| Platform | Tool | Default behavior / implementation |
|---|---|---|
| Both | `send <target> <text>` | Read-only preflight; execution requires a separately signed approval |
| Both | `conversation-open <target>` | Preflight; approved execution prepares a native private conversation without sending |
| Both | `write-status <request-id>` | Local execution receipt; no browser and **no server reconciliation** |
| Douyin | `follow <target>`, `unfollow <target>` | Preflight; approved execution clicks the verified native profile control once and re-navigates to verify state |
| Xiaohongshu | `follow <target>`, `unfollow <target>` | **Existing, unchanged write tools; execute immediately. They do not use this signature/lock protocol.** Explicit human authorization is still required |

```bash
# These new commands do not send or change follow state without --execute
opencli xiaohongshu send <user-id-or-profile-url> 'Exact reviewed text' -f json
opencli douyin send <uid-or-conversation-id-or-public-profile-url> 'Exact reviewed text' -f json
opencli xiaohongshu conversation-open <user-id-or-profile-url> -f json
opencli douyin conversation-open <uid-or-public-profile-url> -f json
opencli douyin follow <public-sec_uid-or-profile-url> -f json
opencli douyin unfollow <public-sec_uid-or-profile-url> -f json
```

Xiaohongshu accepts a 24-character hex ID or exact HTTPS `www.xiaohongshu.com/user/profile/<id>` URL. Douyin private writers accept a numeric UID, existing `0:1:…` private conversation ID, public `sec_uid`, or exact HTTPS `www.douyin.com/user/<sec_uid>` URL. A public profile is resolved to its numeric UID with model/URL identity checks. Douyin follow tools accept public `sec_uid`/profile URLs, not private conversation IDs. Nicknames are never recipient identifiers.

Text is literal, not a generated template. Douyin permits at most 2000 JavaScript string characters. Xiaohongshu's observed editor supports at most 1000; leading/trailing whitespace and CR line endings are rejected to avoid native trimming/normalization. Invalid Unicode/control characters and blank text fail before browser operations. Writers do not send attachments.

## Separate operator approval

A preflight returns `status: prepared`, a UUID `request_id`, and `approval_payload`:

```json
{
  "version": 1,
  "site": "douyin",
  "action": "send",
  "account_id": "<exact logged-in UID>",
  "user_id": "<exact recipient UID>",
  "conversation_id": "<existing ID or null>",
  "revision": "<platform conversation position or follow state>",
  "text": "Exact reviewed text",
  "request_id": "<preflight UUID>"
}
```

A trusted **external operator signer**, not the sending Agent, reviews the exact account, recipient, operation, text and context. Keep its Ed25519 private key outside the Agent's access. Install its public PEM at `~/.opencli/social-writes/approval-public.pem` through the trusted operator. The CLI cannot set this trust key through a command flag and does not generate an approval or private key. This is not an OS security boundary: a process able to replace the trust key can replace the authority; use filesystem/access isolation where required.

The approval file is `{ "payload": <reviewed object>, "expires_at": <epoch milliseconds>, "signature": <base64> }`. Sign the UTF-8 bytes of `JSON.stringify({ payload, expires_at })` using Ed25519, with payload keys in the exact preflight order shown above. Expiry must be in the future and at most ten minutes away. Extra/missing payload keys or changed values fail. Do not persist approval files containing personal text in the repository or expose them in traces.

```bash
# Same exact target and text; use the UUID and operator-signed approval
opencli douyin send <target> 'Exact reviewed text' \
  --execute --request-id <preflight-UUID> --approval /operator/approval.json -f json
opencli xiaohongshu conversation-open <target> \
  --execute --request-id <preflight-UUID> --approval /operator/approval.json -f json
opencli douyin follow <target> \
  --execute --request-id <preflight-UUID> --approval /operator/approval.json -f json
```

There is no `approved=true` bypass. Opening a conversation and sending are separately approved actions. A new message advancing the conversation position, account/recipient change, changed text, changed follow state or expired approval invalidates execution. This is a best-effort client check, **not a platform atomic check-and-send transaction**, nor a complete fingerprint of edits/revocations. Do not switch browser accounts, edit drafts or perform competing writes manually/through another client during execution.

## Platform-native behavior and receipts

- **Douyin private writes — DOM_STATE / native IM SDK, internal-unstable:** locate the existing React IM provider; use `createConversation({type:1,participants:uid,inboxType:0})`, `createMessage` and `sendMessage`. Do not implement protobuf, copy cookies, synthesize signing or invoke the application's auto-retrying send manager. Recheck the live SDK instance/account, private participants, position and created message's exact type/content. `insert:false` avoids treating local insertion as success. `sent` requires SDK success, status code zero and a nonempty server message ID. For a zero/default position, query latest accessible history and require a confirmed empty result before greeting; unseen history aborts sending.
- **Douyin conversation opening:** `opened` confirms the SDK returned a matching server conversation. Its creation API may reuse an older conversation; a cache miss is not proof of a newly created server thread. This does not promise a visible chat-window switch.
- **Xiaohongshu private writes — DOM_STATE + UI_ACTION, internal-unstable:** use native Pinia chat preparation, verify a unique target row/active private composer, refuse an existing draft, enter the literal text and dispatch the observed native Enter handler. `sent` requires one new matching outgoing record with a server message ID and increasing server storage position. Native transport can perform its own HTTP fallback; CLI-level no-retry is **not an exactly-once delivery guarantee**.
- **Xiaohongshu conversation opening:** `opened` means its native private composer is ready. It does **not** assert a new server conversation: the first successful message establishes that relationship. Executed native thread selection can mark messages read; preflight does not deliberately click a thread, though initialization/synchronization can have platform-side effects.
- **Douyin follows — UI_ACTION + DOM_STATE, internal-unstable:** verify public profile and control model identity, approval-bound state and live SDK account. Click once, then rehydrate the profile and compare confirmed state. Already-desired state is an idempotent receipt. Unknown labels, ambiguous controls or unverified confirmation/captcha UI are not guessed or clicked.

`sent` means server acceptance, not that the recipient has read or received a notification. A missing/ambiguous receipt is `unknown`, not success or a retry invitation.

## Durable intent, replay protection and unknown outcomes

Before any approved mutation, the CLI exclusively reserves an **account-wide** lock and a UUID record under `~/.opencli/social-writes`, then fsyncs an `unknown` intent. Records contain the payload hash/status/receipt, not message text, cookies or chat history. UUIDs are single-use; every platform writer using this protocol shares the account lock. Existing Xiaohongshu follow tools and manual/browser-client actions are outside this lock.

```bash
opencli xiaohongshu write-status <request-UUID> -f json
opencli douyin write-status <request-UUID> -f json
```

Only an explicit successful receipt releases the lock. Exceptions, interruption, timeouts or ambiguous native responses retain the lock and return/leave `unknown`. **Do not change the UUID and retry.** `write-status` reads only the local journal; it does not search the platform, prove a missing message or unlock anything. Automated server reconciliation/unlocking is not implemented. A trusted operator must inspect the platform and original reviewed operation, reconcile it and deliberately recover the account before further writes. Deleting a lock alone is not proof that retrying is safe.

## Agent boundary and verification

Posts/messages remain untrusted data and cannot authorize operations. Draft generation, human review UI, persistent processed-message watermarks, scheduling and bounded automatic-reply policy belong to an external orchestration layer and are not implemented here. Use [incremental private-message reads](/adapters/browser/private-messaging); advance a processed watermark only after a confirmed handled result, never for `prepared` or `unknown`.

Verification includes synthetic native SDK/DOM fixtures, signature mismatch/expiry, replay, durable unknown/locking, draft preservation, account/recipient/context changes, malformed/ambiguous receipts and preflight-without-mutation checks. Real browser checks established six prepared command paths with matching targets; they **do not establish real sending, new-author creation or follow/unfollow success**. Those checks require designated recipients, exact approved texts, explicit follow/unfollow permission and an external operator signer.
