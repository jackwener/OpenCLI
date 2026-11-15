---
name: opencli-browser
description: Drive Chrome with OpenCLI to inspect pages, interact with logged-in sites, capture API evidence, and manage native tabs, groups and windows. For reusable adapters, see opencli-adapter-author.
allowed-tools: Bash(opencli:*), Read, Edit, Write
---

# Browser tools for agents

Use the capability that fits the task. Discover commands with `opencli list <query>`;
read exact arguments with `opencli browser <command> --help -f json`.
Run `opencli doctor` when diagnosing a connection problem.

## Scope and results

Page commands require `--session <name>`. Reuse that name across a task; different
sessions isolate page work. `--profile <name>` selects a Chrome profile when needed.
Options can follow command arguments:

```sh
opencli browser open https://example.com --session research
opencli browser state --session research
opencli browser click --role button --name Search --session research
OPENCLI_CLOSE_OWNED_TAB=1 opencli browser close --session research
```

Default output is one JSON value: `{ "ok": true, "data": ... }`.
Failures return `{ "ok": false, "error": { "code": "...", "message": "...", "hint": "..." } }`
and a nonzero exit code. Diagnostic logs go to stderr. `network --follow` and
`console --follow` stream one envelope per line. Help, version and shell completion
are inspection/export surfaces; structured help uses `--help -f json`.

Read the returned data and error fields. When `error.outcome` is `unknown`, inspect
the affected state before retrying a write.

## Page targets and interaction

- `state` returns URL and interactive element refs. `--diagnostics` also reports
  page title and available initial-state globals; `--source ax` selects the AX tree.
- `find` locates elements. Interaction targets accept a ref, CSS selector, or
  semantic flags such as `--role`, `--name`, `--label`, `--text`, `--testid`.
- Use `--nth` to resolve deliberate multiple matches. On stale refs, read fresh
  state or locate the element again; refs describe the observed page.
- `fill` replaces a field and verifies its value; `type` types text. Other actions
  include `click`, `select`, `check`, `upload`, `drag`, `keys` and `dialog`.
- `get text|value|attributes|html`, `extract`, `screenshot` and `eval` expose page data.
  `eval` executes JavaScript in the page and can mutate state.
- `wait xhr|selector|text|download` observes an expected condition. Consult help for
  timeouts and matching rules.
- `tab list|new|select|close` manages session tabs. `--tab` accepts the page identity
  returned by these commands; these are different from numeric native Chrome IDs.
- `frames` lists frame targets; `eval --frame` evaluates in a selected frame.

`bind --session research` attaches the current user tab. Bound sessions permit
navigation but block tab creation, selection and closure. `unbind` releases the
binding without closing the user tab. Owned sessions keep leased tabs until
`close` or idle expiry; see Clean up when done. `--window foreground|background`
controls owned windows.

## Clean up when done

Owned session tabs live in an orange "OpenCLI Browser" tab group in the user's
Chrome. A plain `close` or idle expiry parks the last tab there as a reusable
placeholder, so the group stays behind. When a task or one-off call finishes,
including after failure or abandonment, close every session it opened with the
cleanup opt-in (prefix the command or set it in the agent's environment):

```sh
OPENCLI_CLOSE_OWNED_TAB=1 opencli browser close --session research
opencli browser chrome call tabGroups.query '[{"title":"OpenCLI Browser"}]'
```

This ungroups and removes only the session's current tab. Chrome drops the group
once it is empty, and the window once nothing else is left. Use one session per
page instead of `tab new`: other tabs of an owned session are not in `tab list`,
so `tab close` cannot reach them and they stay behind after `close`. If the query
still finds the group (extra tabs, or a placeholder parked by a plain `close`),
run `open` on a session, which reuses an unleased tab in the group, then close
it with the opt-in; repeat until the group is gone. If cleanup fails, retry
`close` only; do not repeat the site action. Release bound sessions with `unbind`,
which leaves the user's tab open. Keep a session open only when the user asks.

## Network and scripts

```sh
opencli browser network --session research
opencli browser network --detail RequestKey --session research
opencli browser network --static --session research
```

`network` returns captured request keys and response shapes. `--detail` reads a
cached request; `--filter` selects shapes; `--raw` exposes response bodies.
`--static` adds Acorn AST candidates from loaded scripts, with source locations,
methods, query/body parameter names and observed request evidence. `EXPR` means
an unresolved expression. Static candidates are not executed or proven APIs.
Check `analysisComplete`, script errors, omitted scripts and `networkSource`.
An empty live capture can reuse a recent cache; reported provenance distinguishes it.

## Native Chrome management

Native calls need no session and do not attach a page:

```sh
opencli browser chrome describe
opencli browser chrome describe tabs.group
opencli browser chrome call tabs.query '[{}]'
opencli browser chrome call tabs.group '[{"tabIds":[123,456],"createProperties":{"windowId":10}}]'
opencli browser chrome call tabGroups.update '[789,{"title":"Research","color":"blue"}]'
```

Use numeric IDs returned by Chrome, replacing the example IDs. `describe` lists
supported methods, signatures, live permissions and official documentation.
Native-created tabs/windows persist. When the task ends, remove temporary tabs you
created this way: `tabs.ungroup` them, then `tabs.remove` (ungrouping first keeps
Chrome from saving the closed group). Keep tabs and groups the user asked you to
arrange. Mutations touching active OpenCLI session tabs or managed groups return
`managed_resource_conflict`; ordinary groups can be created, renamed, recolored,
moved and dissolved with `tabs.ungroup`.
