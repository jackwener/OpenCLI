# Convention Audit

`opencli convention-audit` scans adapter metadata plus source files for common
agent-native convention violations.

The command is intentionally report-first. It gives agents a shared fact base
before starting a sweep PR; `--strict` can be used later by CI gates.

## Usage

```bash
opencli convention-audit
opencli convention-audit --site twitter
opencli convention-audit twitter/search
opencli convention-audit --site pixiv -f yaml
opencli convention-audit --strict
```

Formats:

- `table` prints a grouped human-readable report.
- `yaml` is the recommended agent-facing format.
- `json` is available for stricter machine consumers.

## Rules

The first version reports these categories:

- `silent-column-drop`: source rows emit top-level keys that are not present in `columns`.
- `camelCase-in-columns`: output columns should use stable snake_case keys.
- `missing-access-metadata`: every adapter command must declare `access: 'read' | 'write'`.
- `silent-clamp`: `Math.min(...limit...)` can silently change user input instead of throwing `ArgumentError`.
- `silent-empty-fallback`: `return []` can hide fetch/parse failures from agents.
- `silent-sentinel`: `?? 'unknown'` / `|| 'N/A'` style fallbacks can turn missing data into fake data.
- `write-without-delete-pair`: write commands such as `like`, `save`, `follow`, `create`, or `post` should have an undo/delete counterpart when the site supports one.

The scanners are heuristic. Treat reports as prioritized review input by
default, then turn a specific rule into a strict CI gate only after the current
violations and exemptions are understood.

## CI Gates

`npm run check:silent-column-drop` enforces the `silent-column-drop` rule in
baseline mode. The baseline file is
`scripts/silent-column-drop-baseline.json`.

`npm run check:typed-error-lint` enforces the silent failure rules in baseline
mode:

- `silent-clamp`
- `silent-empty-fallback`
- `silent-sentinel`

The baseline file is `scripts/typed-error-lint-baseline.json`.

Each gate fails only on new violations beyond its baseline. This lets the repo
adopt the invariant immediately while existing findings are cleaned up in
separate sweep PRs.

When a sweep fixes existing silent-column-drop entries, update the baseline:

```bash
npm run build
node scripts/check-silent-column-drop.mjs --update-baseline
```

When a sweep fixes existing typed-error findings, update the baseline:

```bash
npm run build
node scripts/check-typed-error-lint.mjs --update-baseline
```
