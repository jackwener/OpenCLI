# manus

Adapter for [Manus](https://manus.im) — the "Hands On AI" autonomous agent web app at `manus.im/app`.

## Auth

Cookie-mode. After the user signs in to `https://manus.im/app` in the Browser Bridge profile, the `session_id` cookie carries a JWT that the adapter re-uses as a Bearer token when calling Manus's Connect-RPC backend at `https://api.manus.im/`.

## Commands

| Command | Description |
|---|---|
| `manus status` | Account snapshot — email, display name, user ID, membership tier, and headline credit numbers. |
| `manus list [--limit N] [--archived]` | List recent Manus sessions with round-trippable `id` values. Hides archived sessions unless `--archived` is passed. Default `--limit 20`. |
| `manus read <uid>` | Show full field-level detail for a single session (looked up by the `id` emitted from `manus list`). |
| `manus credits` | Full credit breakdown — total / free / periodic / pro monthly / refresh / max refresh / next refresh / interval. |
| `manus connectors [--limit N]` | List available Manus connectors (Apify, GitHub, Outlook, Slack, …). Default `--limit 50`. |
| `manus skills` | List skills, both user-added (`source=user`) and system (`source=system`). |

## Examples

```
$ opencli manus status
Field: Email                Value: zhongyuelin990405@gmail.com
Field: Display Name         Value: Lin Zhongyue
Field: Membership Tier      Value: 60
Field: Total Credits        Value: 12311
Field: Periodic Credits     Value: 12000
Field: Refresh Credits      Value: 300

$ opencli manus list --limit 3
id: 8UcpCxMFLrNk63ZJmzALfV  Title: 制作技术方案路演风格PPT的详细要求  Status: stopped
id: YOpdpcVj7vPFD4gsBfEwVu  Title: Defining Empire: …                Status: stopped

$ opencli manus read 8UcpCxMFLrNk63ZJmzALfV
Field: UID            Value: 8UcpCxMFLrNk63ZJmzALfV
Field: Title          Value: 制作技术方案路演风格PPT的详细要求
Field: Status         Value: SESSION_STATUS_STOPPED
Field: Mode           Value: AGENT_TASK_MODE_HIGH_EFFORT
Field: Credits        Value: 4564
```

## Notes

- Implementation is API-first: every command issues exactly one Connect-RPC POST against `api.manus.im` instead of scraping the DOM, so it is resilient to UI re-skins.
- The CLI surface intentionally excludes destructive / state-changing actions (new task submission, chat replies, archive, delete). Manus's `/app` route is a pure React SPA with no per-session URL — there is no `/app/session/<uid>` page — so there is no verifiable post-state for those operations to assert against. They are deliberately out of scope until the Manus team exposes a per-session route or confirmation dialog.
- `manus read <uid>` calls `ListSessions` with `pageSize=100` and filters in-process. If the matching session lives beyond the first 100 most-recent sessions, the command will report it as not found.
- `Status` and `Mode` are returned as the raw RPC enum strings (`SESSION_STATUS_STOPPED`, `AGENT_TASK_MODE_HIGH_EFFORT`, …). `Membership Tier` is the numeric tier code (e.g. `60`).

## NOT exposed

- `manus open <uid>` — `/app/session/<uid>` returns 404; the SPA has no URL routing for individual sessions.
- `manus new-task <prompt>`, `manus chat <uid> <message>`, `manus pause/resume/cancel <uid>` — destructive state mutations whose effect cannot be verified from a stable post-state (URL never changes, no confirmation dialog).
- `manus delete <uid>` / `manus archive <uid>` — same reasoning; no confirmation dialog and no URL-anchored post-state.
