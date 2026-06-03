# Whitelist

Control which commands are **visible** and **executable** by configuring a whitelist. Commands not in the whitelist are entirely unavailable — they won't appear in `opencli list`, and running them directly (e.g. `opencli <site>`) will show `error: unknown command`.

Use `opencli list --all` to bypass the whitelist for display purposes.

## Configuration File

The whitelist is defined in `~/.opencli/whitelist.yaml`. Create this file if it doesn't exist.

## Configuration Format

Whitelist uses YAML array format. Each entry is either a site name (all commands enabled) or a site with comma-separated commands (only those commands enabled):

```yaml
sites:
  - bilibili              # All bilibili commands
  - reddit: hot, popular  # Only hot and popular
  - twitter: timeline, trending, search
```

### Enable Entire Site

List just the site name:

```yaml
sites:
  - bilibili
  - hackernews
```

### Enable Specific Commands

Use `site: command1, command2, ...` format:

```yaml
sites:
  - bilibili: hot, search
  - twitter: timeline, trending
```

Only `opencli bilibili hot`, `opencli bilibili search`, `opencli twitter timeline`, and `opencli twitter trending` are available. Any other bilibili or twitter commands are hidden and cannot be executed.

## Examples

### Mix Entire Sites and Specific Commands

```yaml
sites:
  - bilibili              # All bilibili commands
  - reddit: hot, popular  # Only these reddit commands
  - hackernews             # All hackernews commands
```

### Hide a Site Completely

Simply omit the site from the configuration. Running `opencli reddit` will report `unknown command`.

```yaml
sites:
  - bilibili: hot
  # reddit is not listed — all reddit commands are hidden and unusable
```

## Default Behavior

When no whitelist configuration exists (the file doesn't exist or `sites` is not an array), all registered commands are visible and executable. The whitelist only restricts what would otherwise be available.

## Execution Behavior

- **Hidden from list**: Commands not in the whitelist won't show in `opencli list`.
- **Cannot be executed**: Running a non-whitelisted command (e.g. `opencli zhihu hot`) reports `error: unknown command`.
- **Unknown site**: Running a non-whitelisted site (e.g. `opencli zhihu`) reports `error: unknown command '<site>'`.
- **Temporary bypass**: `opencli list --all` shows every registered command but does not affect execution — non-whitelisted commands still cannot be run.

## External CLIs

The whitelist only affects built-in OpenCLI commands and adapters. External CLIs registered via `opencli external register` (e.g. `gh`, `docker`) are not affected — they always appear and can always be executed regardless of the whitelist settings.

## Related Commands

- `opencli list` — View available commands (filtered by whitelist if configured)
- `opencli list --all` — View all commands, ignoring whitelist for display
- `opencli external register` — Register external CLI tools (not affected by whitelist)