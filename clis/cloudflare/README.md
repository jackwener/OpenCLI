# Cloudflare Agent Lee

```sh
opencli cloudflare ask 'Is Email Routing enabled on example.test?' --zone example.test
opencli cloudflare ask 'Inspect my DNS configuration' --zone example.test -f plain
# Only for an explicitly authorized change:
opencli cloudflare ask 'TASK' --zone example.test --mode edit
```

Requires an already signed-in Cloudflare dashboard session with Lee configured,
in a caller-owned remote CDP tab. The fleet launcher can select this with
`OPENCLI_PERSONA=personal`; callers on another host use authenticated SSH to that
launcher. Persona selection alone does not establish a Cloudflare login.

The default `ask` mode explicitly selects **Ask before editing**, prefixes the
question with a read-only instruction and leaves every approval untouched.
`edit` explicitly selects **Automatically edit** and may click **Allow for this
conversation**. Static command metadata is `write` because this same command can
authorize edits and submits a persisted conversation. The adapter does not create
Lee tokens, change permissions, log in, or bypass security verification.

`--zone` adds an explicit zone scope to the prompt. It does not select a different
account or grant access. The signed-in dashboard account must already have access.

Every invocation starts a new conversation. CDP `Page.bringToFront` activates the
owned remote tab; `document.visibilityState` must actually be `visible`. No
visibility getter is overridden. This is necessary because Lee's panel may not
render in a hidden tab. Use a dedicated remote browser, rather than a human's
desktop browser.

JSON returns a row with `response`, `worked`, `mode` and `zone`. Plain output
exports the same fields. Completion requires a visible **Worked …** marker, response
text after it, no busy/approval controls, and three matching observations.
`--timeout` defaults to 180 seconds. Partial output is never reported as success.
After a timeout or uncertain approval, inspect the conversation before retrying.

## Validation status

The control flow and extraction have synthetic DOM regression tests; these are
not captured Cloudflare fixtures. Authenticated selectors (new-conversation
control, mode menu, approval placement, Worked/answer layout) still need a live
signed-in probe. Missing or ambiguous controls fail closed.

The initial remote OpenCLI 2.0.2 probe reached Cloudflare security verification
and returned `AUTH_REQUIRED` with exit 77 and the login route
`https://dash.cloudflare.com/login`. It did not submit the question or approve a
change. This adapter remains a draft pending authenticated end-to-end validation.

References: [Agent Lee](https://developers.cloudflare.com/agent-lee/) and
[access and permissions](https://developers.cloudflare.com/agent-lee/manage-access/).
