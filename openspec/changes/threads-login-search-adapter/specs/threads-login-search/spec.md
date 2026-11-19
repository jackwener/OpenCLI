## ADDED Requirements

### Requirement: Search Threads posts through browser login state
The system SHALL provide a `threads search` command that searches Threads posts using the user's existing logged-in browser session.

#### Scenario: Search uses logged-in browser access
- **WHEN** the user runs `opencli threads search "openai" --limit 20 -f json` while logged in to Threads in Chrome
- **THEN** the command returns Threads post search results visible to that logged-in user

#### Scenario: Unauthenticated session stops safely
- **WHEN** the user runs `opencli threads search "openai"` without a usable Threads login session
- **THEN** the command fails with an authentication-oriented error instead of attempting login automation

### Requirement: Avoid official keyword search API
The system MUST NOT use the official `graph.threads.net/keyword_search` endpoint or require Meta developer credentials for the browser-backed search command.

#### Scenario: Adapter performs browser-backed search
- **WHEN** the command performs a search request
- **THEN** it uses the Threads web session or web UI evidence rather than the official keyword search API

### Requirement: Validate search inputs
The system SHALL require a non-empty keyword query and SHALL clamp or reject excessive limits using conservative bounds.

#### Scenario: Missing query is rejected
- **WHEN** the user runs `opencli threads search ""`
- **THEN** the command fails with an input validation error before navigating or sending a search request

#### Scenario: Limit is bounded
- **WHEN** the user requests more than the supported maximum number of results
- **THEN** the command uses the supported maximum or reports a validation error without high-volume collection

### Requirement: Return normalized result rows
The system SHALL return structured rows for post results with stable fields for rank, username, display name, text, timestamp, permalink URL, and engagement metadata when available.

#### Scenario: Minimum row fields are present
- **WHEN** Threads returns at least one post search result
- **THEN** each normalized row includes `rank`, `username`, `text`, `timestamp`, and `url`

#### Scenario: Optional metrics are not invented
- **WHEN** reply, repost, or like counts are absent or unreliable in the observed response
- **THEN** the command returns `null` or omits those optional metrics rather than fabricating values

### Requirement: Prefer structured web responses
The system SHALL prefer JSON, GraphQL, Relay, or other structured web responses captured from the Threads web app over DOM scraping.

#### Scenario: Structured response is available
- **WHEN** the Threads search UI emits a structured response containing post results
- **THEN** the adapter decodes results from that response rather than scraping rendered DOM text

#### Scenario: Response shape changes
- **WHEN** the observed structured response no longer contains the required fields
- **THEN** the command fails with a response-shape error that can be used for adapter repair

### Requirement: Handle web access failures safely
The system SHALL detect login walls, checkpoints, CAPTCHA, rate limiting, empty results, timeouts, and unexpected response shapes without bypassing site controls.

#### Scenario: Human verification appears
- **WHEN** Threads presents a checkpoint or CAPTCHA during search
- **THEN** the command reports that human verification is required and stops

#### Scenario: No posts match query
- **WHEN** Threads returns a successful search response with no post results
- **THEN** the command returns an empty result set or an explicit empty-result status without treating it as a parser failure

### Requirement: Scope first version conservatively
The system SHALL limit the first implementation to keyword post search and SHALL NOT implement large-scale pagination or archival collection.

#### Scenario: Cursor support is unavailable
- **WHEN** the user requests behavior beyond the first supported result page
- **THEN** the command keeps collection within the bounded first-version scope
