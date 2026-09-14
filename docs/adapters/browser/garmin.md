# Garmin Connect

**Mode**: 🔐 Browser · **Domain**: `connect.garmin.com`

Garmin Connect exposes its data through authenticated JSON APIs (`/gc-api/...`). This adapter calls them through the logged-in Chrome session, reusing the browser's cookies and CSRF/NK tokens. Run `opencli garmin login` once, then every other command works against your account.

## Commands

### Account

| Command | Description |
|---------|-------------|
| `opencli garmin login` | Log into Garmin Connect in the bound browser (run once) |
| `opencli garmin whoami` | Show the currently logged-in athlete |
| `opencli garmin profile` | Your profile summary |
| `opencli garmin devices` | Your registered Garmin devices |
| `opencli garmin gear` | Your registered gear (shoes, bikes, …) |
| `opencli garmin badges` | Badges you have earned |

### Activities & Courses

| Command | Description |
|---------|-------------|
| `opencli garmin activities` | Your recent activities |
| `opencli garmin activity` | A single activity in detail (HR, speed, elevation, …) |
| `opencli garmin courses` | Your saved courses / routes (路书) |
| `opencli garmin course` | A single course / route in detail |
| `opencli garmin prs` | Your personal records |

### Wellness & Health

| Command | Description |
|---------|-------------|
| `opencli garmin stats` | Daily wellness summary (steps, calories, distance, floors) |
| `opencli garmin sleep` | Sleep breakdown (deep / light / rem / awake) |
| `opencli garmin heartrate` | Daily heart-rate summary (resting / max / min) |
| `opencli garmin hrv` | Heart-rate variability summary for a night |
| `opencli garmin stress` | Daily stress level (average / max) |
| `opencli garmin bodybattery` | Body Battery energy (charged / drained / current) |
| `opencli garmin respiration` | Daily respiration rate (breaths per minute) |
| `opencli garmin spo2` | Daily blood-oxygen (pulse ox) summary |
| `opencli garmin hydration` | Daily hydration — water intake vs goal, sweat loss |
| `opencli garmin weight` | Body weight log over the last N days |
| `opencli garmin status` | Training status, fitness trend and VO2 max |
| `opencli garmin load` | Training load: acute, chronic and load focus |
| `opencli garmin powercurve` | Cycling power curve — best power held per duration |

### Social

| Command | Description |
|---------|-------------|
| `opencli garmin search` | Search athletes by name |
| `opencli garmin following` | Athletes you follow |
| `opencli garmin followers` | Athletes who follow you |
| `opencli garmin connections` | Your connections (friends) |
| `opencli garmin follow` | Follow an athlete (write) |
| `opencli garmin unfollow` | Unfollow an athlete (write) |

## Usage Examples

```bash
# One-time login (opens Garmin Connect in the bound Chrome tab; waits for you to sign in)
opencli garmin login

# Who am I?
opencli garmin whoami

# Recent activities, then one in detail (accepts an activity id or activity URL)
opencli garmin activities --limit 20
opencli garmin activity 1234567890
opencli garmin activity https://connect.garmin.com/modern/activity/1234567890 -f json

# Saved courses / routes
opencli garmin courses --limit 20
opencli garmin course 987654

# Wellness for a given day (default: today; --date YYYY-MM-DD)
opencli garmin stats --date 2026-06-20
opencli garmin sleep --date 2026-06-20
opencli garmin heartrate
opencli garmin hrv
opencli garmin stress
opencli garmin bodybattery
opencli garmin spo2
opencli garmin respiration
opencli garmin hydration

# Training & body metrics
opencli garmin status
opencli garmin load
opencli garmin powercurve --days 365
opencli garmin weight --days 90 --limit 30

# Gear, devices, badges, personal records
opencli garmin gear
opencli garmin devices
opencli garmin badges --limit 30
opencli garmin prs --limit 30

# Social: find athletes, list your graph
opencli garmin search "Jane Doe" --limit 20
opencli garmin following --limit 30
opencli garmin followers --limit 30
opencli garmin connections --limit 30

# Write commands — dry-run first, then add --execute to actually perform the action
opencli garmin follow jane.doe                 # dry-run: refuses, shows intent
opencli garmin follow jane.doe --execute       # actually follows
opencli garmin unfollow jane.doe --execute
```

> Wellness commands (`stats`, `sleep`, `heartrate`, `hrv`, `stress`, `bodybattery`, `respiration`, `spo2`, `hydration`, `status`, `load`) default to today; pass `--date YYYY-MM-DD` for a specific day. Garmin returns no data (and the command reports an empty result) for days the device did not record.
> `activity`, `course` accept either a numeric id or the corresponding Garmin Connect URL.
> Write commands (`follow`, `unfollow`) are guarded by `--execute`. Run them once without the flag to confirm the target athlete, then re-run with `--execute`. Pass an athlete display id (from `opencli garmin search`) or a profile URL.
> If a command reports a login/auth error, re-run `opencli garmin login` to refresh the session.

## Prerequisites

- Chrome running and **logged into** connect.garmin.com (run `opencli garmin login` once)
- [Browser Bridge extension](/guide/browser-bridge) installed
