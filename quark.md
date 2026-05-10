# Quark Drive

**Mode**: 🔐 Browser · **Domain**: `pan.quark.cn`

## Prerequisites

- [Browser Bridge extension](/guide/browser-bridge) installed
- Logged in to Quark Drive (`pan.quark.cn`) in Chrome

## Commands

| Command | Description |
|---------|-------------|
| `opencli quark ls [path]` | List files in your Quark Drive |
| `opencli quark mkdir <name>` | Create a folder |
| `opencli quark mv <fids>` | Move files to a folder |
| `opencli quark rename <fid>` | Rename a file or folder |
| `opencli quark rm <fids>` | Delete files |
| `opencli quark save <url>` | Save shared files to your Drive |
| `opencli quark share-tree <url>` | Get directory tree from a share link as nested JSON |

## Usage Examples

```bash
# List root directory
opencli quark ls

# List a specific folder with depth 3
opencli quark ls "Documents/Projects" --depth 3

# Create a folder in root
opencli quark mkdir "New Folder"

# Create a folder inside a specific parent (by path)
opencli quark mkdir "Sub Folder" --parent "Documents"

# Create a folder inside a specific parent (by fid)
opencli quark mkdir "Sub Folder" --parent-fid <fid>

# Move files to a folder
opencli quark mv "fid1,fid2" --to "Documents"

# Rename a file
opencli quark rename <fid> --name "new-name.txt"

# Delete files
opencli quark rm "fid1,fid2"

# Save all files from a share link
opencli quark save https://pan.quark.cn/s/abc123 --to "来自：分享"

# Save specific files by fid (get fids from share-tree)
opencli quark save https://pan.quark.cn/s/abc123 --to "My Folder" --fids "fid1,fid2" --stoken <stoken>

# Save to a specific folder by fid
opencli quark save https://pan.quark.cn/s/abc123 --to-fid <fid>

# Move files to a folder by fid
opencli quark mv "fid1,fid2" --to-fid <fid>

# Get full tree from a share link
opencli quark share-tree https://pan.quark.cn/s/abc123
```

## Notes

- `share-tree` returns a `stoken` value that is required when using `save --fids` to save specific files from a share link.
- `--to` resolves a folder path by name; `--to-fid` uses a folder ID directly. These flags cannot be combined.
