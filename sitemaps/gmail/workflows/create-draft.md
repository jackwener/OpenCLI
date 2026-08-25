---
schema_version: 1.1
workflow_id: create-draft
intent: save a Gmail draft without sending
last_verified: 2026-08-25
source: global
---

## Goal

Create a remote Gmail draft with recipients, subject, and plain-text body while never sending it.

## State signature

- entry: signed-in inbox, no compose dialog required
- success: compose dialog closed after autosave and command status is `saved`

## Best path

adapter: `opencli gmail draft <to> --subject "..." --body "..." --execute`
adapter_health: suspect
preconditions: explicit user authorization; comma-separated valid recipients; non-empty subject/body
estimated_turns: 1

## Fallback path

on_adapter_fail:
1. `adapter_health_update: opencli gmail draft -> suspect`
2. If Compose was opened, inspect Drafts before any retry.
3. Use `action:save_draft in pages/compose.md`; close with Save & close, never Send.

## Avoid

- Running without explicit authorization or omitting `--execute`.
- Retrying after a post-compose timeout before checking Drafts.
- Replaying Gmail private write requests.
