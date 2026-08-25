---
schema_version: 1.1
page_id: thread
url_patterns:
  - https://mail.google.com/mail/u/<account>/#all/<thread-route>
purpose: expanded Gmail conversation with messages and attachments
last_verified: 2026-08-25
source: global
---

## Visual anchors

- selector_pattern: `[data-message-id][data-legacy-message-id]`
- selector_pattern: `.a3s` inside the matching message container
- selector_pattern: `.aQH` or `[download_url]` inside the message container
- pattern: subject heading `h2[data-thread-perm-id]` or `h2.hP`

## Actions

```yaml
### action:read_messages
pre: signed in; target thread id known
do: opencli gmail thread <threadId>
post: every expanded message returns id, sender, subject, body, and attachment array
fail: fd shape changed | rendered fallback finds no data-message-id/body pair
recover: adapter_health_update: opencli gmail thread -> suspect; expand collapsed messages, then inspect within each message container
evidence: live cached thread exercised rendered fallback on 2026-08-25
```

```yaml
### action:list_attachments
pre: target thread id known
do: opencli gmail attachments <threadId>
post: one row per attachment; EmptyResult when none
fail: attachment cards visible but no rows | wrong message scope
recover: adapter_health_update: opencli gmail attachments -> suspect; inspect .aQH within each data-message-id container
evidence: live PDF attachment metadata on 2026-08-25
```

## Page-specific pitfalls

- Opening a recently cached thread may produce no fresh `/fd`; rendered message containers are the intended fallback.
- Scope body and attachment selectors to each message container.
