# Trae SOLO

Control **Trae SOLO** from OpenCLI through the Electron debug port and read its local VSCode-style state files.

**Mode**: Desktop app / local filesystem · **App**: `TRAE SOLO`

## Commands

| Command | Description | Access |
|---------|-------------|--------|
| `opencli trae-solo status` | Check whether the Trae SOLO desktop app is reachable | read |
| `opencli trae-solo history` | List visible projects and tasks from the Trae SOLO sidebar | read |
| `opencli trae-solo model [name]` | Read, list, or switch the active model in an open task | write when switching |
| `opencli trae-solo mode [code\|work]` | Read or switch between Code and Work mode | write when switching |
| `opencli trae-solo automation-list` | Read visible Automation tab entries | read |
| `opencli trae-solo skill-list` | List marketplace or installed skills from the Skills panel | read |
| `opencli trae-solo skill-search <keyword>` | Search visible marketplace skills | read |
| `opencli trae-solo skill-category [name]` | List or filter marketplace skill categories | read |
| `opencli trae-solo storage-keys` | List renderer `localStorage` / `sessionStorage` keys | read |
| `opencli trae-solo storage-get <key>` | Read a renderer storage value | read |
| `opencli trae-solo cookies` | List JavaScript-visible renderer cookies with truncated previews | read |
| `opencli trae-solo idb-list` | List renderer IndexedDB database names | read |
| `opencli trae-solo state-keys` | List keys in Trae SOLO `state.vscdb` | read |
| `opencli trae-solo state-get <key>` | Read a key from `state.vscdb` | read |
| `opencli trae-solo recent-workspaces` | Show recently opened workspaces from local state | read |
| `opencli trae-solo workspaces-list` | List workspaceStorage entries and resolved workspace targets | read |
| `opencli trae-solo extensions-list` | List installed VSCode-compatible extensions | read |
| `opencli trae-solo task-fs-list` | List on-disk Trae SOLO task ids | read |
| `opencli trae-solo task-fs-turns <task-id>` | List chat-turn git tags for a task snapshot | read |
| `opencli trae-solo task-fs-show <task-id>` | Show the workspace tree at a chat-turn ref | read |
| `opencli trae-solo skill-fs-list` | List local skill directories under `~/.trae/skills` | read |
| `opencli trae-solo skill-fs-installed` | List skills registered in `skill-config.json` | read |
| `opencli trae-solo skill-fs-show <name>` | Show a local skill's `SKILL.md` head and metadata | read |
| `opencli trae-solo settings-read` | Read user `settings.json` with JSONC comments/trailing commas | read |
| `opencli trae-solo user-rules` | Read `~/.trae/user_rules.md` | read |

Write-side UI commands that only proved button clicks were intentionally left out. New task creation, task open/navigation, message actions, skill install/uninstall/run/toggle, automation creation, and filesystem deletion need explicit postconditions before they can be exposed safely.

## Examples

```bash
opencli trae-solo status
opencli trae-solo history --limit 20
opencli trae-solo model --list true
opencli trae-solo model "Claude"
opencli trae-solo mode work

opencli trae-solo skill-search "python"
opencli trae-solo automation-list --tab task-template

opencli trae-solo state-keys --filter workbench
opencli trae-solo recent-workspaces
opencli trae-solo task-fs-list --limit 20
```

## Notes

- Electron UI commands require Trae SOLO to be running with the configured CDP port. OpenCLI launches registered Electron apps with the app-specific debug port when needed.
- Renderer storage reads come from the current Electron renderer and may be empty if the app has not loaded the relevant workspace.
- Filesystem reads are local-only and read Trae SOLO state under `~/.trae` and `~/Library/Application Support/TRAE SOLO`.
- `model` and `mode` verify the visible post-action state before returning success.
