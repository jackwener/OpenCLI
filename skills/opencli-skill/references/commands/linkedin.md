# linkedin

## Commands

### search
- Purpose: Search LinkedIn jobs with optional filter combinations
- Args:
  - `query`(required): Job search keywords
  - `location`(optional): Location text (e.g., San Francisco Bay Area)
  - `limit`(optional): type: int; default: 10; Number of jobs to return (max 100)
  - `start`(optional): type: int; default: 0; Result offset for pagination
  - `details`(optional): type: bool; default: false; Include description and apply URL (slower)
  - `company`(optional): Comma-separated company names or LinkedIn company IDs
  - `experience-level`(optional): internship, entry, associate, mid-senior, director, executive
  - `job-type`(optional): full-time, part-time, contract, temporary, volunteer, internship, other
  - `date-posted`(optional): any, month, week, 24h
  - `remote`(optional): on-site, hybrid, remote
- Usage: `opencli linkedin search [options] -f json`

### timeline
- Purpose: Read LinkedIn home timeline posts
- Args:
  - `limit`(optional): type: int; default: 20; Number of posts to return (max 100)
- Usage: `opencli linkedin timeline [options] -f json`
