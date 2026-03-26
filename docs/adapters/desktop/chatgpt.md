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
- `opencli chatgpt send "message" --model thinking`: Switch model/mode first, then send the message.
- `opencli chatgpt read`: Read the last visible message from the focused ChatGPT window via the Accessibility tree.
- `opencli chatgpt ask "message"`: Send a prompt and wait for the visible reply in one shot.
- `opencli chatgpt ask "message" --model instant`: Run a one-shot prompt using a specific model/mode.
- `opencli chatgpt model thinking`: Switch the active ChatGPT model/mode without sending a message.

Supported model choices: `auto`, `instant`, `thinking`, `5.2-instant`, `5.2-thinking`.

## Approach 2: CDP (Advanced, Electron Debug Mode)

ChatGPT Desktop is also an Electron app and can be launched with a remote debugging port:

```bash
/Applications/ChatGPT.app/Contents/MacOS/ChatGPT \
  --remote-debugging-port=9224
```

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9224"
```

> The CDP approach is primarily for advanced automation and future desktop-only commands. The built-in command set above still works in the default AppleScript path unless you explicitly route through `OPENCLI_CDP_ENDPOINT`.

## How It Works

- **AppleScript mode**: Uses `osascript` to control ChatGPT, `pbcopy`/`pbpaste` to paste prompts, and the macOS Accessibility tree to read visible chat messages.
- **CDP mode**: Connects via Chrome DevTools Protocol to the Electron renderer process.

## Limitations

- macOS only (AppleScript dependency)
- AppleScript mode requires Accessibility permissions
- `read` returns the last visible message in the focused ChatGPT window — scroll first if the message you want is not visible
