# Uiverse

**Mode**: 🔐 Browser · **Domain**: `uiverse.io`

## Commands

| Command | Description |
|---------|-------------|
| `opencli uiverse code <input> --target html` | Export the raw component HTML |
| `opencli uiverse code <input> --target css` | Export the raw component CSS |
| `opencli uiverse code <input> --target react` | Export the React version shown in the Export dialog |
| `opencli uiverse code <input> --target vue` | Export the Vue single-file component shown in the Export dialog |
| `opencli uiverse preview <input>` | Capture only the component preview element, not the full page |

## Input Format

`<input>` supports two forms:

- Full URL: `https://uiverse.io/Galahhad/strong-squid-82`
- Short form: `Galahhad/strong-squid-82`

## Usage Examples

```bash
# Export HTML
opencli uiverse code "Galahhad/strong-squid-82" --target html -f json

# Export CSS
opencli uiverse code "Galahhad/strong-squid-82" --target css -f json

# Export React
opencli uiverse code "Galahhad/strong-squid-82" --target react -f json

# Export Vue
opencli uiverse code "Galahhad/strong-squid-82" --target vue -f json

# Capture only the preview element
opencli uiverse preview "Galahhad/strong-squid-82" --output ./uiverse-preview.png -f json
```

## Notes

- The `code` command resolves the component `post.id` from the detail page, then reads page loader data or the backing data endpoint.
- `react` and `vue` exports depend on the page's Export dialog, so they require Browser Bridge and a working browser session.
- `preview` uses the component HTML root signature plus visible-page heuristics to crop the preview element only.
- If `--output` is omitted, `preview` writes the PNG to a system temporary path.
- `--padding` defaults to `8` pixels and adds extra space around the cropped component.

## Prerequisites

- Chrome running
- [Browser Bridge extension](/guide/browser-bridge) installed
