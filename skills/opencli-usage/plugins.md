# Plugin System & Advanced Features

## Management Commands

```bash
opencli list                # List all commands (including External CLIs)
opencli list --json         # JSON output
opencli list -f yaml        # YAML output
opencli install <name>      # Auto-install an external CLI (e.g., gh, obsidian)
opencli register <name>     # Register a local custom CLI for unified discovery
opencli validate            # Validate all CLI definitions
opencli validate bilibili   # Validate specific site
opencli doctor              # Diagnose browser bridge (auto-starts daemon, includes live test)
```

## AI Agent Workflow

```bash
# Deep Explore: network intercept → response analysis → capability inference
opencli explore <url> --site <name>

# Synthesize: generate evaluate-based YAML pipelines from explore artifacts
opencli synthesize <site>

# Generate: one-shot explore → synthesize → register
opencli generate <url> --goal "hot"

# Record: YOU operate the page, opencli captures every API call → YAML candidates
opencli record <url>                            # 录制，site name 从域名推断
opencli record <url> --site mysite             # 指定 site name
opencli record <url> --timeout 120000          # 自定义超时（毫秒，默认 60000）
opencli record <url> --poll 1000               # 缩短轮询间隔（毫秒，默认 2000）
opencli record <url> --out .opencli/record/x   # 自定义输出目录

# Strategy Cascade: auto-probe PUBLIC → COOKIE → HEADER
opencli cascade <api-url>

# Explore with interactive fuzzing (click buttons to trigger lazy APIs)
opencli explore <url> --auto --click "字幕,CC,评论"

# Validate: validate adapter definitions
opencli validate
```

## Output Formats

All built-in commands support `--format` / `-f` with `table`, `json`, `yaml`, `md`, and `csv`.

```bash
opencli list -f yaml            # YAML command registry
opencli bilibili hot -f table   # Default: rich table
opencli bilibili hot -f json    # JSON (pipe to jq, feed to AI agent)
opencli bilibili hot -f yaml    # YAML (readable structured output)
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
```

## Verbose Mode

```bash
opencli bilibili hot -v         # Show each pipeline step and data flow
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLI_DAEMON_PORT` | 19825 | Daemon listen port |
| `OPENCLI_BROWSER_CONNECT_TIMEOUT` | 30 | Browser connection timeout (sec) |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | 45 | Command execution timeout (sec) |
| `OPENCLI_BROWSER_EXPLORE_TIMEOUT` | 120 | Explore timeout (sec) |
| `OPENCLI_VERBOSE` | — | Show daemon/extension logs |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `npx not found` | Install Node.js: `brew install node` |
| `Extension not connected` | 1) Chrome must be open 2) Install opencli Browser Bridge extension |
| `Target page context` error | Add `navigate:` step before `evaluate:` in YAML |
| Empty table data | Check if evaluate returns correct data path |
| Daemon issues | `curl localhost:19825/status` to check, `curl localhost:19825/logs` for extension logs |
