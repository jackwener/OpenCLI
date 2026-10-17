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
opencli browser close --session research
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
`close` or idle expiry. `--window foreground|background` controls owned windows.

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
Native-created tabs/windows persist. Mutations touching active OpenCLI session
tabs or managed groups return `managed_resource_conflict`; ordinary groups can be
created, renamed, recolored, moved and dissolved with `tabs.ungroup`.
