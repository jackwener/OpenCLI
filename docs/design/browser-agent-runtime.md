# Browser Agent Runtime

OpenCLI browser should become reliable for unknown SaaS workflows without
becoming a Playwright clone. The target is an agent-native runtime:

- compact observation that gives an agent the right refs in one call,
- refs that survive common React re-render/stale-node cases,
- real browser input events for user-like interactions,
- a small command surface that reduces calls only when the abstraction is
  proven.

This design was triggered by a customer report: Mercury expense category
dropdowns worked with `agent-browser + Claude Code`, but OpenCLI often failed
to select the category.

## Source Findings

We compared OpenCLI against `vercel-labs/agent-browser` at source level, not
only from documentation.

### What agent-browser Actually Does

The reliable dropdown behavior is not from a full Playwright actionability
pipeline or a magic custom-select command.

- `cli/src/native/interaction.rs`: `click` resolves the target center and sends
  CDP `Input.dispatchMouseEvent` as `mouseMoved`, `mousePressed`,
  `mouseReleased`. It does not run Playwright's full visible/stable/enabled/
  receives-events pipeline.
- `cli/src/native/interaction.rs`: `select_option` only handles native
  `<select>` by mutating selected options and dispatching `change`.
- `cli/src/native/snapshot.rs`: snapshots come from
  `Accessibility.getFullAXTree`, not a DOM walk. Refs carry accessibility
  role/name and backend node id.
- `cli/src/native/element.rs`: ref resolution first tries the cached
  `backendDOMNodeId`; if stale, it re-queries the AX tree by role/name/nth.
  This is the important stale-ref recovery mechanism.
- `cli/src/native/snapshot.rs` and `cli/src/native/actions.rs`: iframe refs
  carry frame context, including dedicated sessions for cross-origin iframes
  when CDP exposes them.
- `cli/src/native/actions.rs`: semantic locators such as `getbyrole` are
  simple JS queries that mark an element with `data-agent-browser-located`,
  then delegate to the same action path.
- `skill-data/core/SKILL.md`: the intended agent loop remains
  `snapshot -> click/fill/type by @ref -> snapshot again`.

Implication: for Mercury-style custom dropdowns, the minimum necessary fix is
real CDP input plus better refs/observation. A one-shot `choose` command is a
later optimization, not the root cause fix.

### Current OpenCLI Gaps

- `src/browser/base-page.ts` and `src/browser/target-resolver.ts`: generic
  `browser click` currently resolves an element and calls DOM `el.click()`
  first. CDP native click is only a fallback when JS click fails. Radix/MUI/
  shadcn controls often open/select on `pointerdown`, `mousedown`, `mouseup`,
  or `pointerup`, so `el.click()` can report success while the UI did not
  change.
- `src/browser/dom-snapshot.ts`: OpenCLI observation is DOM-based. It emits
  useful compact refs, but refs do not have AX role/name/nth fallback semantics
  and are weaker across re-rendered portals.
- OpenCLI already has the right low-level plumbing: `IPage.cdp`,
  `nativeClick`, `nativeType`, `nativeKeyPress`, `setFileInput`, and extension
  CDP passthrough including `Accessibility.getFullAXTree`.
- Extension CDP passthrough already allows `Input.dispatchMouseEvent`,
  `Accessibility.getFullAXTree`, and `DOM.getBoxModel`. It does not currently
  allow `DOM.describeNode`; AX subtree/iframe work must add that allowlist entry
  before depending on it.
- OpenCLI exposes fewer general browser primitives than agent-browser:
  `hover`, `focus`, `check`, `uncheck`, `dblclick`, `drag`, `upload`, and
  `wait download` are not a consistent first-class CLI surface.
- `browser find` is currently CSS-oriented; role/name/label/text locators are
  not first-class for agents.

## Product Position

OpenCLI has two browser jobs:

1. deterministic adapters for known sites,
2. a reliable browser toolbelt for unknown pages and adapter authors.

Borrow from Playwright only where it improves reliability:

- real pointer/mouse/keyboard/file input events,
- selected actionability checks when they prevent silent failures,
- strict locator ambiguity for write actions,
- typed failure reasons.

Do not copy:

