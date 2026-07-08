---
name: opencli-browser-sitemap
description: Use when driving a website with opencli browser and sitemap context is available, requested, or needed to avoid blind navigation. Guides agents to consume site sitemap files lazily, choose adapter/browser fallback paths, resume from state signatures, and mark stale sitemap entries without trusting them over live browser state.
allowed-tools: Bash(opencli:*), Read, Edit, Write, Grep
---

# opencli-browser-sitemap

Use this skill when `opencli browser open` or `opencli browser analyze` reports `sitemap.available: true`, or when the user asks you to use a site's sitemap.

The sitemap is **prior knowledge**, not ground truth. It should reduce blind clicking, but it must never override the live browser state.

---

## Consumption Loop

1. Run or reuse `opencli browser <session> state` to know the current page.
2. Read only the smallest relevant sitemap files:
   - `SITE.md` for site-level orientation.
   - One matching `pages/<page-id>.md` for current state.
   - One matching `workflows/<task-id>.md` for the user goal.
   - `pitfalls.md` only when blocked or warned by the workflow.
3. Prefer the workflow's **Best path**. If it names an adapter such as `opencli twitter post`, use that before raw browser actions.
4. If the adapter is unavailable or fails, use the **Fallback path** browser workflow.
5. After each navigation or state-changing action, refresh `state` and compare the workflow's `state_signature`.
6. If reality disagrees, trust reality, continue probing, and write a local stale note or draft patch.
7. If an action recovery includes `adapter_health_update: <adapter> -> suspect|broken`, update the local overlay workflow that references that adapter so future agents go straight to the fallback path.

---

## Lookup Order

Read local overlay first, then global seed:

```text
~/.opencli/sites/<site>/sitemap/    # local overlay
sitemaps/<site>/                    # repo seed (top-level)
```

Local files override global files with the same stable id.

Do not load an entire large sitemap into context. If the directory is large, list filenames first and then read only the page/workflow you need.

---

## Trust Reality Rule

If sitemap says a button, URL, route, or API should exist but the browser does not show it:

- Re-run `state` or `find` with semantic anchors.
- Check whether login, locale, viewport, A/B test, or route state differs.
- Follow the real page if a safe path is visible.
- Mark the sitemap item stale in local overlay.

Never keep clicking because "the sitemap says it should work."

---

## Stale / Draft Notes

When you discover drift, write a small local note under the relevant page/workflow file or a draft file in the local overlay:

```md
Stale note:
- observed_at: YYYY-MM-DD
- current_url:
- expected:
- actual:
- next_probe:
```

Do not edit global seed files unless the task is explicitly a sitemap-authoring or repo PR task.

## Adapter Health Write-Back

When an adapter fails and the sitemap action or workflow tells you to update adapter health:

1. Find the local workflow file under `~/.opencli/sites/<site>/sitemap/workflows/` whose `Best path` references the adapter command.
2. If no local workflow exists, copy the matching global workflow into the local overlay first; never edit the global seed directly during browser task execution.
3. Set `adapter_health: suspect` or `broken` as directed.
4. Add a short stale note with observed error, current URL, and timestamp.
5. Continue with the browser fallback path.

This write-back is the memory loop: the current agent falls back once, and the next agent does not waste a turn retrying a known-suspect adapter.

---

## Output Discipline

When reporting back, include:

- Path chosen: adapter best path or browser fallback.
- Checkpoint reached: current URL/state signature.
- Sitemap health: used as-is, stale marked, or missing workflow.

Keep the report task-focused. Do not summarize the whole sitemap.
