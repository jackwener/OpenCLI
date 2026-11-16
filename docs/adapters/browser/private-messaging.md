# Private messaging: Xiaohongshu and Douyin

`inbox` and `messages` are **read-only, ordinary-user web inbox commands**. They do not use creator-center authentication, send replies, generate topics, review greetings, or start new conversations. Separate [social write tools](/adapters/browser/social-writes) provide approval-gated sends/conversation preparation; do not confuse a prepared write with successful execution.

## Workflow

Log into `www.xiaohongshu.com` / `www.douyin.com` in Chrome with Browser Bridge connected, then list existing private conversations:

```bash
opencli xiaohongshu inbox --limit 20 -f json
opencli douyin inbox --limit 20 -f json
```

Copy the exact `conversation_id` from the relevant inbox. Do not choose by nickname: names can be duplicated or change.

```bash
# Most recent 50 available messages by default
opencli xiaohongshu messages <conversation_id> -f json
opencli douyin messages '<conversation_id>' -f json

# Most recent N, returned oldest-to-newest within that selection
opencli xiaohongshu messages <conversation_id> --limit 10 -f json
opencli douyin messages '<conversation_id>' --limit 10 -f json

# All history available to the current web account
opencli xiaohongshu messages <conversation_id> --all -f json
opencli douyin messages '<conversation_id>' --all -f json

# Larger histories: raise explicit safety bounds if required
opencli douyin messages '<conversation_id>' --all --max-pages 500 --timeout 600 -f json
```

Xiaohongshu also accepts an exact `https://www.xiaohongshu.com/user/profile/<24-character-id>` URL. Douyin also accepts the numeric `user_id` returned by inbox; it does **not** accept a nickname, public profile URL, or `sec_uid`. Douyin conversation IDs contain colons, e.g. `0:1:<user-id>:<peer-id>`; treat them as opaque strings.

## Arguments and output

- `inbox --limit`: maximum matching conversations, default **20**, range **1–1000**. Returns fewer only when the source confirms the available list has ended.
- `inbox --unread`: filter before applying the limit, loading additional conversation pages as needed. Missing/invalid unread counts are errors, not treated as zero. A fully scanned source with no unread conversations reports `EMPTY_RESULT`.
- `messages --limit`: latest messages, default **50**, range **1–10000**.
- `messages --all`: paginate until the available history ends. Cannot be combined with an explicit `--limit`.
- `messages --after-message <message_id>`: locate this exact checkpoint, then return messages with greater server conversation positions. Cannot combine with `--all`. Default: all new messages; explicit `--limit N`: the **oldest N new messages**, allowing a consumer to advance without skipping intervening messages. Checkpoint missing/expired or safety-bound/timeout failure is an error, never a partial successful delta. An existing latest checkpoint with no newer messages legitimately returns `[]`.
- `messages --max-pages`: maximum history requests, default **200**, range **1–2000**.
- `messages --timeout`: command time budget in seconds, default **120**, range **1–3600**.

Inbox fields: `rank`, `conversation_id`, `user_id`, `nickname`, `last_message`, `updated_at`, `unread_count`, `profile_url`.

Message fields: `index`, `conversation_id`, `message_id`, `sender_id`, `is_self`, `type`, `text`, `created_at`, `revoked`, `raw_content`.

IDs remain strings; timestamps are ISO strings. `index` is a one-based index in the returned selection, not a server message ID. Ordering and latest-N selection use server conversation positions, **not client timestamps**, so clock skew does not select older messages. History is deduplicated by stable message ID. `raw_content` preserves the original content JSON string for media, shares, system messages, and unknown types. Missing preview or cached user metadata is `null`; unknown message types are named `unknown:<code>`. Use JSON output for downstream processing.

## Incremental Agent polling

```bash
opencli xiaohongshu inbox --unread --limit 20 -f json
opencli douyin inbox --unread --limit 20 -f json
opencli xiaohongshu messages <conversation_id> --after-message <processed-message-id> -f json
opencli douyin messages '<conversation_id>' --after-message <processed-message-id> --limit 20 -f json
```

Persist processed message IDs by account and conversation **outside the adapter**. Advance to the last successfully processed message, not merely the latest fetched ID. On a missing checkpoint, reconcile history and state before resuming. Other clients can clear unread counts, so `--unread` is an optimization, not a durable processing watermark; also scan existing conversations against stored watermarks. New messages arriving after a fixed history snapshot are handled in the next poll. These commands do not implement persistence, approvals, sends, locks or an automatic reply daemon.

