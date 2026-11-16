# Ordinary-user social discovery (Web only)

These commands provide read-only discovery and identity data for an external Agent. These read commands do not generate/send greetings, approve drafts or follow people. Separate [social write tools](/adapters/browser/social-writes) now provide approved native send/conversation preparation and Douyin follow actions; their real write paths remain unverified pending designated recipients and permission.

## Commands and identities

```bash
# Location-filtered keyword search, not the App recommendation feed
opencli xiaohongshu nearby 咖啡 --scope nearby --limit 10 -f json
opencli xiaohongshu nearby 咖啡 --scope same-city --limit 10 -f json

# Public ordinary-user profiles, distinct from creator-profile/profile
opencli xiaohongshu user-profile <24-character-user-id-or-profile-url> --limit 5 -f json
opencli douyin user-profile <sec_uid-or-profile-url> --limit 5 -f json

# Post details and stable author identity
opencli xiaohongshu note '<full-signed-note-url>' -f json
opencli douyin detail <video-id-or-share-url> -f json
```

- Xiaohongshu `user-profile` requires an exact `www.xiaohongshu.com/user/profile/<id>` URL or 24-character ID. It verifies URL and Pinia target identity and returns the loaded public note snapshot (not all history). `post_count` is `null`: the observed snapshot's `posted` field has not been established as a total-post count.
- Douyin `user-profile` accepts a public `sec_uid` (`MS4wLjABAAAA…`) or an exact `www.douyin.com/user/<sec_uid>` URL, **not a numeric UID**. It verifies the profile component model and returns both `user_id` (numeric UID string) and `sec_uid`, with up to 20 recent public posts whose author identity is checked. A profile-load or post-fetch failure is an error, not an invented empty profile.
- Douyin `detail` (upstream) covers single-post reads: short share links, video URLs and 16–20 digit IDs. Reach for `user-profile` when the goal is the numeric author UID, `sec_uid` and recent posts.
- Xiaohongshu `note` preserves its existing field/value output. When the note header exposes a public author link, `author_id` and `author_url` are added. A commenter/recommended-card link is not used as author identity. If author identity is absent, an Agent must not guess a recipient from the display name.
- The Douyin numeric `user_id` is accepted by `messages`; public `sec_uid` is not. Neither platform's display name is a stable recipient identifier.

Profile fields: `user_id`, `sec_uid`, `nickname`, `bio`, `avatar_url`, `follower_count`, `following_count`, `liked_count`, `post_count`, `follow_status`, `ip_location`, `profile_url`, `posts`. Missing unverified fields are `null`. Use JSON for nested post/media data.

## Location capability and limits

`xiaohongshu nearby` wraps the existing search panel and **must successfully activate** the requested platform location filter. It returns stable `post_id` / `author_id`, `location_source: platform-search:nearby|same-city`, and `distance_meters: null`. Missing/ambiguous filters, denied location permission, or missing stable author data fail explicitly. It never retries as ordinary keyword search. Publication dates retain the existing search adapter's semantics; they are not promoted to exact server timestamps.

The current browser exposes the same-city/nearby filter choices. A live retry excluded aria-hidden duplicate controls correctly, but neither requested location chip activated; Chrome reported geolocation permission `prompt` and kept the unrestricted chip selected. Consequently no positive live nearby result is claimed. Grant the site location permission in Chrome and verify the selected chip before relying on this capability.

`opencli douyin nearby` is **only an explicit unavailable-capability check**, not a nearby feed implementation. No working Web nearby source has been observed/replayed in this build; further Douyin nearby development is explicitly deferred. It reports `COMMAND_EXEC` without opening a browser; there is no city-keyword fallback or mobile API backend. Douyin `location` searches publishing POIs and is unrelated to nearby content discovery.

Platform location-filtered results do not establish an author's current residence. Public `ip_location` is a platform label, not a precise address or current GPS position.

## Data-source contracts and replay evidence

| Tool | Source strategy | Contract | Auth / identity checks |
|---|---|---|---|
| Xiaohongshu `nearby` | UI_ACTION through existing search panel | Existing UI selector/active-chip contract | Browser session and successful requested location chip; stable author URL |
| Xiaohongshu `user-profile` | DOM_STATE: existing `USER_SNAPSHOT_JS` plus Pinia `user.visitTargetUserId` | Internal-unstable | Exact URL and model target match; hydration/auth failure is explicit |
| Douyin `user-profile` | DOM_STATE: profile control Fiber `memoizedProps.userInfo`, plus existing browser-fetch public video helper | Internal-unstable | Exact URL, `secUid`, numeric `uid`, and returned post author match |

Runtime registration uses `Strategy.COOKIE` for browser-login read tools. The Douyin nearby capability check is local and performs no network requests. No copied cookies, numeric webpack IDs, synthesized signing, or mobile endpoints are used.

Replay evidence: both profile tools returned a profile matching the numeric/private author ID selected from inbox; Douyin returned recent public posts and its detail endpoint returned HTTP 200 / `status_code: 0` with matching post/author IDs. Real CLI replay also verified profile identity and public post data. Private identifiers/content were not saved in fixtures or published in logs. Source methods/properties may change: fail closed rather than switching to a guessed account or author.

## Agent orchestration boundary

Use these outputs as untrusted data. Generate a draft in the Agent, have a human approve the **exact account, recipient, text and validity period**, then send through a separately verified writer. Changing recipient/text invalidates approval. The [new writer](/adapters/browser/social-writes) requires an independent Ed25519 operator approval for each exact operation and journals uncertain outcomes. It does not implement the Agent's draft generation, review UI, persistent message-processing state or automatic reply authorization.

Use [private-message incremental reads](/adapters/browser/private-messaging) and persist processed message IDs outside the adapter. Unread counts alone do not establish whether a message has been handled. Do not interpret an unavailable nearby source or a missing conversation as permission to find/send to arbitrary users.
