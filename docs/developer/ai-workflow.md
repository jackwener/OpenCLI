# Building adapters with an agent

OpenCLI supplies composable tools and observable results. The agent chooses its
implementation from the task, available site behavior and existing adapters.

## Discover capabilities

```sh
opencli list search --site example
opencli example search --help -f json
```

`list` returns compact capabilities with `total` and optional `nextOffset`.
Default command results use `{ok:true,data:...}`; failures use
`{ok:false,error:{code,message,hint?,...}}` and a nonzero exit code. Logs go to stderr.

## Inspect a site

```sh
opencli browser open https://example.com --session research
opencli browser state --diagnostics --session research
opencli browser network --static --session research
opencli browser network --detail RequestKey --session research
```

Page facts, captured requests and AST candidates inform implementation choices.
Static candidates are unexecuted evidence; the agent decides what to investigate.
`browser chrome describe` exposes native tab, group and window management without
a page session. Use `doctor` to diagnose connectivity when needed.

## Implement and exercise

```sh
opencli adapter init example/search
opencli adapter check example/search
opencli adapter test example/search --args '{"query":"hello"}'
```

Write a normal JS file. `cli({...})`, `func(args)` and `func(page,args)` remain the
adapter contract. Return business data; the CLI adds the JSON envelope.
`check` validates definitions; `test` executes the real command and optionally
compares a fixture. Write adapters have real effects when tested.

There is no draft store, promotion step, required strategy note or site-memory gate.
Use focused tests and real execution to cover core behavior, error paths and
business semantics. Optional traces and fixtures help investigate failures.

See [opencli-adapter-author](https://github.com/jackwener/opencli/blob/main/skills/opencli-adapter-author/SKILL.md)
and [opencli-browser](https://github.com/jackwener/opencli/blob/main/skills/opencli-browser/SKILL.md)
for the tool contracts and references.
