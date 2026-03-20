# ChatGPT

Control the **ChatGPT macOS Desktop App** directly from the terminal. OpenCLI supports two automation approaches for ChatGPT.

## Approach 1: AppleScript (Default, No Setup)

The current built-in commands use native AppleScript automation — no extra launch flags needed.

### Prerequisites
1. Install the official [ChatGPT Desktop App](https://openai.com/chatgpt/mac/) from OpenAI.
2. Grant **Accessibility permissions** to your terminal app in **System Settings → Privacy & Security → Accessibility**.

### Commands
- `opencli chatgpt status`: Check if the ChatGPT app is currently running.
- `opencli chatgpt new`: Activate ChatGPT and press `Cmd+N` to start a new conversation.
- `opencli chatgpt send "message"`: Copy your message to clipboard, activate ChatGPT, paste, and submit.
- `opencli chatgpt read`: Copy the last AI response via `Cmd+Shift+C` and return it as text.

## Approach 2: CDP (Advanced, Electron Debug Mode)

ChatGPT Desktop is also an Electron app and can be launched with a remote debugging port:

```bash
/Applications/ChatGPT.app/Contents/MacOS/ChatGPT \
  --remote-debugging-port=9224
```

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9224"
```

> The CDP approach enables future advanced commands like DOM inspection, model switching, and code extraction.

## How It Works

- **AppleScript mode**: Uses `osascript` and `pbcopy`/`pbpaste` for clipboard-based text transfer.
- **CDP mode**: Connects via Chrome DevTools Protocol to the Electron renderer process.

## Limitations

- macOS only (AppleScript dependency)
- AppleScript mode requires Accessibility permissions
- `read` command copies the last response — earlier messages need manual scroll
