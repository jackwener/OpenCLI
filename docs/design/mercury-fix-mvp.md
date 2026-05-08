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

### 0. Extension CDP Capability Check

The MVP depends on Chrome debugger CDP passthrough. Unlike agent-browser,
OpenCLI usually reaches Chrome through the extension, so command availability
must be explicit.

Current status:

| CDP command | Extension status | MVP action |
|---|---|---|
| `Input.dispatchMouseEvent` | Allowed in `extension/src/background.ts` CDP passthrough and already used by `nativeClick`. | No extension change for PR 1. |
| `Accessibility.getFullAXTree` | Allowed in CDP passthrough. | No extension change for AX fetch. |
| `DOM.getBoxModel` | Allowed in CDP passthrough. | No extension change for CDP point measurement. |
| `DOM.describeNode` | Not currently in the CDP passthrough allowlist. | Add to allowlist before AX iframe/subtree work. |

Therefore PR 1 can ship without extension changes. PR 2 must either avoid
`DOM.describeNode` or include the small extension allowlist addition in the same
PR. If AX re-resolution needs `DOM.resolveNode`, that command must be added and
tested at the same time rather than assumed.

### 1. CDP Mouse Primary

Change generic `browser click` to:

1. resolve target,
2. scroll into view and measure a non-zero target box,
3. send CDP `Input.dispatchMouseEvent` sequence:
   `mouseMoved -> mousePressed -> mouseReleased`,
4. fall back to DOM `el.click()` only when native click is unavailable or the
   target has no usable point.

Required output behavior:

- keep existing success shape,
- add diagnostics only as additive fields if needed,
- never report success from JS click before trying CDP when CDP is available.

This applies only to click-like actions: `browser click` and later
`browser dblclick`. It does not change `browser select`; native `<select>`
continues to use the existing JS option setter/change-event path.

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

- Before PR 1, run and record baseline pass rate. At least one custom fixture
  case must fail on the DOM `el.click()` path.
- After PR 1, custom fixture pass rate must be at least `N-1/N`, where `N` is
  the number of custom dropdown cases in the fixture.
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

Success metric:

- stale-ref recovery fixture must pass at least 9/10 repeated React re-render
  runs by resolving through AX role/name/nth.

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

### PR 0: Extension Allowlist For AX Prototype

Only needed if PR 2 uses commands that are not already allowed.

- add `DOM.describeNode` to CDP passthrough allowlist,
- add `DOM.resolveNode` only if the implementation needs it,
- add extension tests that blocked commands remain blocked and allowed AX/DOM
  commands pass.

### PR 1: CDP-Primary Click

- flip generic click to CDP-first,
- keep JS fallback,
- add event-order fixture tests,
- run browser/unit gates and full adapter tests,
- list every new adapter failure compared with main and fix them before merge.

This corresponds to the immediate Mercury reliability fix.

### PR 2: AX Ref Prototype

- add AX tree fetch through existing `page.cdp`,
- create internal `BrowserRef` map,
- implement cached backend id resolution plus role/name/nth fallback,
- add stale React re-render fixture.

Keep this additive. Do not replace `browser state` default in the same PR.

Frame-aware routing is not part of the MVP. It moves to Phase 1 because the
Mercury exit criteria do not require iframe support.

Status after implementation:

- PR 1 shipped CDP-primary click and component fixtures.
- PR 2 shipped opt-in `browser state --source ax`, backend-node ref clicks, and
  stale role/name/nth recovery.
- Phase 1 same-origin iframe refs shipped for AX snapshots; cross-origin
  session routing remains deferred.
- Phase 1 metrics shipped as `browser state --compare-sources` so AX default
  promotion can be decided from measured DOM-vs-AX data.

## Phase 1 Follow-Up

- carry same-origin `frameId` and cross-origin session id when available,
- route click/fill/type by ref frame context,
- return typed `frame_unreachable` when not possible,
- add iframe fixture.

- decide whether AX becomes default observation or an explicit `--source ax`,
- update `skills/opencli-browser/SKILL.md`,
- add troubleshooting docs and fixture examples,
- record manual Mercury or Mercury-equivalent validation.

## Compatibility Plan

| Change | Compatibility risk | Mitigation |
|---|---|---|
| CDP click primary | Event order changes from synthetic click to real mouse sequence. | This is desired for dropdowns. PR 1 must run full adapter tests; all new failures must be listed and fixed before merge. Keep `OPENCLI_BROWSER_CLICK=js` as emergency plan B for one release, not as a substitute for fixing tests. |
| AX refs | Ref internals change; text output should not. | Add AX map internally first; preserve visible state format. |
| Stale-ref recovery | A stale ref may now resolve to a new node with same role/name/nth. | Only use fallback for refs, not arbitrary CSS selectors; include diagnostic field when recovery happens. |
| Frame routing | Actions may reach iframe elements that previously failed. | Phase 1 only. Add typed errors for unsupported frames instead of silent fallback. |
| Native select | Risk of accidental behavior change if "click-like" is interpreted broadly. | Out of scope for PR 1. `browser select` keeps JS option setter/change-event behavior. |

## Exit Criteria

- A custom dropdown fixture that depends on pointer/mouse events passes through
  `browser click`.
- A portal-rendered option can be selected with the normal
  snapshot/click/snapshot/click loop.
- A stale React-ref fixture recovers through AX role/name/nth.
- Existing browser tests and adapter tests pass.
- Documentation tells agents the correct current recipe and does not promise
  `choose` until it exists.

Quantitative gates:

- Custom dropdown fixtures: record baseline before PR 1, then pass at least
  `N-1/N` custom cases after PR 1.
- Stale-ref recovery: pass at least 9/10 repeated re-render runs after PR 2.
- Adapter compatibility: zero unexplained new full-adapter-test failures before
  a default behavior PR merges.

Manual SaaS check:

- After Phase 0, @opencli-质量官 runs Mercury, Brex, and Linear manually when
  credentials/access are available.
- Pass means the workflow can select the relevant category/field and save or
  commit the form state.
- For each site, also run `opencli browser state --compare-sources` on the form
  page and record `sources.dom.refs`, `sources.ax.refs`, `frame_sections`,
  `approx_tokens`, `elapsed_ms`, and any per-source `error`.
- Failure does not block MVP retroactively, but each failure must be recorded as
  a Phase 1 backlog item with observed command sequence and failure reason.

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
