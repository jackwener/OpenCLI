# Wellfound

**Mode**: 🔐 Browser · **Domain**: `wellfound.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli wellfound jobs` | Read visible Browse jobs from the current saved/filtered Wellfound search |
| `opencli wellfound top-picks` | Score the current Browse results and return the best daily application targets |
| `opencli wellfound job-detail <job-url>` | Read one job detail dialog with description, skills, remote policy, and company metadata |
| `opencli wellfound filters` | Read or update visible Browse filters; updates require `--execute` |
| `opencli wellfound apply <job-url>` | Dry-run or submit a Wellfound-native application; company-website applies are detected |

## Usage Examples

```bash
# Read the current Browse all search
opencli wellfound jobs --limit 10 -f json

# Daily shortlist from the current saved filters
opencli wellfound top-picks --limit 5 --pool 30 -f json

# Alias for top-picks
opencli wellfound daily -f json

# Read a job returned by jobs/top-picks
opencli wellfound job-detail 4215150-ai-full-stack-engineer-platform -f json
opencli wellfound job-detail "https://wellfound.com/jobs/4215150-ai-full-stack-engineer-platform" -f json

# Inspect current filters
opencli wellfound filters -f json

# Preview AI/full-stack remote filters without changing the UI
opencli wellfound filters --preset ai-fullstack-remote -f json

# Apply supported checkbox/keyword filters; autocomplete fields may still need manual UI selection
opencli wellfound filters --preset ai-fullstack-remote --execute -f json

# Dry-run an application first
opencli wellfound apply 4215150-ai-full-stack-engineer-platform \
  --expected-title "AI Full Stack Engineer, Platform" \
  --expected-company "ParallelDots" \
  --message "I build full-stack AI workflow tools with TypeScript, React, Node.js, and agentic automation systems." \
  -f json

# Submit only after the dry-run row is correct
opencli wellfound apply 4215150-ai-full-stack-engineer-platform \
  --expected-title "AI Full Stack Engineer, Platform" \
  --expected-company "ParallelDots" \
  --message "I build full-stack AI workflow tools with TypeScript, React, Node.js, and agentic automation systems." \
  --execute \
  -f json
```

## Notes

- The adapter reads the logged-in Wellfound jobs UI. It does not save jobs or hide jobs. Filter updates and Wellfound-native applications are guarded by explicit `--execute`.
- Mutating commands are guarded. `filters` only changes the UI with `--execute`; `apply` only clicks the final Wellfound-native Apply button with `--execute`.
- Set role, remote-only, region, compensation, skills, markets, job types, experience, keywords, company size, stage, responsiveness, and visa filters in Wellfound once; `jobs` and `top-picks` reuse the resulting Browse search.
- `filters --preset ai-fullstack-remote` encodes a TypeScript/React/Node/full-stack AI preference profile. Wellfound skills and markets use autocomplete controls; the command reports unsupported controls when they cannot be selected safely through the visible UI.
- `top-picks` is a local ranking over visible rows. It prioritizes remote roles, fresh postings, recruiter activity, Wellfound-native apply, and AI/full-stack/agentic alignment. It hard-rejects disallowed stack families (Go, PHP, Ruby, Scala, Salesforce, etc.) and Python-only roles, and it penalizes unpaid or equity-only roles.
- `job-detail` accepts a raw Wellfound id-slug, a `/jobs/<id-slug>` URL, or a `/jobs?job_listing_slug=<id-slug>` URL.
- `apply` distinguishes `wellfound`, `company_website`, `already_applied`, and `unknown` apply modes. It does not submit external company forms; use the returned `external_apply_url` for a separate reviewed workflow.

## Prerequisites

- Chrome running and logged into Wellfound.
- [Browser Bridge extension](/guide/browser-bridge) installed and connected.
