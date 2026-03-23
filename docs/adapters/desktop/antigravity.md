# Antigravity

🔥 **CLI All Electron Apps! The Most Powerful Update Has Arrived!** 🔥

Turn your local Antigravity desktop application into a programmable AI node via Chrome DevTools Protocol (CDP). This allows you to compose complex LLM workflows entirely through the terminal by manipulating the actual UI natively, bypassing any API restrictions.

## Prerequisites

Start the Antigravity desktop app with the Chrome DevTools `remote-debugging-port` flag:

```bash
# Start Antigravity in the background
/Applications/Antigravity.app/Contents/MacOS/Electron \
  --remote-debugging-port=9224
```

> Depending on your installation, the executable might be named differently, e.g., `Antigravity` instead of `Electron`.

Then set the target port:

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9224"
```

## Commands

### `opencli antigravity status`
Check the Chromium CDP connection. Returns the current window title and active internal URL.

### `opencli antigravity send <message>`
Send a text prompt to the AI. Automatically locates the Lexical editor input box, types the prompt securely, and hits Enter.

### `opencli antigravity read`
Scrape the entire current conversation history block as pure text.

### `opencli antigravity new`
Click the "New Conversation" button to instantly clear the UI state and start fresh.

### `opencli antigravity dump`
Dump the current DOM and snapshot artifacts to `/tmp` for reverse-engineering and selector debugging.

### `opencli antigravity extract-code`
Extract any multi-line code blocks from the current conversation view. Ideal for automated script extraction (e.g. `opencli antigravity extract-code > script.sh`).

### `opencli antigravity model <name>`
Quickly target and switch the active LLM engine. Example: `opencli antigravity model claude` or `opencli antigravity model gemini`.

### `opencli antigravity watch`
A long-running, streaming process that continuously polls the Antigravity UI for chat updates and outputs them in real-time to standard output.
