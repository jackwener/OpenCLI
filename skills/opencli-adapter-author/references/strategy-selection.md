# Choosing an adapter strategy

Use the site's available contract and the task's needs to choose an implementation.
This reference is optional; no strategy note or classification artifact is required.

| Source | Useful when | Check |
| --- | --- | --- |
| Public API | A documented endpoint covers the task | Inputs, authentication, pagination and error semantics |
| Cookie-authenticated API | The endpoint works with the current account | Cookie/CSRF scope and real returned identity |
| Page state / SSR | The page already contains the required data | Field meaning, completeness and hydration timing |
| Semantic UI | The visible controls express the operation reliably | Stable selectors, target identity and observable result |
| Browser fetch | The request needs page origin or runtime context | Actual request parameters and response meaning |
| Network interception | The page produces a request that is difficult to reproduce | The captured response belongs to the intended action and input |

There is no universal API-over-DOM rule. A stable visible control can be easier to
maintain than an undocumented internal endpoint. Reuse an existing adapter or
shared helper when it already models the same operation.

## Gather facts as needed

```sh
opencli browser state --diagnostics --session research
opencli browser network --static --session research
opencli browser network --detail RequestKey --session research
```

Read `data` from the success envelope. Page diagnostics expose title, URL and
initial-state globals. Network evidence provides captured request keys, response
shapes and static source locations. `static` is a candidate; `network+static`
means both sources support the route. Neither proves business correctness.
The CLI does not assign a strategy score or prescribe the next action.

Check representative values against the visible page. For lists, distinguish a
true end of pagination from a failed or partial response. For writes, bind the
operation to the requested target and inspect its result; do not replay an action
whose previous outcome is unknown.

If an endpoint needs a runtime-generated signature, consider observing the page's
own request or using semantic UI. Use `references/api-discovery.md` for techniques
and `references/deep-recon.md` when the protocol requires further investigation.
