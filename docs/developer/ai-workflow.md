# AI Workflow

OpenCLI is designed with AI agents in mind. This guide covers the AI-native discovery and code generation tools.

## Quick Mode (One-Shot)

Generate a single command for a specific page URL — just a URL + one-line goal, 4 steps done:

```bash
opencli generate https://example.com --goal "trending"
```

This runs: explore → synthesize → register in one shot.

For the complete one-shot workflow details, see [CLI-ONESHOT.md](https://github.com/jackwener/opencli/blob/main/CLI-ONESHOT.md).

## Full Mode (Explorer Workflow)

### Step 1: Deep Explore

Discover APIs, infer capabilities, and detect framework:

```bash
opencli explore https://example.com --site mysite
```

Outputs to `.opencli/explore/<site>/`:
- `manifest.json` — Site metadata
- `endpoints.json` — Discovered API endpoints
- `capabilities.json` — Inferred capabilities
- `auth.json` — Authentication strategy details

### Step 2: Synthesize

Generate YAML adapters from explore artifacts:

```bash
opencli synthesize mysite
```

### Step 3: Strategy Cascade

Auto-probe authentication strategies: `PUBLIC → COOKIE → HEADER`:

```bash
opencli cascade https://api.example.com/data
```

### Step 4: Validate & Test

```bash
opencli validate                           # Validate generated YAML
opencli <site> <command> --limit 3 -f json # Test the command
```

## 5-Tier Authentication Strategy

The explorer uses a decision tree to determine the best authentication approach:

1. **PUBLIC** — No auth, direct API call
2. **COOKIE** — Reuse Chrome session cookies
3. **HEADER** — Custom auth headers
4. **BROWSER** — Full browser automation
5. **CDP** — Chrome DevTools Protocol for Electron apps

For the complete browser exploration workflow and debugging guide, see [CLI-EXPLORER.md](https://github.com/jackwener/opencli/blob/main/CLI-EXPLORER.md).
