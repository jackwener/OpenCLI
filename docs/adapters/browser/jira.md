# Jira

**Mode**: 🔑 Atlassian REST API · **Domain**: configured with `ATLASSIAN_JIRA_BASE_URL`

Read Jira issues, comments, attachments, and links through Atlassian REST APIs. The adapter supports Jira Cloud and Jira Data Center without driving a browser session.

## Commands

| Command | Description |
|---------|-------------|
| `opencli jira issue <KEY>` | Normalized issue context for agents |
| `opencli jira search <JQL>` | Search issues with JQL |
| `opencli jira comments <KEY>` | Issue comments as Markdown |
| `opencli jira attachments <KEY>` | Issue attachment metadata |
| `opencli jira links <KEY>` | Linked Jira issues |

## Configuration

```bash
export ATLASSIAN_JIRA_BASE_URL=https://example.atlassian.net
export ATLASSIAN_DEPLOYMENT=cloud      # cloud | datacenter | auto
export ATLASSIAN_EMAIL=you@example.com
export ATLASSIAN_API_TOKEN=...
```

For Data Center, use a personal access token when available:

```bash
export ATLASSIAN_JIRA_BASE_URL=https://jira.example.com
export ATLASSIAN_DEPLOYMENT=datacenter
export ATLASSIAN_PAT=...
```

Cloud instances default to Jira REST API v3. Data Center instances use Jira REST API v2. `ATLASSIAN_DEPLOYMENT=auto` treats `*.atlassian.net` as Cloud and other hosts as Data Center.

## Usage Examples

```bash
# Full issue context, including description, comments, attachments, and links
opencli jira issue PROJ-123 -f json

# Search with JQL
opencli jira search "project = PROJ order by updated desc" --limit 20 -f json

# Focused reads
opencli jira comments PROJ-123 -f json
opencli jira attachments PROJ-123 -f json
opencli jira links PROJ-123 -f json
```

## Output Notes

- `issue` returns an agent-friendly object with `key`, `summary`, `status`, `priority`, `description.markdown`, `comments`, `attachments`, `linkedIssues`, versions, components, and timestamps.
- Jira Cloud ADF descriptions and comments are converted to Markdown.
- Rendered Jira HTML from Data Center is converted through OpenCLI's Markdown converter.
- Invalid issue keys fail early with `ArgumentError`.

## Custom Fields

Some Jira fields are instance-specific. Set these environment variables to include them in `jira issue` output:

```bash
export ATLASSIAN_JIRA_ACCEPTANCE_FIELD=customfield_12345
export ATLASSIAN_JIRA_SPRINT_FIELD=customfield_10020
export ATLASSIAN_JIRA_STORY_POINTS_FIELD=customfield_10016
```

## Notes

- The adapter only reads Jira data; it does not generate RCA, design docs, or release notes itself.
- Agents should generate documentation from `jira issue ... -f json`, then write it with the Confluence adapter.
- Expected auth, rate-limit, argument, and not-found failures are normalized to `CliError` subclasses.
