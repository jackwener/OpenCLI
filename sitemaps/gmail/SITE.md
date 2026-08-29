---
schema_version: 1.1
site: mail.google.com
last_verified: 2026-08-25
source: global
login_required: true
auth_strategy: COOKIE
---

## Overview

Gmail desktop mail UI. Prefer `opencli gmail ...`: reads use Gmail's own search/navigation and intercept natural responses. This sitemap does not define write actions because no supported browser-session API contract is currently available.

## Top-level routes

- `/mail/u/<account>/#inbox` → pages/search.md
- `/mail/u/<account>/#search/<query>` → pages/search.md
- `/mail/u/<account>/#all/<thread-route>` → pages/thread.md
- `/mail/u/<account>/#settings/labels` → settings labels, read by `opencli gmail labels`
- other settings routes → outside this sitemap; inspect current browser state

## Common goals

- search/list mail → workflows/search.md
- read a complete thread or attachment metadata → workflows/read-thread.md
- inspect identity → `opencli gmail whoami`

## Site-wide pitfalls

See pitfalls.md. Gmail uses private positional arrays, may serve cached thread content without a new request, and its search box requires native input events.
