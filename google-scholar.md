# Google Scholar

**Mode**: 🌐 Public · **Domain**: `scholar.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli google-scholar search <query>` | Search Google Scholar papers by keyword |
| `opencli google-scholar cite <query>` | Fetch a citation export for a Scholar search result |
| `opencli google-scholar profile <author>` | Open an author profile and list top papers |

## Usage Examples

```bash
opencli google-scholar search "transformer"
opencli google-scholar search "retrieval augmented generation" --limit 5
opencli google-scholar cite "attention is all you need" --style bibtex
opencli google-scholar profile "Yann LeCun" --limit 5
```

## Notes

- Uses browser DOM extraction over public Google Scholar results
- Availability can vary by region or anti-bot challenges
