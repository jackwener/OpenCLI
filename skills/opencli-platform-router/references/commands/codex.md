# codex

## Commands

### ask
- 用途：Send a prompt and wait for the AI response (send + wait + read)
- 参数：
  - `text`（必填）：Prompt to send
  - `timeout`（可选）：默认值 60)'；Max seconds to wait for response (default: 60)
- 用法：`opencli codex ask [options] -f json`

### dump
- 用途：Dump the DOM and Accessibility tree of Codex for reverse-engineering
- 参数：无
- 用法：`opencli codex dump [options] -f json`

### export
- 用途：Export the current Codex conversation to a Markdown file
- 参数：
  - `output`（可选）：默认值 /tmp/codex-export.md)'；Output file (default: /tmp/codex-export.md)
- 用法：`opencli codex export [options] -f json`

### extract-diff
- 用途：Extract visual code review diff patches from Codex
- 参数：无
- 用法：`opencli codex extract-diff [options] -f json`

### history
- 用途：List recent conversation threads in Codex
- 参数：无
- 用法：`opencli codex history [options] -f json`

### model
- 用途：Get or switch the currently active AI model in Codex Desktop
- 参数：
  - `model-name`（可选）：The ID of the model to switch to (e.g. gpt-4)
- 用法：`opencli codex model [options] -f json`

### new
- 用途：Start a new Codex conversation thread / isolated workspace
- 参数：无
- 用法：`opencli codex new [options] -f json`

### read
- 用途：Read the contents of the current Codex conversation thread
- 参数：无
- 用法：`opencli codex read [options] -f json`

### screenshot
- 用途：Capture a snapshot of the current Codex window (DOM + Accessibility tree)
- 参数：
  - `output`（可选）：默认值 /tmp/codex-snapshot.txt)'；Output file path (default: /tmp/codex-snapshot.txt)
- 用法：`opencli codex screenshot [options] -f json`

### send
- 用途：Send text/commands to the Codex AI composer
- 参数：
  - `text`（必填）：Text, command (e.g. /review), or skill (e.g. $imagegen)
- 用法：`opencli codex send [options] -f json`

### status
- 用途：Check active CDP connection to OpenAI Codex App
- 参数：无
- 用法：`opencli codex status [options] -f json`
