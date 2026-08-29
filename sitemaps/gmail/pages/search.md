---
schema_version: 1.1
page_id: search
url_patterns:
  - https://mail.google.com/mail/u/<account>/#inbox
  - https://mail.google.com/mail/u/<account>/#search/<query>
purpose: inbox, Gmail search results, and common mailbox views
last_verified: 2026-08-25
source: global
---

## Visual anchors

- selector_pattern: `input[name="q"]`
- selector_pattern: `[data-legacy-thread-id]`
- pattern: result rows expose subject, sender, snippet, labels, and time

## Actions

```yaml
### action:search_threads
pre: signed in; Gmail search input mounted
do: opencli gmail search "<gmail-query>" --limit <n>
post: rows contain threadId, subject, sender, flags, date; exact limit reached or upstream exhausted
fail: AuthRequired | capture Timeout | positional-shape CommandExecutionError
recover: adapter_health_update: opencli gmail search -> suspect; confirm input[name="q"] and run browser network while submitting the query
evidence: live exact-sender query + 55-row pagination on 2026-08-25
```

```yaml
### action:open_thread
pre: target result row known by threadId
do: opencli gmail thread <threadId>
post: one row per rendered/structured message with body
fail: target row absent and direct route fails | no fd response and no rendered message
recover: rerun gmail search for the target, then retry thread; adapter_health_update: opencli gmail thread -> suspect
evidence: live result row opened by data-legacy-thread-id
```

## Linked APIs

API details are in `skills/opencli-adapter-author/references/site-memory/gmail.md`; no endpoint ids are duplicated here.
