# xiaohongshu

Use for feed and keyword search on 小红书.

## Read examples
- `opencli xiaohongshu feed --limit {{limit|20}} -f json`
- `opencli xiaohongshu search --keyword "{{query}}" --limit {{limit|20}} -f json`

## Notes
- Default to read-only unless explicit write command exists.
- Return title + url + basic metrics when available.
