---
schema_version: 1.1
workflow_id: search
intent: find or list Gmail threads with complete pagination
last_verified: 2026-08-25
source: global
---

## Goal

Return structured Gmail threads using Gmail search syntax or a common mailbox view.

## State signature

- entry: signed-in Gmail page with `input[name="q"]`
- success: URL `#search/<query>` and structured rows matching the requested query

## Best path

adapter: `opencli gmail search <query>`; use inbox/unread/starred/sent/drafts/trash/spam/snoozed/important shortcuts when applicable
adapter_health: healthy
preconditions: signed in; limit 1-200
estimated_turns: 1

## Fallback path

on_adapter_fail:
1. `adapter_health_update: opencli gmail search -> suspect`
2. Verify `input[name="q"]` in current browser state.
3. Fill the exact Gmail query with native input and submit with a native Enter event.
4. Read visible `[data-legacy-thread-id]` rows; do not claim pagination completeness.

## Avoid

- Replaying private `/sync` POST bodies or copying XSRF/BTAI values.
- Treating GET as safe or POST as a write; Gmail read queries use POST.
- Returning partial rows after a continuation capture fails.
