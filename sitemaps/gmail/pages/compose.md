---
schema_version: 1.1
page_id: compose
url_patterns: []
purpose: compose overlay used only for saving drafts in this adapter
last_verified: 2026-08-25
source: global
---

## Visual anchors

- selector_pattern: `[gh="cm"]` for Compose
- selector_pattern: `[role="dialog"] input[name="to"]`
- selector_pattern: `[role="dialog"] input[name="subjectbox"]`
- selector_pattern: `[role="dialog"] [contenteditable="true"]`
- a11y: Save & close button; localized labels are supported

## Actions

```yaml
### action:save_draft
pre: signed in; recipients, subject, and plain-text body ready; explicit user authorization
do: opencli gmail draft <to> --subject "..." --body "..." --execute
post: compose dialog closes after Gmail autosave; command returns status=saved
fail: compose fields missing | Save & close missing | dialog remains after click
recover: if click already occurred, check Drafts before retrying; adapter_health_update: opencli gmail draft -> suspect
evidence: production path covered by tests; live mutation deliberately not executed
```

## Page-specific pitfalls

- Never use the Send button for this workflow.
- After Compose is opened, failures are potentially state-changing because Gmail may autosave a partial draft.
