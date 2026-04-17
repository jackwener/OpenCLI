# 幕布 (Mubu)

**Mode**: 🔐 Browser · **Domain**: `mubu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli mubu doc` | 读取文档内容（Markdown / 纯文本） |
| `opencli mubu docs` | 列出文档和文件夹 |
| `opencli mubu notes` | 读取速记（今日 / 指定日期范围） |
| `opencli mubu recent` | 最近编辑的文档 |
| `opencli mubu search` | 全文搜索文档节点 |

## Usage Examples

```bash
# Read a document in Markdown (default)
opencli mubu doc <doc-id>

# Read a document as plain text
opencli mubu doc <doc-id> --output text

# List documents in root folder
opencli mubu docs

# List starred (quick-access) documents
opencli mubu docs --starred

# List documents in a specific folder
opencli mubu docs --folder <folder-id>

# Read today's daily notes
opencli mubu notes

# Read notes for a specific date
opencli mubu notes --date 2026-04-10

# Read notes for an entire month
opencli mubu notes --month 2026-04

# List note dates with entry counts (no content)
opencli mubu notes --list --month 2026-04

# Read notes for a custom date range
opencli mubu notes --from 2026-01-01 --to 2026-03-31

# Show recently edited documents
opencli mubu recent --limit 10

# Full-text search
opencli mubu search "关键词"

# JSON output
opencli mubu docs -f json
```

## Prerequisites

- Chrome running and **logged into** mubu.com
- [Browser Bridge extension](/guide/browser-bridge) installed
