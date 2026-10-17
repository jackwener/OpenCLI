---
title: OpenCLI vs agent-browser — Browser Automation and Migration
description: OpenCLI is an agent-browser alternative for AI browser automation. Compare the workflow and migrate navigation, page inspection, clicks, forms, and extraction without site adapters.
---

# OpenCLI vs agent-browser

**OpenCLI is a general-purpose browser automation CLI and an alternative to agent-browser for AI agent browsing.** Use `opencli browser` to navigate websites, inspect page state, click, fill forms, extract content, and take screenshots. A site does not need a pre-built adapter.

OpenCLI also provides reusable site commands. These extend its browser capabilities; the adapter catalog is not the boundary of what an agent can browse.

## Can OpenCLI replace agent-browser?

Yes, for workflows built around the **observe → act → observe** browser loop. An agent can operate an unfamiliar website directly through OpenCLI, including multi-step navigation and form entry. It does not have to generate an adapter first.

The CLI syntax, element references, session lifecycle, and output formats differ. Migrate the actions in your workflow and verify the result; existing agent-browser scripts are not command-line compatible. If a workflow depends on a specialized flag or runtime feature, check that requirement individually rather than assuming complete feature parity.

## Two ways to operate a website

| Need | OpenCLI interface | Site adapter required? |
|------|-------------------|------------------------|
| Explore an unfamiliar site or complete a one-off browser task | `opencli browser <session> <command>` | No |
| Navigate, inspect, click, fill, extract, or screenshot | `opencli browser` primitives | No |
| Run a ready-made site command with a structured schema | `opencli <site> <command>` | Yes |
| Reuse a recurring workflow as a command | Author a site adapter | Only for packaging the workflow |

Both browser primitives and adapter commands execute without built-in LLM inference. An AI agent choosing browser actions still has its own model usage. Adapter commands can reduce the number of actions the agent needs to plan.

## Start browsing without an adapter

Install OpenCLI and the [Browser Bridge extension](./browser-bridge), then check the connection:

```bash
npm install -g @jackwener/opencli
opencli doctor
npx skills add jackwener/opencli --skill opencli-browser
```

Run the browser loop with a named session:

```bash
opencli browser --session work open https://example.com
opencli browser --session work state
opencli browser --session work extract
opencli browser --session work screenshot /tmp/opencli-example.png
opencli browser --session work close
```

Reuse `work` across commands to preserve the session. `state` returns interactive elements with numeric references. On a page with an interactive element, use a reference from the latest state:

```bash
opencli browser --session work click 12
opencli browser --session work state
```

`12` is an illustrative reference, not a fixed element on example.com. Inspect state again after navigation or page changes. `close` releases the session's tab lease; do not assume it has the same lifecycle semantics as another tool's browser shutdown.

## Command migration reference

The agent-browser examples below follow its [upstream README](https://github.com/vercel-labs/agent-browser#quick-start). Element references are specific to each tool's current page snapshot.

| Task | agent-browser | OpenCLI |
|------|---------------|---------|
| Navigate | `agent-browser open https://example.com` | `opencli browser --session work open https://example.com` |
| Inspect interactive elements | `agent-browser snapshot` | `opencli browser --session work state` |
| Click an observed element | `agent-browser click @e2` | `opencli browser --session work click 2` |
| Fill an input | `agent-browser fill "#email" "test@example.com"` | `opencli browser --session work fill "#email" "test@example.com"` |
| Press a key | `agent-browser press Enter` | `opencli browser --session work keys Enter` |
| Read page content | `agent-browser get text body` | `opencli browser --session work extract` |
| Take a screenshot | `agent-browser screenshot page.png` | `opencli browser --session work screenshot page.png` |
| Run page JavaScript | `agent-browser eval "document.title"` | `opencli browser --session work eval "document.title"` |
| End the session | `agent-browser close` | `opencli browser --session work close` |

Use `opencli browser --help` and `opencli browser work <command> --help` for current options. Do not copy `@e2` into OpenCLI or assume reference `2` identifies the same element in both tools.

## When are adapters useful?

If an agent needs a site's trending posts every day, `opencli bilibili hot -f json` can replace repeated browser exploration with one structured command. If the site has no adapter, the agent can still browse it immediately. Add an adapter when the workflow benefits from a reusable interface.

See [Getting Started](./getting-started), [the broader tool comparison](../comparison), and [Extending OpenCLI](./extending-opencli).
