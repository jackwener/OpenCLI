# Trae CN

Control the **Trae CN** desktop app from the terminal through Chrome DevTools Protocol (CDP). The adapter targets the active Trae workbench window and can start a fresh task, send prompts, read responses, switch the current model, and monitor long-running task progress.

## Prerequisites

1. Install Trae CN.
2. Launch it with a remote debugging port:

```bash
open -a "Trae CN" --args --remote-debugging-port=39240
```

3. Point OpenCLI at the Trae CDP endpoint:

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:39240"
```

If Trae CN is already running on another remote debugging port, do not restart it just to match this default. Point `OPENCLI_CDP_ENDPOINT` at the port that is currently listening.

If multiple Trae workspaces are open, select the right target by title:

```bash
export OPENCLI_CDP_TARGET="talk"
```

## Commands

### Diagnostics

- `opencli trae-cn setup` — show local launch, environment, verification, task, monitor, and read commands.
- `opencli trae-cn targets` — list Trae CDP targets and show which window/workspace is running or waiting for approval.
- `opencli trae-cn status` — check the active Trae target, workspace, model, agent, turn count, and composer readiness.
- `opencli trae-cn dump` — dump DOM and accessibility snapshot artifacts to `/tmp/trae-cn-dom.html` and `/tmp/trae-cn-snapshot.json`.
- `opencli trae-cn screenshot` — capture DOM and accessibility artifacts for debugging.

### Task Control

- `opencli trae-cn new` — start a fresh task in the current workspace.
- `opencli trae-cn new "prompt"` — start a fresh task and submit the first prompt.
- `opencli trae-cn send "prompt"` — send a prompt into the current task.
- `opencli trae-cn ask "prompt" --timeout 120` — send a prompt, wait for the assistant reply without treating visible approval cards as a final answer, and return it.
- `opencli trae-cn read --limit 5` — read recent visible user and assistant turns.
- `opencli trae-cn export --output /tmp/trae-cn.md` — export recent turns as Markdown.
- `opencli trae-cn approve` — approve a visible terminal-run or delete confirmation prompt.

### Model

- `opencli trae-cn model` — read the current composer model, agent, and workspace.
- `opencli trae-cn select-model "GPT 5.4"` — select a model from the current composer model menu.

### Progress Monitoring

- `opencli trae-cn activity` — read the current task state once.
- `opencli trae-cn watch --duration 60 --interval 2` — sample task state until completion or timeout.
- `opencli trae-cn watch --stream true` — emit one JSON object per sample as JSONL for agent pipelines.
- `opencli trae-cn watch --auto-approve true` — explicitly approve matching terminal/delete prompts while watching.

`watch` defaults to `--stop-on-complete true`, so `--duration` is a maximum observation window. Use `--stop-on-complete false` when you need a fixed-length observation trace.

### Approval Prompts

Trae CN may pause a long task for UI confirmations, especially before running terminal commands or deleting files. `ask` and `watch` do not click approval prompts unless you pass `--auto-approve true`; `approve` clicks the current matching prompt directly. The approval detector is category-based: OpenCLI approves Trae's visible `terminal` confirmation UI and visible `delete` confirmation UI. It is not a semantic command allowlist limited to `rm` or `mv`.

Opt-in approval behavior:

- `terminal` is enabled when you opt in. It clicks ordinary terminal run confirmations, high-risk command-card `运行`, and the follow-up high-risk modal `仍要运行` when Trae exposes them with matching button/context text.
- `delete` is enabled when you opt in. It clicks file deletion cards and the follow-up irreversible delete modal `确认` when Trae exposes them with matching button/context text.
- `keep` is not enabled by default. Use `--approve-kinds keep` only when the intended action is to retain files rather than delete them.
- Unknown prompts are not clicked. Use `opencli trae-cn activity`, `opencli trae-cn targets`, or `opencli trae-cn approve --dry-run true` to inspect them.

Monitor without approval clicks:

```bash
opencli trae-cn watch --stream true --duration 300
```

You can also approve the current visible prompt directly:

```bash
opencli trae-cn approve --approve-kinds terminal,delete -f json
```

Use `--dry-run true` to inspect matching prompts without clicking. Use `--approve-kinds keep` only when the intended action is to keep/retain a file instead of approving deletion.

For long-running agent tasks where you explicitly want OpenCLI to approve terminal/delete prompts while watching:

```bash
opencli trae-cn watch --stream true --duration 300 --auto-approve true
```

The auto-approval detector only clicks visible prompts whose button and surrounding prompt text match the requested approval kinds.

In Trae CN auto-run mode, high-risk shell commands such as `mv` and `rm` can still show confirmation UI. The adapter handles both layers observed in Trae CN: the command card `运行` action and the follow-up `运行风险命令` modal with `仍要运行`.

Observed high-risk patterns include `rm`, `delete`, `unlink`, `shred`, `dd`, `truncate`, `kill`, `chmod`, `mv`, `copy`, `move`, PowerShell write commands, `mkfs`, destructive Git operations, and destructive database commands. If Trae renders any of these as terminal confirmation UI with known wording/buttons, opt-in `watch --auto-approve true` and `ask --auto-approve true` approve them through the `terminal` approval kind. Treat these prompts as current-product UI behavior rather than a stable public API.

When multiple Trae windows are open, use:

```bash
opencli trae-cn targets -f table
OPENCLI_CDP_TARGET=workspace opencli trae-cn watch --stream true --duration 300
```

`targets` is the quickest way to find the row with `ApprovalPending=yes` and copy its `RecommendedTarget` into `OPENCLI_CDP_TARGET`. Confirm the current state with `targets`, `activity`, `watch`, or `read`.

## Notes

- The adapter operates the currently selected Trae workspace target. It does not yet open folders or switch historical conversations.
- `OPENCLI_CDP_TARGET` should be used when multiple Trae windows or workspaces share the same CDP endpoint.
- Trae assistant output may describe model identity differently from the UI. Use `trae-cn status` or `trae-cn model` as the source of truth for the current selected model.
- Sensitive local state under Trae data directories is not required for normal adapter operation.

## Example

```bash
opencli trae-cn setup

OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 \
OPENCLI_CDP_TARGET=talk \
opencli trae-cn new "Please reply only: TRAE_OK"

OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 \
OPENCLI_CDP_TARGET=talk \
opencli trae-cn watch --duration 30 --interval 1 --stream true
```
