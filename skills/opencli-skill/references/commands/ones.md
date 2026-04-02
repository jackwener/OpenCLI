# ones

## Commands

### common
- Purpose: ones common operation
- Args: None
- Usage: `opencli ones common [options] -f json`

### enrich-tasks
- Purpose: ones enrich-tasks operation
- Args: None
- Usage: `opencli ones enrich-tasks [options] -f json`

### login
- Purpose: ONES Project API — login via Chrome Bridge (POST auth/login); stderr prints export hints for ONES_USER_ID / TOKEN
- Args:
  - `email`(optional; type: str); Account email (or set ONES_EMAIL)
  - `phone`(optional; type: str); Account phone (or set ONES_PHONE); ignored if email is set
  - `password`(optional; type: str); Password (or set ONES_PASSWORD)
- Usage: `opencli ones login [options] -f json`

### logout
- Purpose: ONES Project API — invalidate current token (GET auth/logout) via Chrome Bridge
- Args: None
- Usage: `opencli ones logout [options] -f json`

### me
- Purpose: ONES Project API — current user (GET users/me) via Chrome Bridge
- Args: None
- Usage: `opencli ones me [options] -f json`

### my-tasks
- Purpose: ONES — my work items (filters/peek + strict must query). Default: assignee=me. Use --mode if your site uses field004 for assignee.
- Args:
  - `team`(optional; type: str); Team UUID from URL …/team/<uuid>/…, or set ONES_TEAM_UUID
  - `limit`(optional; type: int; default: 100); Max rows (default 100, max 500)
  - `mode`(optional; type: str; default: 'assign'); assign=负责人(顶层 assign)；field004=负责人(筛选器示例里的 field004)；owner=创建者；both=负责人∪创建者(两次 peek 去重)
- Usage: `opencli ones my-tasks [options] -f json`

### resolve-labels
- Purpose: ones resolve-labels operation
- Args: None
- Usage: `opencli ones resolve-labels [options] -f json`

### task
- Purpose: ONES — work item detail (GET team/:team/task/:id/info); id is URL segment after …/task/
- Args:
  - `id`(required; type: str); Work item UUID (often 16 chars) from …/task/<id>
  - `team`(optional; type: str); Team UUID (8 chars from …/team/<team>/…), or set ONES_TEAM_UUID
- Usage: `opencli ones task [options] -f json`

### tasks
- Purpose: ONES Project API — list work items (POST team/:team/filters/peek); use token-info -f json for team uuid
- Args:
  - `team`(optional; type: str); Team UUID (8 chars), or set ONES_TEAM_UUID
  - `project`(optional; type: str); Filter by project UUID (field006 / 所属项目)
  - `assign`(optional; type: str); Filter by assignee user UUID (负责人 assign)
  - `limit`(optional; type: int; default: 30); Max rows after flattening groups (default 30)
- Usage: `opencli ones tasks [options] -f json`

### token-info
- Purpose: ONES Project API — session detail (GET auth/token_info) via Chrome Bridge: user, teams, org
- Args: None
- Usage: `opencli ones token-info [options] -f json`

### worklog
- Purpose: ONES — log work hours on a task (defaults to today; use --date to backfill; endpoint falls back by deployment).
- Args:
  - `task`(required; type: str); Work item UUID (usually 16 chars), from my-tasks or browser URL …/task/<id>
  - `hours`(required; type: str); Hours to log for this entry (e.g. 2 or 1.5), converted with ONES_MANHOUR_SCALE
  - `team`(optional; type: str); Team UUID from URL …/team/<uuid>/…, or set ONES_TEAM_UUID
  - `date`(optional; type: str); Entry date YYYY-MM-DD, defaults to today (local timezone); use for backfill
  - `note`(optional; type: str); Optional note (written to description/desc)
  - `owner`(optional; type: str); Owner user UUID (defaults to current logged-in user)
- Usage: `opencli ones worklog [options] -f json`
