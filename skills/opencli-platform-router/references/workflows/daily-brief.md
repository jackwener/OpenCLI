# workflow: daily-brief

1. Collect top items from 2-4 platforms requested by user.
2. Use `-f json` for all commands.
3. Summarize into: Top 5 + per-platform highlights + 3 actions.

Example chain:
- `opencli zhihu hot --limit 10 -f json`
- `opencli bilibili hot --limit 10 -f json`
- `opencli reddit hot --limit 10 -f json`
