---
schema_version: 1.1
last_verified: 2026-08-25
source: global
---

## Site-specific pitfalls

### pitfall:search_does_not_submit_with_synthetic_events
trigger: an agent fills Gmail search by assigning `.value` and dispatching synthetic Enter
symptom: input text changes but URL/results stay on the previous query
workaround: use `opencli gmail search`; browser fallback must use native text insertion plus raw native Enter
verified_at: 2026-08-25

### pitfall:cached_thread_has_no_fresh_response
trigger: an agent opens a recently loaded thread expecting a new network response
symptom: no `/fd` capture although the thread body is visibly rendered
workaround: use `opencli gmail thread`; fallback scopes `[data-message-id]` and `.a3s` to the rendered thread
verified_at: 2026-08-25

### pitfall:private_post_is_not_a_write_signal
trigger: an agent classifies Gmail requests only by HTTP method
symptom: read-only `/bv` and `/fd` POSTs are mistaken for writes, or private write POSTs are replayed
workaround: classify by user-visible action and observed effect; never replay private Gmail writes
verified_at: 2026-08-25

### pitfall:draft_retry_can_duplicate_state
trigger: draft confirmation times out after Compose opened
symptom: command reports temporary failure while a complete or partial draft may already exist
workaround: inspect Drafts before retrying; never assume a timeout means nothing changed
verified_at: 2026-08-25
