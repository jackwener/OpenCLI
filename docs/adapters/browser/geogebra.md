# GeoGebra

**Mode**: Browser  |  **Domain**: `www.geogebra.org`

## Commands

| Command | Description |
|---------|-------------|
| `opencli geogebra eval "<cmd1>;<cmd2>;..."` | Execute one or more GeoGebra commands in a fresh automation page |
| `opencli geogebra add-point --name A --coords 1,2` | Create one point |
| `opencli geogebra add-line --points A,B --type segment` | Create a line, segment, or ray from existing points |
| `opencli geogebra add-circle --center A --radius 3` | Create a circle from an existing center |
| `opencli geogebra add-polygon --points A,B,C` | Create a polygon from existing points |
| `opencli geogebra triangle --size 4` | Draw an equilateral triangle |
| `opencli geogebra hexagon --size 3` | Draw a regular hexagon |
| `opencli geogebra list` | List current objects on the canvas |
| `opencli geogebra info --name A` | Inspect one object |

## Two Workflows

### 1. Fresh automation page

Use the site command directly when OpenCLI is allowed to open its own GeoGebra page.

```bash
opencli geogebra triangle --size 4
opencli geogebra eval "A=(0,0);B=(4,0);c=Circle(A,B);d=Circle(B,A);C=Intersect(c,d,1);Polygon(A,B,C)"
```

Important:

- Each `opencli geogebra ...` command runs in its own fresh browser session.
- `add-point`, `triangle`, and `hexagon` are self-contained and work on a blank Geometry canvas.
- `add-line`, `add-circle`, `add-polygon`, `list`, and `info` need an already-populated canvas or a bound tab workflow.
- For multi-step constructions, prefer one `eval` call with semicolon-separated commands, or use a shape-specific helper like `triangle`.

### 2. Already-open user tab

Use this when a human or another agent already has the right `geogebra.org` tab open and you want to draw in that exact tab.

```bash
opencli browser bind --workspace bound:geogebra --domain www.geogebra.org
opencli browser --workspace bound:geogebra get url
opencli browser --workspace bound:geogebra eval "(() => {
  const cmds = [
    'OCLIA=(0,0)',
    'OCLIB=(4,0)',
    'OCLIc=Circle(OCLIA,OCLIB)',
    'OCLId=Circle(OCLIB,OCLIA)',
    'OCLIC=Intersect(OCLIc,OCLId,1)',
    'OCLIt=Polygon(OCLIA,OCLIB,OCLIC)',
  ];
  return cmds.map(cmd => ({ cmd, label: ggbApplet.evalCommandGetLabels(cmd) }));
})()"
```

This bound-tab workflow is the safest option when:

- the user explicitly asks to use an existing Chrome tab
- the tab is already positioned the way the user wants
- you do not want OpenCLI to navigate away or replace the user's page state

## Geometry Notes

- On the GeoGebra Geometry page, `RegularPolygon(...)` is not reliable here and may show an "unknown command" error.
- Prefer explicit constructions built from `Circle`, `Intersect`, `Segment`, and `Polygon`.
- `ggbApplet.evalCommandGetLabels(...)` can return multiple labels for commands like `Polygon(...)`; that is expected.
- The source of truth is the page's `ggbApplet` API. Adapter commands treat applet load failures, malformed Browser Bridge/evaluate results, invalid object labels, invalid numeric arguments, and failed GeoGebra command execution as typed command failures instead of returning success rows.
- Object names accepted by helper commands are intentionally conservative ASCII labels (`A`, `B1`, `poly_1`). Use `geogebra eval` for advanced GeoGebra syntax that needs broader command text.

## Agent Notes

- Start with `opencli doctor` if Browser Bridge behavior looks stale.
- If the user wants the current visible tab, bind first and operate through `opencli browser --workspace bound:geogebra ...`.
- If a fresh page is acceptable, use `opencli geogebra eval ...` or `opencli geogebra triangle`.
- Use unique temporary labels like `OCLIA`, `OCLIB`, `OCLIC` in bound tabs to avoid colliding with the user's existing objects.

## Prerequisites

- Chrome running
- [Browser Bridge extension](/guide/browser-bridge) installed
- A `www.geogebra.org/geometry` page that has fully loaded
