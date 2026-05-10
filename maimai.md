# Maimai (脉脉)

**Mode**: 🔐 Browser · **Domain**: `maimai.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli maimai search-talents` | Search Maimai talent profiles with keyword and structured filters |

## Usage Examples

```bash
# Search by keyword
opencli maimai search-talents Java

# Narrow by company and city
opencli maimai search-talents 产品经理 --companies "阿里巴巴,字节跳动" --cities 北京市

# Filter by school, degree, and work years
opencli maimai search-talents 算法 --schools "北京大学,清华大学" --degrees 3 --worktimes 3

# Prioritize recently active candidates
opencli maimai search-talents 运营 --sortby 1 --is_direct_chat 1

# JSON output for downstream processing
opencli maimai search-talents Java --size 10 -f json
```

## Key Filters

- `--positions`: filter by role or title
- `--companies`: comma-separated current or historical companies
- `--schools`: comma-separated school names
- `--provinces` / `--cities`: location filters
- `--worktimes`: `1=1-3y`, `2=3-5y`, `3=5-10y`, `4=10+y`
- `--degrees`: `1=大专`, `2=本科`, `3=硕士`, `4=博士`, `5=MBA`
- `--professions`: industry codes such as `01=互联网`, `02=金融`
- `--is_211` / `--is_985`: set to `1` to require those school tiers
- `--sortby`: `0=relevance`, `1=activity`, `2=work_years`, `3=education`
- `--is_direct_chat`: set to `1` to keep only candidates available for direct chat

## Prerequisites

- Chrome running and **logged into** `maimai.cn`
- The logged-in browser should be able to open `https://maimai.cn/ent/talents/discover/search_v2`
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `page` is zero-based, so the first page is `--page 0`
- Output includes current company plus a deduplicated `historical_companies` field from work experience
- If the command reports login failure, first verify the same Chrome profile can access the talent search page directly