See [ordinary-user discovery](/adapters/browser/social-discovery) for public author IDs/profiles and the precise Web nearby limitations.

## Scope and safety

- “All” means all history the **web account can currently access**, not an archive of deleted, expired, mobile-only, or otherwise server-hidden messages. Group chats are excluded. The separate Douyin stranger-message box has not been validated and is not promised to be covered.
- No thread-selection clicks or explicit mark-read endpoints are used. The platform's own initialization and real-time synchronization can still have read-state side effects; this is **not** a guaranteed invisible-reading mode.
- Login, verification, missing target, malformed data, stalled pagination, timeout, and safety-bound failures are reported explicitly. `--all` never succeeds with a silently truncated result. A recent-N request can return fewer messages if the source confirms history end.
- Nicknames on Douyin may be absent from its current web user cache. Select by ID even when a display name is unavailable.
- Output is private account data. Do not commit actual messages, account identifiers, cookies, or traces containing message bodies to a repository. Tests use synthetic fixtures only.

## Implementation evidence and maintenance

### Xiaohongshu

- **Source strategy:** `PAGE_FETCH`; runtime registry strategy: `Strategy.COOKIE` (the registry's browser-login category). **Contract:** internal-unstable.
- **Observed requests:** `GET https://edith.xiaohongshu.com/api/im/web/v3/chats?limit=100&complete=true&page=0&source=pc`; `GET /api/im/web/chat/get_unread`; `GET /api/im/web/messages/history?chat_user_id=…&last_id=…&start_id=…&limit=30`.
- **Auth source:** browser-page `fetch` with `credentials: 'include'`; no copied cookies or synthesized signatures.
- **Replay:** successful JSON envelopes, six conversations, and seven history requests yielding 193 distinct messages in a sample thread. A request limit of 30 can return 31 records. `last_id=0` restarts the newest page, so traversal stops before that value.
- **Boundary:** begin at the conversation's `max_store_id`, advance to `min(returned store_id) - 1`, respect `start_store_id`, and accept an explicitly empty successful page as end of accessible history. Never infer completeness from a short page or gaps in store IDs.
- **Why this source:** no documented ordinary-user history API was found. Visible DOM messages cover only the loaded viewport and cannot provide this history contract. Page fetch supplies message IDs and server storage bounds without clicking a thread; schema, identity, and cursor guards detect drift. These private web endpoints may change and need revalidation when those guards fail.

### Douyin

- **Source strategy:** `DOM_STATE` plus the existing page IM SDK; runtime registry strategy: `Strategy.COOKIE`. **Contract:** internal-unstable; React provider and SDK internals are not a public API.
- **Anchor:** `#imSaasContainerId`, its React Fiber ancestors, and provider `value.imSdkService.imSdkManager.getImSdkInstance()`. No numeric webpack module IDs are used.
- **Auth source:** the logged-in application's existing IM SDK. Its protobuf transport and request authentication remain the platform's responsibility.
- **Observed state/replay:** decoded private conversation models (`type === 1`) and `getMessagesByConversation({conversation,cursor,limit})` yielding `{messages,hasMore,cursor}`. Verified a 20-conversation inbox, recent-5 selection, and complete 29-message sample history; a longer sample continued through 15 pages with `hasMore: true` and was not called complete.
- **Conversation boundary:** legacy `loadMoreFromInitLink` returns request **success**, not pagination completion. The real legacy end flag is the SDK init-link plugin's `nextParams.hasMore`; the next SDK uses the conversation store's updated `hasMore`. Unknown flags or non-progressing state fail closed. SDK control records with `visible === false` are excluded from visible chat history.
- **History boundary:** preserve Long integer positions as strings/BigInt; begin at `lastMessageIndex + 1` because the older-history cursor is exclusive. Stop only on `hasMore === false`, keep the initial upper snapshot fixed, and reject cursor regression or out-of-range messages.
- **Typed error path:** absent provider, changed private identity, malformed models, or missing cursor/completion flags produce `COMMAND_EXEC`; initialization timeout is `TIMEOUT`, authentication failure is `AUTH_REQUIRED`, and a source-confirmed absent thread is `EMPTY_RESULT`.
