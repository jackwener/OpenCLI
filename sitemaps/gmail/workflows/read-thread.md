---
schema_version: 1.1
workflow_id: read-thread
intent: read a Gmail conversation and its attachment metadata
last_verified: 2026-08-25
source: global
---

## Goal

Resolve a search thread id into complete message bodies and optional attachment metadata.

## State signature

- entry: thread id from Gmail search, legacy hex id, or Gmail thread URL
- success: thread page has scoped message containers and command returns message rows

## Best path

adapter: `opencli gmail thread <thread>`; use `opencli gmail attachments <thread>` for attachment rows
adapter_health: healthy
preconditions: signed in; target id valid
estimated_turns: 1

## Fallback path

on_adapter_fail:
1. `adapter_health_update: opencli gmail thread -> suspect`
2. Search again so the target `[data-legacy-thread-id]` row is mounted.
3. Open that row; expand collapsed messages.
4. Extract `.a3s` and `.aQH` only inside each `[data-message-id]` container.

## Avoid

- Page-level first-match body/attachment selectors.
- Retrying an `fd` capture indefinitely when Gmail served cached rendered content.
- Logging or saving real message bodies as fixtures.
