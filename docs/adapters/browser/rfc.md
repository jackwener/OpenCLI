# IETF RFC

**Mode**: 🌐 Public · **Domain**: `datatracker.ietf.org`

Fetch metadata for any IETF RFC by number — title, abstract, publishing working group, authors, std level, page count, publish date, plus links into the RFC Editor and datatracker. Hits the unauthenticated IETF datatracker directly.

## Commands

| Command | Description |
|---------|-------------|
| `opencli rfc rfc <number>` | Single IETF RFC metadata (title, abstract, working group, authors, std level) |

## Usage Examples

```bash
# Modern RFCs
opencli rfc rfc 9000     # QUIC
opencli rfc rfc 9110     # HTTP semantics

# Classic RFCs
opencli rfc rfc 791      # IP
opencli rfc rfc 2616     # HTTP/1.1 (now obsoleted by 9110)

# Courtesy: "rfcN" prefix accepted
opencli rfc rfc rfc9000
```

## Output Columns

| Command | Columns |
|---------|---------|
| `rfc` | `rfc, title, state, stdLevel, group, groupType, pages, published, authors, abstract, rfcEditorUrl, url` |

## Options

### `rfc`

| Option | Description |
|--------|-------------|
| `number` (positional) | RFC number (positive integer ≤ 999999). The `rfc` prefix is accepted as a courtesy. |

## Notes

- **`abstract` is the full IETF abstract** — RFCs don't truncate well, so the adapter never drops content.
- **`stdLevel`** classifies the document (e.g. `Proposed Standard`, `Internet Standard`, `Best Current Practice`, `Informational`, `Experimental`, `Historic`).
- **`group`** is the working group / area / IRTF research group that published the RFC; `groupType` distinguishes (e.g. `WG`, `IETF`).
- **`rfcEditorUrl`** points at the canonical RFC Editor copy (text/HTML); `url` points at the IETF datatracker page (with rev history, related drafts, and stats).
- **No API key required.** Datatracker is fast but bursts can return `HTTP 429` → `CommandExecutionError`.
- **Errors.** Non-numeric input or out-of-range RFC number → `ArgumentError`; unknown RFC → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
