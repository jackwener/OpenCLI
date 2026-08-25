---
schema_version: 1.1
site: mail.google.com
last_verified: 2026-08-25
source: global
login_required: true
auth_strategy: COOKIE
---

## Overview

Gmail desktop mail UI. Prefer `opencli gmail ...`: reads use Gmail's own search/navigation and intercept natural responses; the draft write uses visible compose controls and never sends.

## Top-level routes

- `/mail/u/<account>/#inbox` → pages/search.md
- `/mail/u/<account>/#search/<query>` → pages/search.md
- `/mail/u/<account>/#all/<thread-route>` → pages/thread.md
- `/mail/u/<account>/#settings/labels` → settings labels, read by `opencli gmail labels`
- compose dialog → pages/compose.md (overlay, no independent stable route)
- other settings routes → outside this sitemap; inspect current browser state

## Common goals

- search/list mail → workflows/search.md
- read a complete thread or attachment metadata → workflows/read-thread.md
- save a draft without sending → workflows/create-draft.md
- inspect identity → `opencli gmail whoami`

## Site-wide pitfalls

See pitfalls.md. Gmail uses private positional arrays, may serve cached thread content without a new request, and its search box requires native input events.
