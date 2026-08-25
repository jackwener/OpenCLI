# Gmail

**Mode**: 🔐 Browser · **Domain**: `mail.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli gmail whoami` | Show the signed-in Gmail identity |
| `opencli gmail login` | Open Gmail's Google sign-in flow |
| `opencli gmail search <query>` | Search threads with Gmail search syntax |
| `opencli gmail inbox` | List inbox threads |
| `opencli gmail unread` | List unread threads |
| `opencli gmail starred` | List starred threads |
| `opencli gmail sent` | List sent threads |
| `opencli gmail drafts` | List draft threads |
| `opencli gmail trash` | List trashed threads |
| `opencli gmail spam` | List spam threads |
| `opencli gmail snoozed` | List snoozed threads |
| `opencli gmail important` | List important threads |
| `opencli gmail labels` | List system and user labels |
| `opencli gmail thread <thread>` | Read all messages in a thread |
| `opencli gmail attachments <thread>` | List attachment metadata for a thread |

## Usage Examples

```bash
# Search and use the returned threadId to read a conversation
opencli gmail search 'from:alerts@example.com newer_than:30d' --limit 20 -f json
opencli gmail thread 'thread-f:1234567890123456789' -f json

# Common mailbox views and labels
opencli gmail inbox --limit 50
opencli gmail unread --limit 50
opencli gmail labels -f json

# List attachment metadata without downloading files
opencli gmail attachments 'thread-f:1234567890123456789' -f json
```

All list commands accept `--account <index>` for Gmail URLs under `/mail/u/<index>/`. Thread-list commands also accept `--limit` from 1 to 200.

## Output

Search and mailbox views return thread identity, subject, sender, snippet, message count, unread/starred flags, timestamp, and Gmail label ids. `thread` returns one row per message, including recipients, body text, and an attachment array. `attachments` flattens that array to one row per file.

Reads let Gmail perform its normal search/navigation and parse the resulting browser response. Recently cached threads may use the already rendered message containers instead. The adapter does not reconstruct Gmail's private authentication or write requests.

## Prerequisites

- Chrome running and **logged into** Gmail
- [Browser Bridge extension](/guide/browser-bridge) installed
- Use `opencli gmail whoami` to verify the active account before reading mail
