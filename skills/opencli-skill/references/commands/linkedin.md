# linkedin

## Commands

### search
- Purpose: Search LinkedIn jobs with optional filter combinations
- Args:
  - `query`(required; type: string); Job search keywords
  - `location`(optional; type: string); Location text such as San Francisco Bay Area
  - `limit`(optional; type: int; default: 10); Number of jobs to return (max 100)
  - `start`(optional; type: int; default: 0); Result offset for pagination
  - `details`(optional; type: bool; default: false); Include full job description and apply URL (slower)
  - `company`(optional; type: string); Comma-separated company names or LinkedIn company IDs
  - `experience-level`(optional; type: string); Comma-separated: internship, entry, associate, mid-senior, director, executive
  - `job-type`(optional; type: string); Comma-separated: full-time, part-time, contract, temporary, volunteer, internship, other
  - `date-posted`(optional; type: string); One of: any, month, week, 24h
  - `remote`(optional; type: string); Comma-separated: on-site, hybrid, remote
- Usage: `opencli linkedin search [options] -f json`

### timeline
- Purpose: Read LinkedIn home timeline posts
- Args:
  - `limit`(optional; type: int; default: 20); Number of posts to return (max 100)
- Usage: `opencli linkedin timeline [options] -f json`