- Playwright's test runner, assertion DSL, trace viewer, route/HAR surface, or
  one-to-one API list.

Borrow from agent-browser:

- AX-tree observation,
- compact refs as the default agent selector,
- role/name stale-ref re-resolution,
- iframe-aware refs,
- annotated screenshots mapped to refs,
- a simple snapshot/action loop.

Do not copy blindly:

- broad command sprawl,
- natural-language `act` as the primary runtime,
- route/mock/HAR as near-term browser CLI surface,
- claims that a custom dropdown should be solved by magic if the source system
  itself still uses snapshot/click/snapshot/click.

## Design Principles

- Prefer one reliable primitive over three brittle workarounds.
- Reduce agent calls by improving observation first. A better snapshot can
  avoid many follow-up help/find calls without inventing high-level commands
  prematurely.
- Keep actions transparent. A failed action should return a branchable reason,
  not a generic "click failed".
- Add command surface only when it maps to a distinct browser task and reduces
  real agent calls.
- Keep adapter compatibility explicit. Any change to default click/type/fill
  behavior must run full adapter tests. Escape hatches are emergency plan B, not
  a reason to merge known regressions.

## Architecture

### Native Input Backend

Normalize native input through a small internal backend over existing `IPage`
capabilities:

```ts
interface NativeInputBackend {
  click(point: Point, opts?: ClickOptions): Promise<void>;
  dblclick(point: Point): Promise<void>;
  hover(point: Point): Promise<void>;
  key(key: string, modifiers?: string[]): Promise<void>;
  insertText(text: string): Promise<void>;
  setFiles(selector: string, files: string[]): Promise<void>;
}
```

The Browser Bridge and direct CDP implementation can both use:

- `Input.dispatchMouseEvent`,
- `Input.dispatchKeyEvent`,
- `Input.insertText`,
- `DOM.setFileInputFiles`.

This is the P0 fix for Mercury dropdowns: CDP mouse primary for `click`, with
DOM `el.click()` only as fallback.

This does not change `browser select`. Native `<select>` remains a separate
operation that sets selected options and dispatches `change`, matching both
OpenCLI's current behavior and agent-browser's `select_option` behavior.

### AX Observation And Refs

Add an AX-backed observation path alongside the current DOM snapshot.

Ref identity should include enough data for re-resolution:

```ts
type BrowserRef = {
  ref: string;
  backendNodeId?: number;
  role: string;
  name: string;
  nth?: number;
  frame?: {
    frameId?: string;
    sessionId?: string;
    url?: string;
  };
  bbox?: { x: number; y: number; width: number; height: number };
};
```

Resolution order:

1. cached `backendNodeId`,
2. AX re-query by role/name/nth in the same frame,
3. existing CSS/DOM resolver fallback when the target is not a ref.

The first rollout should be additive:

- keep current `browser state` output stable,
- Phase 0: add an internal or opt-in AX prototype; do not change the default
  `browser state` text output,
- Phase 1 decision point: either promote AX to default observation or keep it
  opt-in,
- decision criteria: fixture pass rate, stale-ref recovery rate, manual SaaS
  results, adapter compatibility, and snapshot token size versus the current DOM
  snapshot.

### Frame Routing

Refs from iframes need frame context so commands can act without manual frame
switching in common cases.

The route should mirror agent-browser's model:

- same-origin iframe: parent session plus `frameId` params where CDP supports
  them,
- cross-origin iframe: dedicated attached target session when available,
- if unsupported: typed `frame_unreachable` with the iframe ref/name/url.

Do not add a global "switch frame" burden to the normal agent path unless the
target cannot be routed automatically.

### Actionability Helper

Do not start with full Playwright actionability. Implement a small helper that
prevents known silent failures:

1. resolve target/ref,
2. scroll into view when CDP supports it,
3. measure a non-zero bounding box,
4. dispatch native input.

Boundary by phase:

- MVP: scroll into view plus non-zero bounding box only.
- Phase 1: add visible/enabled/not-editable checks if the target action needs
  them and compatibility remains clean.
- Phase 2: add stability and receives-events checks only if fixtures or manual
  SaaS cases show real failures.

Each added wait/check has compatibility and latency cost.

Typed statuses:

