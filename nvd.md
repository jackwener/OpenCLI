# NVD (NIST National Vulnerability Database)

**Mode**: 🌐 Public · **Domain**: `services.nvd.nist.gov`

Fetch a single CVE record from the NIST National Vulnerability Database via the public CVE 2.0 API.

## Commands

| Command | Description |
|---------|-------------|
| `opencli nvd cve <id>` | Fetch a CVE detail (description, CVSS, CWE, KEV flag) |

## Usage Examples

```bash
# Log4Shell
opencli nvd cve CVE-2021-44228

# Heartbleed
opencli nvd cve CVE-2014-0160

# JSON output for downstream tooling
opencli nvd cve CVE-2021-44228 -f json
```

## Output Columns

| Column | Description |
|--------|-------------|
| `id` | Canonical CVE id |
| `published` | First published date (`YYYY-MM-DD`) |
| `lastModified` | Last modified date (`YYYY-MM-DD`) |
| `vulnStatus` | NVD analysis status (e.g. `Analyzed`, `Awaiting Analysis`) |
| `baseScore` | CVSS base score (numeric, 0–10) |
| `severity` | CVSS severity (`CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `NONE`) |
| `attackVector` | CVSS attack vector (`NETWORK` / `LOCAL` / `PHYSICAL` / `ADJACENT`) |
| `cwe` | Comma-separated CWE id(s) |
| `kevAdded` | CISA KEV (Known Exploited Vulnerabilities) date if present |
| `description` | English description |
| `url` | Canonical NVD detail URL |

## Options

| Option | Description |
|--------|-------------|
| `id` (positional) | CVE identifier (`CVE-YYYY-N…`, case-insensitive). Validated upfront. |

## Caveats

- The CVE id is validated against `^CVE-\d{4}-\d{4,}$`; bad input raises `ArgumentError`.
- CVSS columns prefer v3.1, fall back to v3.0, then v2 if neither v3 record is present.
- NVD enforces aggressive rate limits without an API key. `HTTP 403` and `HTTP 429` both surface as typed `CommandExecutionError` with a retry hint.
- Empty / unanalyzed records (no CVSS payload) leave `baseScore` / `severity` / `attackVector` as `null` / empty rather than fabricating defaults.

## Prerequisites

- No browser required — uses `services.nvd.nist.gov/rest/json/cves/2.0`.
