# Kimi

Drive **Kimi** (`kimi.com`) from the terminal through your existing browser session.

**Mode**: 🔐 Browser · **Domain**: `kimi.com`

## Commands

| Command | Description | Access |
|---------|-------------|--------|
| `opencli kimi status` | Check page connection, login state, and current URL | read |
| `opencli kimi account` | Read sidebar account labels | read |
| `opencli kimi usage` | Read Kimi Code console usage, rate limit, membership, and model permission cards | read |
| `opencli kimi history` | List visible sidebar conversations | read |
| `opencli kimi detail <id>` | Open a chat by ID or trusted `/chat/<id>` URL and read messages | read |
| `opencli kimi read` | Read messages in the current or selected chat | read |
| `opencli kimi send <prompt>` | Send a prompt without waiting for the assistant reply | write |
| `opencli kimi ask <prompt>` | Send a prompt and wait for the assistant reply | write |
| `opencli kimi new` | Start a new chat | write |
| `opencli kimi model` | Read, list, or switch the active model | write |
| `opencli kimi mode [name]` | List or navigate to a Kimi work mode | write |
| `opencli kimi copy-message` | Copy or return the last assistant message | write |
| `opencli kimi react` | Like or dislike the last assistant message | write |
| `opencli kimi regenerate` | Regenerate the last assistant message | write |
| `opencli kimi share` | Open the share dialog for the last assistant message | write |
| `opencli kimi history-rename --yes` | Rename a chat from the history page | write |
| `opencli kimi sidebar-toggle` | Toggle the sidebar | write |
| `opencli kimi view-all-history` | Navigate to the full history page | write |
| `opencli kimi settings` | Open settings | write |
| `opencli kimi sign-out --yes` | Sign out from settings | write |
| `opencli kimi upgrade` | Open the membership/upgrade entry point | write |
| `opencli kimi dismiss-banner` | Close a visible sidebar banner | write |
| `opencli kimi templates` | List template cards on a mode page | read |
| `opencli kimi storage-keys` | List localStorage or sessionStorage keys | read |
| `opencli kimi storage-get <key>` | Read one storage value | read |
| `opencli kimi cookies` | List JavaScript-visible cookies | read |
| `opencli kimi idb-list` | List IndexedDB databases | read |

## Usage Examples

```bash
# Check the current Kimi tab
opencli kimi status

# Read Kimi Code usage cards
opencli kimi usage

# Start a new chat and ask a question
opencli kimi new
opencli kimi ask "Summarize this plan in three bullets"

# Continue the current chat without waiting for a reply
opencli kimi send "Now expand the second bullet"

# List and read conversations
opencli kimi history --limit 10
opencli kimi detail https://kimi.com/chat/<chat-id>
opencli kimi read --conv /chat/<chat-id>

# Inspect or switch model
opencli kimi model
opencli kimi model --list true
opencli kimi model --set "K2"

# Rename a chat only after explicit confirmation
opencli kimi history-rename <chat-id> "New title" --yes true
```

## Options

| Option | Description |
|--------|-------------|
| `prompt` | Prompt to send for `ask` / `send` |
| `--conv` | Chat id, exact `/chat/<id>` path, or trusted `https://kimi.com/chat/<id>` URL for commands that target a chat |
| `--timeout` | Max seconds for `ask` to wait for a reply |
| `--limit` | Max rows for history, read, detail, or storage listings |
| `--set` | Model name to switch to; exact match is preferred, otherwise only a unique partial match is allowed |
| `--list` | Open the model menu and list model options |
| `--yes` | Required for destructive or account-changing commands such as `history-rename` and `sign-out` |

## Behavior

- Kimi commands use a persistent browser site session and operate on the live `kimi.com` UI.
- `usage` navigates to the Kimi Code console and reads the visible dashboard cards without writing account state.
- Chat ids accept bare ids, exact relative `/chat/<id>` paths, or `https://kimi.com/chat/<id>` / `https://www.kimi.com/chat/<id>` URLs only.
- `send` / `ask` verify that a new user turn containing the prompt appears after clicking Send.
- `ask` waits for an assistant turn to appear and stabilize; timeout is reported as a typed timeout instead of a successful row.
- Model switching rejects ambiguous partial matches before clicking and verifies the selected model by reading the UI back.
- `copy-message --click-button` writes to the local clipboard, so the command is marked as write access.

## Prerequisites

- Chrome is running
- You are already signed into `kimi.com`
- [Browser Bridge extension](/guide/browser-bridge) is installed

## Caveats

- This adapter targets the Kimi web UI and can break when Kimi changes DOM structure, labels, or SVG names.
- Sidebar/history commands only see conversations that the current UI has rendered.
- Cookie output is limited to cookies visible to JavaScript; httpOnly cookies are intentionally not exposed.
