# LinkedIn

**Mode**: 🔐 Browser · **Domain**: `linkedin.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli linkedin connect` | Send a fail-closed connection request after verifying the exact profile |
| `opencli linkedin inbox` | List LinkedIn messaging inbox conversations and unread status |
| `opencli linkedin job-detail` | Read one LinkedIn job page with description, apply URL, workplace type, applicants, and company metadata |
| `opencli linkedin jobs-preferences` | Read visible LinkedIn Jobs preferences and alert settings without changing them |
| `opencli linkedin people-search` | Search standard LinkedIn for people by keyword (SSR DOM scrape). Each query counts toward LinkedIn's monthly Commercial Use Limit |
| `opencli linkedin profile-analytics` | Read visible profile dashboard counters such as profile views, post impressions, and search appearances |
| `opencli linkedin profile-experience` | Read visible LinkedIn profile experience entries with titles, dates, locations, skills, media, and URLs |
| `opencli linkedin profile-read` | Read visible profile sections including headline, About, experience, education, services, and featured text |
| `opencli linkedin posts` | Export visible posts from a LinkedIn profile activity page with engagement metrics |
| `opencli linkedin post-analytics` | Summarize raw visible LinkedIn post counters without custom scoring or classification |
| `opencli linkedin profile-projects` | Read visible LinkedIn profile projects with descriptions, dates, skills, media, and URLs |
| `opencli linkedin safe-send` | Verify exact recipient/thread context before optionally sending a message |
| `opencli linkedin salesnav-inbox` | List Sales Navigator message conversations with API pagination |
| `opencli linkedin salesnav-message` | Validate or send a Sales Navigator InMail to an exact lead |
| `opencli linkedin salesnav-search` | Search Sales Navigator people leads by keyword |
| `opencli linkedin salesnav-thread` | Return Sales Navigator message history for a thread or lead |
| `opencli linkedin search` | Search LinkedIn jobs (Voyager API), with optional `--details` enrichment |
| `opencli linkedin sent-invitations` | List pending sent LinkedIn invitations |
| `opencli linkedin services-read` | Read a LinkedIn Services page, including overview, services, availability, pricing, and media metadata |
| `opencli linkedin thread-snapshot` | Load a LinkedIn messaging thread and return available context |
| `opencli linkedin timeline` | Read posts from your LinkedIn home feed |

## Usage Examples

```bash
# Quick start
opencli linkedin search --limit 5

# Search with filters
opencli linkedin search "site reliability engineer" --location "San Francisco Bay Area" --remote remote

# Enrich with full description and apply URL (slower; 1 page navigation per row)
opencli linkedin search "data scientist" --limit 3 --details

# Read Jobs preferences and a single job page
opencli linkedin jobs-preferences -f json
opencli linkedin job-detail https://www.linkedin.com/jobs/view/4412279099 -f json

# Read your home timeline
opencli linkedin timeline --limit 5

# Read profile and services data
opencli linkedin profile-read -f json
opencli linkedin profile-analytics -f json
opencli linkedin services-read -f json

# Export visible profile activity posts
opencli linkedin posts --limit 5 -f json

# Summarize raw visible post counters
opencli linkedin post-analytics --limit 5 -f json

# Read visible profile projects
opencli linkedin profile-projects -f json

# Read visible profile experience entries
opencli linkedin profile-experience -f json

# List recent inbox conversations, including unread status
opencli linkedin inbox --limit 20 -f json

# Search for people by keyword (consumes 1 CUL search query)
opencli linkedin people-search "site reliability engineer berlin" --limit 5

# Verify a profile before sending a connection request; add --send to actually send
opencli linkedin connect https://www.linkedin.com/in/example/ --expected-name "Jane Doe" --note "quick note" --send

# Snapshot a thread, then safe-send only if exact recipient/thread context still matches
opencli linkedin thread-snapshot --thread-url https://www.linkedin.com/messaging/thread/abc/ -f json
opencli linkedin safe-send --thread-url https://www.linkedin.com/messaging/thread/abc/ --expected-name "Jane Doe" --message "thanks" --send

# Search Sales Navigator leads and inspect Sales Navigator messages
opencli linkedin salesnav-search "quality manager food manufacturing" --limit 10 -f json
opencli linkedin salesnav-inbox --limit 20 -f json
opencli linkedin salesnav-thread "https://www.linkedin.com/sales/inbox/2-thread" -f json

# Dry-run a Sales Navigator InMail; add --send only after validating the row
opencli linkedin salesnav-message "urn:li:fs_salesProfile:(PROFILE,NAME_SEARCH,TOKEN)" --subject "Quick question" --body "Hello"

# Reconcile pending sent invitations
opencli linkedin sent-invitations -f json

# JSON output
opencli linkedin search -f json
opencli linkedin timeline -f json
```

