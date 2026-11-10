# Microsoft Clarity

**Mode**: 🔐 Browser · **Domain**: `clarity.microsoft.com`

Read Microsoft Clarity **project settings**. Clarity's Data Export API returns
aggregate metrics only — integrations, masking, IP blocking and team are
dashboard-only, so this adapter reads the rendered Setup tab.

All commands are `access: 'read'`. Nothing connects, disconnects, or changes any
setting.

## Commands

| Command | Description |
|---------|-------------|
| `opencli clarity projects` | List every project the account can see, with its project id |
| `opencli clarity integrations <project-id>` | Integration status for one project |
| `opencli clarity audit` | GA / GTM / Ads status across every project, with a verdict |

## projects

Lists the projects on the account. Start here — the ids the other two commands
take come from the `/projects/view/<id>/` URL, and this is how you get them
without opening the dashboard.

Columns: `ProjectId` `Name` `Site`

```bash
opencli clarity projects
opencli clarity projects -f json
```

## integrations

Reads the Setup tab for one project and reports each integration Clarity offers.

Columns: `Project` `Integration` `Status` `Detail`

```bash
opencli clarity integrations a1b2c3d4e5
opencli clarity integrations a1b2c3d4e5 -f json
```

`Status` is four-valued and never collapses:

| Status | Meaning |
|--------|---------|
| `Connected` | Clarity reports the integration as connected |
| `Not Connected` | The card is present and shows as not connected |
| `Not offered` | Clarity does not show that card for this project |
| `Unknown` | The card was read but its state could not be determined |

`Not offered` and `Not Connected` are different facts — an integration Clarity
never surfaced is not one the user declined to set up.

## audit

Answers "which of my projects still need Google Analytics or Tag Manager wired
up" in one pass. Discovers every project automatically when `--project-ids` is
omitted.

Columns: `ProjectId` `Name` `GoogleAnalytics` `GoogleTagManager` `GoogleAds`
`MicrosoftAds` `Verdict`

```bash
# Every project on the account
opencli clarity audit

# Only the ones that fail the requirement
opencli clarity audit --only-issues

# Specific projects
opencli clarity audit --project-ids a1b2c3d4e5,f6g7h8i9j0

# Change what counts as configured
opencli clarity audit --required "Google Analytics,Google Ads"

opencli clarity audit --only-issues -f json
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--project-ids` | auto-discover | Comma-separated project ids to check |
| `--required` | `Google Analytics,Google Tag Manager` | Integrations that must be `Connected` for the verdict to be `ok` |
| `--only-issues` | `false` | Return only projects whose verdict is not `ok` |

## Notes

- **`siteSession: 'ephemeral'`.** Clarity is a single-page app that keeps
  per-project state in the tab, so a persistent session leaks one project's
  settings into the next project's read.
- **Partial reads are refused, not degraded.** A half-rendered dashboard
  produces a confident wrong answer rather than a missing one, so every reader
  settles first: card counts and project-id counts must hold steady across two
  polls before anything is reported. A project whose page never settles is
  reported as such instead of being read early.
- **Signed-out and no-access are distinguished.** If Clarity serves its
  signed-out shell for one project while other projects in the same run read
  fine, that project is reported as `no access` rather than as a login failure
  for the whole run.
- Sign in to Clarity in the browser profile the Browser Bridge uses before
  running any of these.
