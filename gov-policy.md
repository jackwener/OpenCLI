# Gov Policy

**Mode**: 🌐 Public · **Domain**: `www.gov.cn` / `sousuo.www.gov.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli gov-policy search <query>` | Search policy documents on gov.cn |
| `opencli gov-policy recent` | List the latest State Council policy documents |

## Usage Examples

```bash
opencli gov-policy search "科技创新"
opencli gov-policy recent --limit 10
```

## Notes

- Both commands run in browser mode over public pages
- `search` uses the gov.cn policy search endpoint with `dataTypeId=107`
