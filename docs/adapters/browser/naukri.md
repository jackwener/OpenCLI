# Naukri

**Mode**: 🍪 Browser (cookie) · **Domain**: `www.naukri.com`

[Naukri](https://www.naukri.com/) is one of India's largest job-search and
recruiting platforms. The adapter drives the logged-in candidate profile pages
through a browser session so users can inspect and maintain recruiter-facing
profile fields.

## Commands

| Command | Description |
|---------|-------------|
| `opencli naukri profile-read` | Read visible Naukri candidate profile sections |
| `opencli naukri resume-upload <file>` | Upload a resume file and verify the saved filename |
| `opencli naukri headline-set --text <text>` | Update the resume headline and verify readback |
| `opencli naukri summary-set --text <text>` | Update the profile summary and verify readback |
| `opencli naukri key-skills-list` | List current key-skill chips |
| `opencli naukri key-skills-suggest --query <query>` | Inspect key-skill autocomplete suggestions without saving |
| `opencli naukri key-skills-resolve --skills <skills>` | Resolve desired key-skill labels against Naukri suggestions |
| `opencli naukri key-skills-set --skills <skills>` | Replace key skills and verify the final saved chips |

## Usage Examples

```bash
# Read the logged-in profile
opencli naukri profile-read -f json

# Upload a resume file
opencli naukri resume-upload ~/Downloads/resume.pdf -f json

# Update profile text fields
opencli naukri headline-set --text "Senior Full-Stack AI Engineer | React, Node.js, TypeScript"
opencli naukri summary-set --text "Senior full-stack engineer focused on AI products and automation."

# Inspect and update key skills
opencli naukri key-skills-list -f json
opencli naukri key-skills-suggest --query "React" -f json
opencli naukri key-skills-resolve --skills "React, TypeScript, Node.js" -f json
opencli naukri key-skills-set --skills "React.js, TypeScript, Node.js" -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `profile-read` | `profile_url, name, current_title, current_company, profile_last_updated, profile_completion, photo_status, location, total_experience, current_salary, phone, email, notice_status, resume_file, resume_uploaded_on, resume_headline, key_skills, employment, education, it_skills, projects, profile_summary, accomplishments, career_profile, personal_details, diversity_inclusion` |
| `resume-upload` | `status, resume_file, resume_uploaded_on` |
| `headline-set` | `status, resume_headline` |
| `summary-set` | `status, profile_summary` |
| `key-skills-list` | `rank, skill` |
| `key-skills-suggest` | `rank, suggestion, source, endpoint` |
| `key-skills-resolve` | `input, resolved, status, confidence, alternatives` |
| `key-skills-set` | `status, skills, missing, extra` |

## Args

### `resume-upload`

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `file` *(positional, required)* | string | — | Resume file path. Supported formats: `.doc`, `.docx`, `.rtf`, `.pdf`; max 2 MB |

### `headline-set`

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `--text` | string | — | New resume headline |

### `summary-set`

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `--text` | string | — | New profile summary |

### `key-skills-suggest`

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `--query` | string | — | Skill prefix to type into the Naukri autocomplete |
| `--limit` | int | `10` | Max suggestions to return, 1-25 |

### `key-skills-resolve`

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `--skills` | string | — | Comma, semicolon, or newline separated desired skill labels |
| `--limit` | int | `8` | Max suggestions to inspect per skill, 1-15 |

### `key-skills-set`

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `--skills` | string | — | Comma, semicolon, or newline separated final Naukri key skill labels |

## Prerequisites

The adapter uses the connected browser profile and `Strategy.COOKIE`. Sign in to
Naukri in the connected browser before running these commands. If the session is
not authenticated, open `https://www.naukri.com/`, sign in, and retry.

## Limitations

- The adapter targets the candidate profile pages on `www.naukri.com`.
- Write commands interact with the rendered profile UI, so selector changes or
  A/B-tested profile modals may require adapter updates.
- Key-skill writes are limited by Naukri's own allowed labels and profile skill
  count. Use `key-skills-suggest` or `key-skills-resolve` before replacing the
  saved key-skill list.
