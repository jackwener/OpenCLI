# AI Workflow

OpenCLI is designed for AI agents writing adapters. The workflow is built on a small set of browser primitives plus a skill that teaches the end-to-end loop.

## The Loop

From a new site URL to a passing `opencli browser verify` — one skill, one set of primitives:

```bash
# 1. Pick up the skill (Claude Code)
#    skills/opencli-adapter-author/SKILL.md

# 2. Reconnaissance
opencli browser analyze https://example.com
# Fallback primitives when analyze says deeper inspection is needed:
# opencli browser open https://example.com
# opencli browser network      # inspect XHR / fetch calls
# opencli browser state        # extract __INITIAL_STATE__ / __NEXT_DATA__

# 3. Scaffold + verify
opencli browser init <site>/<name>
opencli browser verify <site>/<name>
```

The skill `opencli-adapter-author` walks through: coverage self-test → site recon → API discovery → field decoding → output design → adapter coding → verify → write-back to site memory.

See [skills/opencli-adapter-author/SKILL.md](https://github.com/jackwener/opencli/blob/main/skills/opencli-adapter-author/SKILL.md).

## Primitives

| Command | Purpose |
|---------|---------|
| `opencli doctor` | Sanity check: bridge, Chrome, signals |
| `opencli browser analyze <url>` | One-shot site recon: anti-bot, pattern, nearest adapter, next step |
| `opencli browser open <url>` | Open a tab in the Chrome session |
| `opencli browser network` | List recent XHR / fetch calls |
| `opencli browser state` | Page state: URL, title, interactive elements |
| `opencli browser eval '<expr>'` | Evaluate JS in the page context (cookies + origin honored) |
| `opencli browser init <site>/<name>` | Scaffold `~/.opencli/clis/<site>/<name>.js` |
| `opencli browser verify <site>/<name>` | Run the adapter and print first rows |

No `explore` / `synthesize` / `generate` / `cascade` command. The skill drives the loop — the primitives are small and composable.

## Site Memory

Every site accumulates knowledge at `~/.opencli/sites/<site>/` (endpoints, field decode map, notes, response fixtures). The adapter-author skill reads memory on Step 2 and writes back on Step 12 — see `skills/opencli-adapter-author/references/site-memory.md` for the schema.

In-repo seeds for well-known sites live at `skills/opencli-adapter-author/references/site-memory/<site>.md` (eastmoney / xueqiu / bilibili / tonghuashun already covered).

## Authentication Strategies

Adapters declare one of:

1. **PUBLIC** — direct fetch, no credentials
2. **COOKIE** — reuse Chrome session cookies (`browser: true` + `credentials: 'include'`)
3. **INTERCEPT** — let the page make the request; capture the response
4. **UI** — drive the authenticated browser UI when no stable API is available

Pick per the `coverage-matrix.md` and `api-discovery.md` references inside the skill.

## When Something Breaks

- Verify failure → run `opencli doctor`, then consult `skills/opencli-autofix/SKILL.md`
- Field values wrong → jump back to `skills/opencli-adapter-author/references/field-decode-playbook.md`
- Endpoint returns 401/403 → `api-discovery.md` §4 (token) / §5 (intercept)
