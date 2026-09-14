# Strava

**Mode**: 🔐 Browser · **Domain**: `www.strava.com`

Strava serves authenticated athlete/activity pages as server-rendered HTML (no JSON XHR, no SSR state), so this adapter scrapes the rendered DOM through the logged-in Chrome session. Run `opencli strava login` once, then the session cookie is reused for every other command.

## Commands

### Read

| Command | Description |
|---------|-------------|
| `opencli strava whoami` | Show the currently logged-in Strava athlete |
| `opencli strava profile` | Athlete profile (name, location, follower counts) |
| `opencli strava activities` | Recent activities on an athlete profile |
| `opencli strava activity` | Single activity detail (distance, time, speed, HR, power, cadence, calories) |
| `opencli strava map` | Route / map resources (GPX export URLs) for an activity |
| `opencli strava prs` | An athlete's personal records / best efforts |
| `opencli strava kudos` | Kudos and comment counts for an activity |
| `opencli strava comments` | Comments on an activity |
| `opencli strava feed` | Your dashboard (following) activity feed |
| `opencli strava clubs` | Clubs an athlete belongs to |
| `opencli strava club` | Club details (name, sport, location, members) |
| `opencli strava club-activities` | Recent member activities in a club |
| `opencli strava segments` | Your starred segments |

### Write

Write commands require `--execute`; without it they refuse and report what they *would* do.

| Command | Description |
|---------|-------------|
| `opencli strava login` | Log into Strava in the bound browser (run once) |
| `opencli strava kudo` | Give kudos to an activity |
| `opencli strava comment` | Comment on an activity |
| `opencli strava comment-delete` | Delete one of your comments on an activity |
| `opencli strava join` | Join a club |

## Usage Examples

```bash
# One-time login (opens Strava in the bound Chrome tab; waits for you to sign in)
opencli strava login

# Who am I?
opencli strava whoami

# Athlete profile + recent activities (accepts an athlete id or profile URL)
opencli strava profile 12345678
opencli strava activities 12345678 --limit 20
opencli strava activities https://www.strava.com/athletes/12345678

# Full detail for a single activity (accepts an activity id or activity URL)
opencli strava activity 9876543210
opencli strava activity https://www.strava.com/activities/9876543210 -f json

# Map / GPX export URLs and personal records
opencli strava map 9876543210
opencli strava prs 12345678 --limit 30

# Social: kudos + comment counts, then the comment list
opencli strava kudos 9876543210
opencli strava comments 9876543210 --limit 50

# Your following feed and starred segments
opencli strava feed --limit 20
opencli strava segments --limit 20

# Clubs
opencli strava clubs 12345678
opencli strava club 654321
opencli strava club-activities 654321 --limit 20

# Write commands — dry-run first, then add --execute to actually perform the action
opencli strava kudo 9876543210                      # dry-run: refuses, shows intent
opencli strava kudo 9876543210 --execute            # actually gives kudos
opencli strava comment 9876543210 "Nice ride!" --execute
opencli strava comment-delete 9876543210 123456789 --execute
opencli strava join 654321 --execute
```

> `profile`, `activities`, `prs` and `clubs` accept either a bare athlete id or a full profile URL. `activity`, `map`, `kudos`, `comments` and the comment write commands accept either an activity id or an activity URL.
> Write commands (`kudo`, `comment`, `comment-delete`, `join`) are guarded by `--execute`. Run them once without the flag to confirm the target, then re-run with `--execute`. Each verifies the resulting page state after acting (e.g. the kudos button flips, the comment appears/disappears, the club now offers "Leave").
> `comment-delete` only removes your own comments — take the `comment_id` from `opencli strava comments`.
> Auth is detected by the redirect Strava issues for signed-out requests; if a command reports a login error, re-run `opencli strava login`.

## Prerequisites

- Chrome running and **logged into** www.strava.com (run `opencli strava login` once)
- [Browser Bridge extension](/guide/browser-bridge) installed
