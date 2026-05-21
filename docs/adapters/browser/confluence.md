# Confluence

**Mode**: 🔑 Atlassian REST API · **Domain**: configured with `ATLASSIAN_CONFLUENCE_BASE_URL`

Read, search, create, and update Confluence pages through Atlassian REST APIs. The adapter supports Confluence Cloud and Confluence Data Center without driving a browser session.

## Commands

| Command | Description |
|---------|-------------|
| `opencli confluence page <PAGE_ID>` | Page detail with storage and Markdown body |
| `opencli confluence search <CQL>` | Search content with CQL |
| `opencli confluence create` | Create a page from Markdown or storage XHTML |
| `opencli confluence update <PAGE_ID>` | Update a page body from Markdown or storage XHTML |

## Configuration

```bash
export ATLASSIAN_CONFLUENCE_BASE_URL=https://example.atlassian.net/wiki
export ATLASSIAN_DEPLOYMENT=cloud      # cloud | datacenter | auto
export ATLASSIAN_EMAIL=you@example.com
export ATLASSIAN_API_TOKEN=...
```

For Data Center, use a personal access token when available:

```bash
export ATLASSIAN_CONFLUENCE_BASE_URL=https://confluence.example.com
export ATLASSIAN_DEPLOYMENT=datacenter
export ATLASSIAN_PAT=...
```

Cloud page reads and writes use Confluence REST API v2. CQL search is still exposed through Confluence REST API v1, so `search` intentionally uses the v1 search endpoint for both Cloud and Data Center.

## Usage Examples

```bash
# Read a page
opencli confluence page 123456 -f json

# Search pages in a space
opencli confluence search "type = page and title ~ \"RCA\"" --space ENG --limit 20 -f json

# Create a page from Markdown
opencli confluence create --space 987654 --title "PROJ-123 RCA" --file rca.md --execute

# Update an existing page
opencli confluence update 123456 --file rca.md --version-message "Sync from Jira PROJ-123" --execute
```

## Write Safety

`create` and `update` require `--execute`. Without it, the adapter fails before sending a remote write.

For Cloud, `--space` expects a space id. For Data Center, `--space` expects a space key. `--parent` can be used to place a new page under an existing page id.

## Input Formats

Markdown is the default input format:

```bash
opencli confluence create --space 987654 --title "Runbook" --file runbook.md --execute
```

To provide Confluence storage XHTML directly:

```bash
opencli confluence update 123456 --file page.storage.html --representation storage --execute
```

## Notes

- `update` reads the current page version first and submits `version.number + 1`.
- Markdown conversion covers headings, paragraphs, links, inline code, code blocks, flat and nested lists, and basic tables.
- Expected auth, rate-limit, version-conflict, argument, and not-found failures are normalized to `CliError` subclasses.
