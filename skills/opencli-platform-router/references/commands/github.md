# github

Use for GitHub issues/PRs/CI queries through OpenCLI external CLI hub.

## Read
- `opencli gh issue list --repo {{repo}} --limit {{limit|20}} -f json`
- `opencli gh pr list --repo {{repo}} --limit {{limit|20}} -f json`
- `opencli gh run list --repo {{repo}} --limit {{limit|10}} -f json`

## Write (confirm required)
- `opencli gh issue comment {{number}} --repo {{repo}} --body "{{text}}"`
- `opencli gh pr merge {{number}} --repo {{repo}} --squash`

## Required args
- list/query: `repo`
- write: `repo`, `number`, `text` (for comment)
