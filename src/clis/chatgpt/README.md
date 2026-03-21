# ChatGPT Adapter

Control the **ChatGPT Desktop App** from the terminal.

## Current reality

- **Default fallback**: macOS AppleScript / Accessibility automation
- **Experimental CDP path**: when `OPENCLI_CDP_ENDPOINT` is set, `chatgpt status`, `chatgpt read`, `chatgpt reasoning`, and `chatgpt send` use CDP instead
- **Async by default**: `chatgpt send` only submits the prompt and returns `Submitted`; use `chatgpt read` later to fetch output
- **Windows / WSL support**: experimental and CDP-only for this pass
- **Still AppleScript/macOS only**: `chatgpt new`, `chatgpt ask`
- **Reasoning picker scope**: experimental CDP currently targets only the top-level `Instant` / `Thinking` / `Pro` picker (`auto` aliases to `instant`)
- **Current caveat**: some Windows desktop builds can leave long-running Pro requests in a busy / partially rendered state for minutes

### Recommended async flow

```bash
opencli chatgpt send --reasoning pro "Research this carefully and take your time"
opencli chatgpt status   # optional: Busy=Yes while ChatGPT is still working
opencli chatgpt read     # later, fetch the current visible output
```

📖 **Full documentation**: [docs/adapters/desktop/chatgpt](../../../docs/adapters/desktop/chatgpt.md)
