# Mercury Dropdown MVP

This is the short-term implementation slice for the Mercury expense category
failure. It is intentionally smaller than the full browser-agent-runtime
roadmap.

## Problem

Mercury-style category controls are usually custom React dropdowns. The trigger
and option are not native `<select>` elements. Libraries such as Radix UI,
Material UI, and shadcn commonly open or commit selection on pointer/mouse down
or up events.

OpenCLI's generic `browser click` currently calls DOM `el.click()` first. That
only dispatches a click event, so OpenCLI can return success while the dropdown
never opened or the option never committed.

`agent-browser` succeeds in this class mainly because its click path sends real
CDP mouse events. It still uses the normal loop:

```bash
snapshot
click trigger
snapshot
click option
snapshot or get value
```

It does not have a general one-shot custom-dropdown `choose` command.

## MVP Scope

### 1. CDP Mouse Primary

Change generic `browser click` to:

1. resolve target,
2. scroll/measure target,
3. send CDP `Input.dispatchMouseEvent` sequence:
   `mouseMoved -> mousePressed -> mouseReleased`,
4. fall back to DOM `el.click()` only when native click is unavailable or the
   target has no usable point.

Required output behavior:

- keep existing success shape,
- add diagnostics only as additive fields if needed,
- never report success from JS click before trying CDP when CDP is available.

### 2. Real Component Fixture

Add a local browser fixture that records event order and selected value.

Minimum cases:

- Radix/shadcn-like select:
  - trigger opens on `pointerdown`,
  - option selects on `pointerup` or `mousedown`,
  - menu is rendered in a portal.
- Material UI-like autocomplete:
  - combobox input opens popup,
  - option list is outside the trigger subtree.
- Native `<select>` remains covered by existing `browser select`.

Pass condition:

- DOM `el.click()` path fails at least one custom case in the fixture,
- CDP-primary click passes the same case,
- OpenCLI verifies the selected text/value changed.

### 3. AX Snapshot Prototype

Add an AX-backed snapshot/ref-map prototype behind a non-breaking option or
internal test helper.

Required data per ref:

```ts
type BrowserRef = {
  ref: string;
  backendNodeId?: number;
  role: string;
  name: string;
  nth?: number;
  frame?: { frameId?: string; sessionId?: string; url?: string };
};
```

Required behavior:

- build refs from `Accessibility.getFullAXTree`,
- use `backendDOMNodeId` as the fast path for action resolution,
- if that id is stale, re-query the AX tree by role/name/nth,
- keep current DOM snapshot text output stable until the AX path is proven.

This is the part that should learn most directly from `agent-browser`.

### 4. Native Type/Fill Normalization

Review existing `nativeType` and `fillText` paths and make them consistent with
the native-input backend:

- focus through CDP when possible,
- use `Input.insertText` for printable text,
- keep `fill` exact-replacement semantics,
- keep existing verification as the authority for fill success.

Do not expand this into a full actionability rewrite in the MVP.

## Non-Goals

- No full Playwright actionability pipeline.
- No broad Playwright API clone.
- No general natural-language `act`.
- No one-shot `browser choose` in this MVP.
- No route/HAR/mock/trace-viewer surface.

`browser choose` can be considered after this MVP if measurements show that the
snapshot/click/snapshot/click loop is reliable but still too expensive for
agents.

## PR Breakdown

### PR 1: CDP-Primary Click

- flip generic click to CDP-first,
- keep JS fallback,
- add event-order fixture tests,
- run browser/unit/adapter gates.

This corresponds to the immediate Mercury reliability fix.

### PR 2: AX Ref Prototype

- add AX tree fetch through existing `page.cdp`,
- create internal `BrowserRef` map,
- implement cached backend id resolution plus role/name/nth fallback,
- add stale React re-render fixture.

Keep this additive. Do not replace `browser state` default in the same PR.

### PR 3: Frame-Aware Ref Routing

- carry same-origin `frameId` and cross-origin session id when available,
- route click/fill/type by ref frame context,
- return typed `frame_unreachable` when not possible,
- add iframe fixture.

### PR 4: Promote And Document

- decide whether AX becomes default observation or an explicit `--source ax`,
- update `skills/opencli-browser/SKILL.md`,
- add troubleshooting docs and fixture examples,
- record manual Mercury or Mercury-equivalent validation.

## Compatibility Plan

| Change | Compatibility risk | Mitigation |
|---|---|---|
| CDP click primary | Event order changes from synthetic click to real mouse sequence. | This is desired for dropdowns. Keep JS fallback and env escape hatch for one release if a real adapter regresses. |
| AX refs | Ref internals change; text output should not. | Add AX map internally first; preserve visible state format. |
| Stale-ref recovery | A stale ref may now resolve to a new node with same role/name/nth. | Only use fallback for refs, not arbitrary CSS selectors; include diagnostic field when recovery happens. |
| Frame routing | Actions may reach iframe elements that previously failed. | Add typed errors for unsupported frames instead of silent fallback. |

## Exit Criteria

- A custom dropdown fixture that depends on pointer/mouse events passes through
  `browser click`.
- A portal-rendered option can be selected with the normal
  snapshot/click/snapshot/click loop.
- A stale React-ref fixture recovers through AX role/name/nth.
- Existing browser tests and adapter tests pass.
- Documentation tells agents the correct current recipe and does not promise
  `choose` until it exists.

## Validation Commands

```bash
npm run build
npm run typecheck
npm test -- --run src/browser src/cli.test.ts
npm run check:typed-error-lint
npm run check:silent-column-drop
```

Before merging a default behavior change:

```bash
npm test -- --run
```

If full tests are too slow in the review loop, run full adapter tests at least
once before merge and report any difference from main.