## Output

### `search`

Always returns: `rank` · `title` · `company` · `location` · `listed` · `salary` · `url`

When `--details` is set, each row additionally has:

| Column | Type | Notes |
|--------|------|-------|
| `description` | string \| null | Full "About the job" body. `null` if upstream had nothing or fetch failed (see `detail_error`). |
| `apply_url` | string \| null | First `apply`-labelled link on the page. `null` if upstream had nothing or fetch failed. |
| `detail_error` | string \| null | `null` on success. Otherwise short reason: `'no url'` (row had no jobId), `'fetch failed: <message>'` (navigation/parse threw), or `'missing description'` (page loaded but body was empty). |

Previously the adapter returned `description: '', apply_url: ''` for both the missing-url path and the silent-catch path — callers couldn't tell upstream gaps apart from fetch failures. The current shape preserves backward compatibility on success and surfaces failures with `null` + a typed reason on `detail_error`. Per-row failures still don't abort the batch.

`--limit` must be between 1 and 100, and `--start` must be a non-negative integer. LinkedIn login/auth walls abort with `AuthRequiredError` instead of being folded into `detail_error`.

### Job preference commands

`jobs-preferences` opens the LinkedIn Jobs page and returns `open_to_work`, `job_titles`, `locations`, `job_alerts`, `preferences_url`, `alerts_url`, and `raw_preferences`. It reads visible settings only and does not change preferences or alerts.

`job-detail` accepts a `https://www.linkedin.com/jobs/view/<id>` URL and returns `title`, `company`, `location`, `workplace_type`, `job_type`, `applicants`, `listed`, `apply_url`, `company_url`, `url`, and `description`. It normalizes the URL to LinkedIn's logged-in job detail surface and combines inline metadata with the rendered description.

### `people-search`

Returns `rank`, `name`, `headline`, `location`, and `profile_url` from the rendered LinkedIn people-search page. `profile_url` is the row identity and must be a stable `/in/<handle>/` LinkedIn profile URL; malformed extraction payloads fail typed instead of being reported as empty results.

`--limit` must be between 1 and 10. LinkedIn login/auth walls abort with `AuthRequiredError`; Commercial Use Limit redirects abort with `CommandExecutionError` because the page no longer contains a trustworthy result list.

### Profile and services commands

`profile-read` opens a profile URL, or `/in/me/` by default, and returns `profile_url`, `name`, `headline`, `location`, `about`, `about_character_count`, `about_skills`, `experience`, `education`, `services`, and `featured`. It reads visible profile sections and fails typed if LinkedIn returns an auth wall. Editor-only fields such as `about_character_count` and `about_skills` are only populated for the default self-profile flow.

`profile-analytics` opens a profile URL, or `/in/me/` by default, and returns visible dashboard counters: `profile_views`, `post_impressions`, `search_appearances`, `followers`, `connections`, plus `raw_analytics`.

`profile-experience` opens a profile URL, or `/in/me/` by default, resolves it to the profile's Experience detail page, and returns visible experience rows: `rank`, `total_count`, `title`, `employment_type`, `company`, `date_range`, `start_date`, `end_date`, `location`, `location_type`, `description`, `skills`, `media`, `urls`, `skill_url`, `media_url`, `profile_url`, and `raw_text`. If the authenticated profile has no visible Experience section, the command returns `EmptyResultError` instead of placeholder rows.

