---
name: opencli-domain-router
description: Route natural-language requests to OpenCLI commands by domain (content, community, finance, devtools), enforce write-action confirmations, and map user intent to executable command templates. Use when users ask for hot lists, searches, social posting/check-in actions, market snapshots, GitHub/CI queries, plugin discovery, or recurring briefing/monitoring workflows with OpenCLI.
---

Use this skill as a thin router.

1. Classify request into one domain: `content`, `community`, `finance`, or `devtools`.
2. Load `references/intent-map.yaml` and choose the closest intent template.
3. Fill required args using `references/args.schema.json`.
4. For write-like actions (`publish`, `post`, `reply`, `comment`, `checkin`, `delete`, `merge`), require explicit confirmation before execution.
5. Prefer dry-run preview when supported.
6. Execute with OpenCLI command style; do not invent commands.
7. If command/template mismatch occurs, fall back to nearest safe read-only command and ask one minimal clarification.

Load references on demand:

- Domain guides:
  - `references/domain-content.md`
  - `references/domain-community.md`
  - `references/domain-finance.md`
  - `references/domain-devtools.md`
- Workflow guides:
  - `references/recipe-daily-brief.md`
  - `references/recipe-content-post.md`
  - `references/recipe-monitor.md`
- Machine-readable contracts:
  - `references/intent-map.yaml`
  - `references/args.schema.json`
