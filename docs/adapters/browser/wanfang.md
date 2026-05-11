# Wanfang

**Mode**: 🌐 Public · **Domain**: `s.wanfangdata.com.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli wanfang search <query>` | Search Wanfang papers by keyword |

## Usage Examples

```bash
opencli wanfang search "多模态"
opencli wanfang search "知识图谱" --limit 5
```

## Notes

- Uses browser DOM extraction over public Wanfang search results
- The extractor anchors on `span.title` / `span.authors` rather than unstable obfuscated class names