```ts
type ActionStatus =
  | 'ready'
  | 'not_found'
  | 'stale_ref_recovered'
  | 'stale_ref_unresolved'
  | 'zero_rect'
  | 'not_visible'
  | 'disabled'
  | 'not_editable'
  | 'frame_unreachable'
  | 'native_backend_unavailable';
```

### Semantic Locators

Add semantic locator support after AX refs are in place:

```bash
opencli browser click --role button --name "Submit"
opencli browser fill --label "Email" "me@example.com"
opencli browser get text --testid invoice-total
```

For write operations, ambiguous locators must fail with candidates. They should
not silently choose the first match.

### Command Surface

Keep the surface smaller than agent-browser and Playwright.

Near-term primitives:

```bash
opencli browser click <target>
opencli browser dblclick <target>
opencli browser hover <target>
opencli browser focus <target>
opencli browser check <target>
opencli browser uncheck <target>
opencli browser upload <target> <file...>
opencli browser drag <source> <target>
opencli browser wait download [path]
```

Keep `browser select` native `<select>` only. It should clearly return
`not_a_select` when used on custom controls.

Defer `browser choose <target> <option>` until after the MVP proves the
snapshot/ref/action loop on Mercury-like fixtures. If added later, it should be
a thin deterministic helper for common `combobox/listbox/menu` patterns, not a
general AI `act` command.

## Backward Compatibility

| Area | Risk | Policy |
|---|---|---|
| `browser click` | Native CDP input triggers pointer/mouse handlers that DOM `el.click()` skipped. This is intended, but can expose sites that depended on synthetic click. | Make CDP primary with JS fallback. Run full adapter tests; all new failures are blockers unless proven unrelated. Keep an internal env escape hatch for one release only as emergency rollback support. |
| `browser type` | CDP input can differ from DOM mutation for rich editors. | Keep existing output shape and verification. Prefer native type where already available. |
| `browser fill` | Fill must remain exact replacement, not append typing. | Preserve exact-set semantics; native input only after clearing/focus preparation. |
| `browser select` | Native select behavior is already established. | Do not overload for custom dropdowns. CDP-primary click does not affect `browser select`; it keeps the JS option setter/change-event path. |
| Ref format | Agents and docs depend on compact refs. | Add metadata internally first; avoid breaking text output. |
| Extension support | Older extensions may lack a CDP command. | Detect unsupported backend and return typed diagnostic or fallback. |
| Adapter code | 770+ commands may rely on current page helpers. | Run targeted browser/unit tests plus full adapter tests before changing defaults. |

## Milestones

### Phase 0: Mercury Reliability MVP

Documented in `docs/design/mercury-fix-mvp.md`.

Scope:

- CDP mouse primary for `browser click`,
- Radix/shadcn/MUI-style fixture coverage,
- AX snapshot/ref-map prototype with role/name/nth re-resolution,
- native type/fill normalization where existing behavior is already close.

Out of scope for Phase 0:

- iframe/frame-aware action routing,
- full actionability,
- `browser choose`.

Exit:

- Mercury-like custom select can be completed with
  `snapshot -> click trigger -> snapshot -> click option -> verify`.
- No silent "clicked true but no UI event chain" failure remains for fixture
  dropdowns.
- Existing adapter tests do not regress.
- Quantitative gates from `docs/design/mercury-fix-mvp.md` pass.

### Phase 1: Ref And Observation Upgrade

Scope:

- decide AX default versus opt-in based on Phase 0 metrics,
- AX-backed `browser state` or `browser snapshot` option,
- ref cache that stores backend node id, role/name/nth, frame context,
- iframe-aware action routing,
- annotated screenshot with the same ref ids and sidecar metadata.

Exit:

- Agent can act on iframe refs without manual frame selection in common cases.
- Stale refs from simple React re-renders recover by role/name/nth.
- Snapshot output remains compact enough for normal agent context.

### Phase 2: Browser Toolbelt

Scope:

- `hover`, `focus`, `check`, `uncheck`, `dblclick`, `drag`, `upload`,
  `wait download`,
- semantic locator options for role/name, label, placeholder, text, testid,
- structured ambiguity errors for write locators.

Exit:

