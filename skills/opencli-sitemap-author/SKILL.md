---
name: opencli-sitemap-author
description: Use when creating or maintaining OpenCLI site sitemaps: agent-facing navigation, page-state, action, workflow, API-reference, pitfall, and fallback knowledge for a website. Use after browser exploration discovers durable site context, when a sitemap is stale, or when promoting local site knowledge into the repo.
allowed-tools: Bash(opencli:*), Read, Edit, Write, Grep
---

# opencli-sitemap-author

You are authoring a **task execution graph for agents**, not an SEO sitemap. The artifact should help an agent using `opencli browser` decide where it is, what path to take next, which OpenCLI adapter to prefer, and how to recover when the page disagrees with memory.

Keep the sitemap small and verified. Do not crawl a whole site. Capture only task-relevant paths that you actually observed.

---

## Storage Model

Two layers:

- **Global seed**: `skills/opencli-sitemap-author/references/site-memory/<site>/sitemap/`
- **Local overlay**: `~/.opencli/sites/<site>/sitemap/`

Local overlay wins by stable id. Write new discoveries to local first. Promote to global only after review.

Recommended layout:

```text
sitemap/
  SITE.md                 # site purpose, auth assumptions, stable page ids
  pages/<page-id>.md      # page state signatures, actions, linked APIs
  workflows/<task-id>.md  # best path, fallback path, avoid list
  pitfalls.md             # durable failure modes and stale areas
```

Keep individual files under roughly 800 tokens. Split pages/workflows instead of making one giant document.

---

## Authoring Loop

1. **Load existing memory**: read local overlay first, then global seed if present.
2. **Verify reality**: use `opencli browser <session> state`, `find`, `network`, and `analyze`; browser state is truth. If you just completed an `opencli-adapter-author` session for this site, start from the retained browse trace under `~/.opencli/sites/<site>/traces/` as seed evidence instead of re-discovering the path from zero.
3. **Record only durable structure**: page purpose, stable anchors, state signature, actions, workflows, API references, pitfalls.
4. **Use stable ids**: page/action/workflow ids should survive URL params, locale text drift, and minor layout changes.
5. **Write local draft**: update `~/.opencli/sites/<site>/sitemap/...` unless explicitly promoting to repo.
6. **Mark stale on conflict**: if existing sitemap disagrees with current browser state, trust browser state and mark the item stale rather than forcing the old path.

---

## Required Action Schema

Every action edge must include:

```md
### action:<stable-id>

Preconditions:
- <current page/state/auth requirements>

Do:
- <agent action, preferably semantic browser command or existing adapter>

Postconditions:
- <URL/state/output that proves success>

Failure signals:
- <how to tell this edge no longer works>

Recovery:
- <fallback path, re-state/re-find instruction, or adapter fallback>

Evidence:
- verified_at: YYYY-MM-DD
- observed_with: opencli browser <session> ...
- source: local|global
```

Do not promote an action without evidence.

---

## Workflow Fields

Each workflow should answer:

- **Goal**: user-facing task this workflow solves.
- **State signature**: minimal observable checkpoint for resume after sleep/compaction.
- **Best path**: prefer existing `opencli <site> <command>` adapter if it covers the goal.
- **Fallback path**: browser workflow if the adapter is missing or failing.
- **Avoid**: tempting paths that waste turns, trigger modals, or rely on unstable selectors.
- **Stale markers**: last verified date and known layout/API drift signals.

Endpoint/API knowledge should reference ids from `endpoints.json` when available. Do not duplicate full endpoint schemas inside sitemap files.

---

## Red Lines

- Sitemap is a hint; current browser state is truth.
- Do not write secrets, cookies, user-private ids, private messages, or account-specific values.
- Do not document bypasses for CAPTCHA, WAF, access control, rate limits, or paid gates.
- Do not store brittle snapshot indices like `[17]` as durable targets. Store semantic anchors and recovery instructions.
- Do not describe unverified paths as facts. Use `draft` or `stale` labels.
- Drafts go inside `sitemap/draft-<topic>.md`, not `~/.opencli/sites/<site>/sitemap.draft.md` at the parent level — the latter is invisible to `opencli browser` sitemap availability detection.

---

## Detailed schema

See [`references/sitemap-schema.md`](./references/sitemap-schema.md) for the full field-level spec — `SITE.md` / `pages/<id>.md` / `workflows/<id>.md` / `apis.md` / `pitfalls.md` schemas, action-level state signatures, `adapter_health` enum (healthy / suspect / broken), endpoint reference rules, two-layer overlay semantics, draft placement, and Phase 2 validation rules.
