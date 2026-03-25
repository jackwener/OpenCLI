# workflow: content-post

1. Gather references from target platform and one peer platform.
2. Draft text and show preview.
3. Ask explicit confirmation.
4. Execute write command.

Example:
- `opencli twitter search --query "{{topic}}" --limit 10 -f json`
- preview draft
- confirm
- `opencli twitter post --text "{{final_text}}"`
