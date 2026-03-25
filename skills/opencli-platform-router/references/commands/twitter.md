# twitter

Use for X/Twitter timeline, search, and posting.

## Read examples
- `opencli twitter timeline -f json`
- `opencli twitter search --query "{{query}}" --limit {{limit|20}} -f json`

## Write examples (require confirmation)
- `opencli twitter post --text "{{text}}"`
- `opencli twitter reply --url "{{url}}" --text "{{text}}"`
- `opencli twitter like --url "{{url}}"`

## Required args
- search: `query`
- reply/like: `url`
- post/reply: `text`