- A representative form with text, checkbox/radio, file upload, custom select,
  and submit can be completed without `eval`.
- Agents can usually avoid inventing CSS selectors.

### Phase 3: High-Level Deterministic Helpers

Only after Phase 0/1 metrics justify it:

- `browser choose` for common custom select/combobox/listbox/menu controls,
- optional `browser form inspect` and `browser form fill <json>` for structured
  forms,
- failure artifact bundle: screenshot, refs, target diagnostics, console/
  network summary, and suggested next command.

Do not add a free-form natural-language `act` as the primary interface.

## Success Metrics

Track both reliability and call count.

Mercury-like custom select:

- current OpenCLI baseline: often fails because click is DOM `el.click()`;
- Phase 0 target: reliable 4-step snapshot/action loop, with fixture pass rate
  at least `N-1/N` after recording baseline;
- Phase 3 target, only if warranted: deterministic 1-step `choose` after
  target discovery.

Stale-ref recovery:

- Phase 0 AX prototype target: at least 9/10 repeated React re-render fixture
  runs recover through role/name/nth.

Compatibility:

- Any PR changing default click/type/fill behavior must run full adapter tests.
  New failures are merge blockers unless proven unrelated to the PR.

Fixture matrix:

- Radix Select,
- shadcn Select,
- Material UI Select/Autocomplete,
- native `<select>`,
- checkbox/radio label retarget,
- file upload,
- same-origin iframe form,
- cross-origin iframe where CDP target attach is available.

Manual SaaS matrix:

| Site / app | Scenario | Controls |
|---|---|---|
| Mercury | expense category | custom select, portal |
| Brex | expense category / memo | custom select, text input |
| Ramp | reimbursement category | custom select |
| Stripe Dashboard | filters | combobox, menu |
| Linear | issue fields | combobox |
| Notion | property select | custom select, portal |
| Airtable | field select | custom select, grid |
| Workday | form dropdown | custom select, iframe risk |
| Concur | expense form | custom select, upload |
| GitHub | labels | combobox, portal |

Manual matrix is not a CI gate at first. It is the calibration set for deciding
whether OpenCLI is approaching agent-browser reliability.

Execution process:

- Phase 0 completion: @opencli-质量官 runs Mercury, Brex, and Linear when access
  is available.
- Pass means the relevant category/field can be selected and the form state can
  be saved or committed.
- Failures do not block the already-shipped MVP unless they expose a regression,
  but they become Phase 1 backlog with exact command sequence and failure
  reason.

## Test Strategy

Phase 0:

- unit tests for CDP-primary click fallback behavior,
- local fixture that records pointer/mouse/click event order,
- component fixtures for Radix/shadcn/MUI-style controls,
- stale-ref fixture that re-renders an option after snapshot and verifies
  AX re-resolution,
- direct CDP and Browser Bridge paths where practical.

Regression gates:

```bash
npm run build
npm run typecheck
npm test -- --run src/browser src/cli.test.ts
npm run check:typed-error-lint
npm run check:silent-column-drop
```

Before changing default action behavior, also run the adapter suite on main and
on the branch and compare failures.

## Documentation

Update after Phase 0:

- `skills/opencli-browser/SKILL.md`: recommend snapshot/click/snapshot/click for
  custom dropdowns until `choose` exists.
- Browser command help: explain that `select` is native `<select>` only.
- Troubleshooting: explain `zero_rect`, `not_visible`, `disabled`,
  `frame_unreachable`, `stale_ref_unresolved`, and `native_backend_unavailable`.
- Comparison guide: OpenCLI's goal is not "Playwright in CLI form"; it is an
  adapter-first CLI with reliable agent browser primitives.

## Open Questions

- Should the CDP click escape hatch be public (`--mode js`) or env-only?
  Prefer env-only unless a real adapter regression needs user control.
- Should AX snapshot replace DOM snapshot by default or exist as
  `--source ax` first? Prefer opt-in/prototype first, then promote after
  fixture and manual SaaS validation.
- How much actionability is enough? Start with scroll/rect/visible/enabled.
  Add stability/receives-events only with measured failures.
- Does `browser choose` materially reduce successful Mercury workflows after
  AX refs land? If not, do not add it.
