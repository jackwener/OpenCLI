# ChatWise

Control the **ChatWise Desktop App** from the terminal via Chrome DevTools Protocol (CDP). ChatWise is an Electron-based multi-LLM client supporting GPT-4, Claude, Gemini, and more.

## Prerequisites

1. Install [ChatWise](https://chatwise.app/).
2. Launch with remote debugging port:
   ```bash
   /Applications/ChatWise.app/Contents/MacOS/ChatWise \
     --remote-debugging-port=9228
   ```

## Setup

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9228"
```

## Commands

### Diagnostics
- `opencli chatwise status`: Check CDP connection status.
- `opencli chatwise screenshot`: Export DOM + accessibility snapshot.

### Chat
- `opencli chatwise new`: Start a new conversation (`Cmd+N`).
- `opencli chatwise send "message"`: Send a message to the active chat.
- `opencli chatwise read`: Read the current conversation.
- `opencli chatwise ask "prompt"`: Send + wait for response + return it (one-shot).

### AI Features
- `opencli chatwise model`: Get the current AI model.
- `opencli chatwise model gpt-4`: Switch to a different model.

### Organization
- `opencli chatwise history`: List conversations from the sidebar.
- `opencli chatwise export`: Export conversation as Markdown.
