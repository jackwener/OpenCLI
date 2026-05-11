# 51job

**Mode**: 🔐 Browser · **Domains**: `we.51job.com`, `jobs.51job.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli 51job search <keyword>` | Keyword search with city / salary / experience / degree / company filters |
| `opencli 51job hot` | Recommended jobs feed for a city |
| `opencli 51job detail <jobId>` | Full job detail page by `jobId` |
| `opencli 51job company <encCoId>` | Company profile plus active jobs by encrypted company ID |

## Usage Examples

```bash
# Search Beijing Python jobs
opencli 51job search python --area 北京 --limit 5

# Recommended jobs in Shanghai
opencli 51job hot --area 上海 --limit 5

# Detail by jobId from search/hot output
opencli 51job detail 171699769

# Company jobs by encCoId from search output
opencli 51job company MjYxMjgxMA== --limit 3

# JSON output for agent workflows
opencli 51job search Golang --area 杭州 -f json
```

## Notes

- `search` and `hot` run behind Aliyun WAF. The adapter uses a real browser session and browser-context `fetch` for the JSON API on `we.51job.com`.
- `detail` and `company` read SSR HTML pages on `jobs.51job.com`.
- `area` accepts a known city name or a 6-digit city code. Unknown non-empty values fail fast.
- `company` returns the full `companyIntro` text. It does not silently truncate content.
