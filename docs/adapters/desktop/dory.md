# Dory

Control the **Dory Desktop App** headless or headfully via Chrome DevTools Protocol (CDP). Because Dory is built on Electron, OpenCLI can directly drive its internal UI, send messages to the AI chat, read responses, and manage sessions.

## Prerequisites

1. You must have the official Dory app installed.
2. Launch it via the terminal and expose the remote debugging port:
   ```bash
   # macOS
   /Applications/Dory.app/Contents/MacOS/Dory --remote-debugging-port=9300
   ```

## Setup

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9300"
```

## Commands

### Diagnostics
- `opencli dory status` — Check CDP connection, current URL and page title.
- `opencli dory dump` — Dump the full DOM and accessibility tree to `/tmp/dory-dom.html` and `/tmp/dory-snapshot.json`.
- `opencli dory screenshot` — Capture DOM + accessibility snapshot to `/tmp/dory-snapshot-dom.html` and `/tmp/dory-snapshot-a11y.txt`.

### Connection Management
- `opencli dory connections` — List all database connections.
- `opencli dory connect <connectionId>` — Navigate to the SQL console for a specific connection.
- `opencli dory databases <connectionId>` — List all databases available for a connection.

### Schema Exploration
- `opencli dory tables <connectionId> <database>` — List tables in a database.
  - Optional: `--schema <name>` to filter by schema.
- `opencli dory columns <connectionId> <database> <table>` — List columns for a specific table.
- `opencli dory table-preview <connectionId> <database> <table>` — Preview rows from a table.
  - Optional: `--limit 100` (default: 50).

### SQL Queries
- `opencli dory query "SQL" --connection <id>` — Execute SQL and print results.
  - Optional: `--database <name>` to set the active database.
- `opencli dory query-export "SQL" --connection <id>` — Execute SQL and save results as CSV.
  - Optional: `--database <name>`, `--output /path/to/file.csv` (default: `/tmp/dory-query.csv`).

### Charts
- `opencli dory chart-download` — Download the currently visible chart.
  - Optional: `--image-format png` or `--image-format svg` (default: `svg`).
  - Optional: `--output /path/to/file.svg` (default: `/tmp/dory-chart.svg`).
  - *Note: switch the result table to "Charts" view first before running this command.*

### Chat (AI Assistant)
All chat commands accept an optional `--connection <id>` flag. If provided, the app automatically navigates to the chatbot page for that connection before executing.

- `opencli dory send "message" [--connection <id>]` — Inject text into the chat composer and submit.
- `opencli dory ask "message" [--connection <id>]` — Send a message, wait for the AI response, and print it.
  - Optional: `--timeout 120` to wait up to 120 seconds (default: 60).
- `opencli dory read [--connection <id>]` — Extract the full conversation thread (user + assistant messages).
- `opencli dory export [--connection <id>]` — Export the current conversation to a Markdown file.
  - Optional: `--output /path/to/file.md` (default: `/tmp/dory-export.md`).

### Session Management
- `opencli dory new [--connection <id>]` — Create a new chat session.
- `opencli dory sessions [--connection <id>]` — List recent chat sessions shown in the sidebar.

## Example Workflows

### Explore a database
```bash
# List all connections (shows names)
opencli dory connections

# List databases — use the connection name directly
opencli dory databases "My Postgres"

# List tables
opencli dory tables "My Postgres" my_db

# Inspect columns of a table
opencli dory columns "My Postgres" my_db users

# Preview rows
opencli dory table-preview "My Postgres" my_db users --limit 20
```

### Run queries and export
```bash
# Navigate to the SQL console
opencli dory connect "My Postgres"

# Run a query and print results
opencli dory query "SELECT * FROM orders LIMIT 10" --connection "My Postgres" --database my_db

# Export query results to CSV
opencli dory query-export "SELECT id, name, created_at FROM users" \
  --connection "My Postgres" --database my_db --output ~/users.csv
```

### Render and download a chart
```bash
# Ask the AI to build a chart (auto-navigates to chatbot for this connection)
opencli dory ask "Show me a bar chart of orders by month" --connection "My Postgres"

# In the SQL console, switch to Charts view, then:
opencli dory chart-download --image-format png --output ~/chart.png
```

### AI chat session
```bash
opencli dory ask "What tables are available in the active database?" --connection "My Postgres"
opencli dory read --connection "My Postgres"
opencli dory export --connection "My Postgres" --output ~/dory-session.md
opencli dory new --connection "My Postgres"
```

## Notes

- **Connection names**: all commands that accept a connection argument resolve names to IDs automatically (case-insensitive). You can always pass a raw UUID instead if needed.
- **API commands** (`connections`, `databases`, `tables`, `columns`, `table-preview`, `query`, `query-export`) call Dory's REST API using browser session cookies — no extra authentication needed.
- **`query` / `query-export`**: the `--connection` flag is required; use `opencli dory connections` to find your connection ID.
- **`chart-download`**: finds the first Recharts SVG on the page. If `--format png` fails due to canvas restrictions, it automatically falls back to SVG.
- **Chat commands** (`send`, `ask`, `read`, `export`, `new`, `sessions`) all support `--connection <id>`. When provided, the app automatically navigates to `/[org]/[connectionId]/chatbot` before executing. If omitted and already on a chatbot page, the current page is used.
- **Chat commands** use the native `HTMLTextAreaElement` value setter to properly trigger React's synthetic event system.
- The `ask` command polls every 2 seconds and considers the response complete once the text stabilizes across two consecutive polls.