`services-read` accepts either `--services-url` or a profile URL that links to a Services page. It returns `service_url`, `page_title`, `overview`, `availability`, `work_locations`, `pricing`, `services_provided`, `services_count`, `media_count`, `media`, `messages`, and `reviews_visibility`. Owner-only edit/media fields are only populated for the default self-profile flow.

### `posts`

Exports visible rows from a LinkedIn profile activity page. It opens `/in/me/recent-activity/all/` by default, or accepts `--profile-url https://www.linkedin.com/in/<handle>/`.

Returns `rank`, `author`, `posted_at`, `body`, `reactions`, `comments`, `reposts`, `impressions`, `media`, `media_urls`, `url`, and `raw_text`. `media_urls` only includes non-decorative media or external link URLs that LinkedIn exposes in the rendered card; profile photos and reaction sprites are filtered out.

`--limit` must be between 1 and 100. LinkedIn login/auth walls abort with `AuthRequiredError`.

### `post-analytics`

Summarizes raw counters from visible LinkedIn profile activity posts. It opens `/in/me/recent-activity/all/` by default, or accepts `--profile-url https://www.linkedin.com/in/<handle>/`.

Returns `posts_analyzed`, `total_reactions`, `total_comments`, `total_reposts`, `total_impressions`, `posts_with_media`, `posts_with_urls`, `latest_posted_at`, `latest_reactions`, `latest_comments`, `latest_reposts`, `latest_impressions`, and `latest_url`.

This command does not compute custom engagement scores, topic labels, format labels, or recommendations. `--limit` must be between 1 and 100.

### `profile-projects`

Opens a profile URL, or `/in/me/` by default, resolves it to the profile's Projects detail page, and returns visible project rows.

Returns `rank`, `title`, `date_range`, `associated_with`, `description`, `skills`, `media`, `urls`, `profile_url`, and `raw_text`. If the authenticated profile has no visible Projects section, the command returns `EmptyResultError` instead of emitting placeholder rows.

### Messaging commands

`inbox` returns `rank`, `thread_url`, `thread_id`, `person_name`, `last_message_preview`, `unread`, and `timestamp`. It loads the LinkedIn messaging page with your browser session, then reuses the page's own `messengerConversations` API request as the row source instead of scraping the virtualized inbox DOM.

`connect` and `safe-send` are write commands but dry-run by default. They only click LinkedIn write actions when `--send` is explicitly passed. `connect` requires an exact `https://www.linkedin.com/in/<profile>/` URL and verifies the landed profile plus visible name before sending. `safe-send` requires an exact `https://www.linkedin.com/messaging/thread/<id>/` URL and verifies the landed thread, visible recipient name, composer presence, and optional latest-message guard before filling or sending.

`thread-snapshot` opens an exact messaging thread URL, validates `--max-scrolls` before navigation, scrolls for available history, and returns a JSON snapshot suitable for caller-side recipient safety checks.

### Sales Navigator commands

`salesnav-search` uses the Sales Navigator lead search API and returns `rank`, `name`, `title`, `company`, `location`, `degree`, `profile_url`, `lead_url`, and `recipient_urn`. Missing lead identity or malformed API payloads fail typed instead of emitting unaddressable rows.

`salesnav-inbox` and `salesnav-thread` use Sales Navigator messaging APIs rather than virtualized DOM rows. They require a signed-in LinkedIn session with Sales Navigator access; auth/API failures and malformed thread payloads fail typed, while a valid empty inbox/thread is reported as an empty result.

`salesnav-message` is a write command but dry-run by default. It resolves the recipient to a Sales Navigator lead identity, checks profile/credit state, and only sends when `--send` is explicitly passed. Post-send verification checks the Sales Navigator lead page for sent activity.

`sent-invitations` reads the pending invitations page for CRM reconciliation and returns `rank`, `name`, `profile_url`, and `invited_date_text`.

## Prerequisites

- Chrome running and **logged into** linkedin.com
- [Browser Bridge extension](/guide/browser-bridge) installed
