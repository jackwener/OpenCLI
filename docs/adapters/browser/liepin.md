# Liepin

**Mode**: 🔐 Browser · **Domains**: `lpt.liepin.com`, `api-lpt.liepin.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli liepin jobs` | List recruiter jobs |
| `opencli liepin search <query>` | Search the talent pool |
| `opencli liepin recommend` | List recommended candidates for the current recruiter job |
| `opencli liepin chats` | List recent candidate conversations |
| `opencli liepin chat-resumes` | Read resumes voluntarily sent in conversations |
| `opencli liepin intention-orders` | List candidates in Liepin intention communication |
| `opencli liepin greet-search-results <resumeIds>` | Send the configured job greeting to selected search results |
| `opencli liepin request-resume <oppositeImId>` | Send Liepin's built-in resume request |
| `opencli liepin resume <resumeId>` | Read a resume summary |
| `opencli liepin download-resume <resumeId>` | Export a resume to PDF or Word |

## Usage Examples

```bash
# Use the current job selected by Liepin
opencli liepin recommend --limit 5

# Search for candidates and keep the IDs needed by later commands
opencli liepin search "生鲜 定价 毛利" --limit 10

# Inspect recent conversations
opencli liepin chats --limit 20
opencli liepin chats --hasResume true

# Explicit confirmation is required because this contacts a candidate
opencli liepin request-resume <oppositeImId> --confirm true

# Greeting is a write action and requires explicit confirmation
opencli liepin greet-search-results <resumeId1>,<resumeId2> --confirm true

# Read or export a candidate resume
opencli liepin resume <resumeId>
opencli liepin download-resume <resumeId> --resume-format pdf --output ./resumes

# Select a recruiter job explicitly
opencli liepin recommend --jobId 50774103 --limit 10

# JSON output for local agent workflows
opencli liepin recommend --limit 5 -f json
```

## Notes

- Sign in to Liepin Enterprise (`lpt.liepin.com`) in the browser profile connected to OpenCLI first.
- `jobs`, `search`, `recommend`, `chats`, `chat-resumes`, `intention-orders`, and `resume` are read-only.
- `request-resume` and `greet-search-results` are write commands and refuse to send unless `--confirm true` is present. The latter uses the recruiter's configured greeting rather than a free-form message.
- `download-resume` writes a local file and refuses to overwrite an existing file unless `--overwrite true` is present.
- Liepin returns one recommendation batch of at most 20 candidates; `limit` therefore accepts `1-20`.
- Candidate data is returned locally and is not written to OpenCLI fixtures or site memory.
- These commands use internal endpoints from Liepin's current recruiter web application. If Liepin changes that private contract, OpenCLI fails with a typed contract error instead of returning an empty success result.
