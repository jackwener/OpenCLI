/**
 * BasePage — shared IPage method implementations for DOM helpers.
 *
 * Both Page (daemon-backed) and CDPPage (direct CDP) execute JS the same way
 * for DOM operations. This base class deduplicates ~200 lines of identical
 * click/type/scroll/wait/snapshot/interceptor methods.
 *
 * Subclasses implement the transport-specific methods: goto, evaluate,
 * getCookies, screenshot, tabs, etc.
 */

import type { BrowserCookie, FetchJsonOptions, IPage, ScreenshotOptions, SnapshotOptions, WaitOptions } from '../types.js';
import { generateSnapshotJs, getFormStateJs } from './dom-snapshot.js';
import { buildAxSnapshotFromTrees, findAxRefReplacement, type AxSnapshotTree, type BrowserRef } from './ax-snapshot.js';
import {
  pressKeyJs,
  waitForTextJs,
  waitForCaptureJs,
  waitForSelectorJs,
  scrollJs,
  autoScrollJs,
  networkRequestsJs,
  waitForDomStableJs,
} from './dom-helpers.js';
import {
  resolveTargetJs,
  boundingRectResolvedJs,
  clickResolvedJs,
  typeResolvedJs,
  prepareNativeTypeResolvedJs,
  verifyFilledResolvedJs,
  scrollResolvedJs,
  type FillResolvedResult,
  type ResolveOptions,
  type TargetMatchLevel,
} from './target-resolver.js';
import { TargetError, type TargetErrorCode } from './target-errors.js';
import { CliError } from '../errors.js';
import { formatSnapshot } from '../snapshotFormatter.js';

export interface ResolveSuccess {
  matches_n: number;
  /**
   * Cascading stale-ref tier the resolver traversed. Callers surface this to
   * agents so `stable` / `reidentified` hits are visibly distinct from a
   * clean `exact` match — the page changed, the action still succeeded.
   */
  match_level: TargetMatchLevel;
}

export interface FillTextResult extends ResolveSuccess {
  filled: boolean;
  verified: boolean;
  expected: string;
  actual: string;
  length: number;
  mode?: 'input' | 'textarea' | 'contenteditable';
}

export interface SetCheckedResult extends ResolveSuccess {
  checked: boolean;
  changed: boolean;
  kind?: string;
}

export interface UploadFilesResult extends ResolveSuccess {
  uploaded: boolean;
  files: number;
  file_names: string[];
  target: string;
  multiple?: boolean;
  accept?: string;
}

export interface DragResult {
  dragged: boolean;
  source: string;
  target: string;
  source_matches_n: number;
  target_matches_n: number;
  source_match_level: TargetMatchLevel;
  target_match_level: TargetMatchLevel;
}

interface CdpFrameTreeNode {
  frame?: { id?: string; url?: string; unreachableUrl?: string; name?: string };
  childFrames?: CdpFrameTreeNode[];
}

/**
 * Execute `resolveTargetJs` once, throw structured `TargetError` on failure.
 * Single helper so click/typeText/scrollTo share one resolution pathway,
 * which is what the selector-first contract promises agents.
 */
async function runResolve(
  page: { evaluate(js: string): Promise<unknown> },
  ref: string,
  opts: ResolveOptions = {},
): Promise<ResolveSuccess> {
  const resolution = (await page.evaluate(resolveTargetJs(ref, opts))) as
    | { ok: true; matches_n: number; match_level: TargetMatchLevel }
    | { ok: false; code: TargetErrorCode; message: string; hint: string; candidates?: string[]; matches_n?: number };
  if (!resolution.ok) {
    throw new TargetError({
      code: resolution.code,
      message: resolution.message,
      hint: resolution.hint,
      candidates: resolution.candidates,
      matches_n: resolution.matches_n,
    });
  }
  return { matches_n: resolution.matches_n, match_level: resolution.match_level };
}

function previewText(text: string | undefined): string | undefined {
  const preview = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return preview ? `Response preview: ${preview}` : undefined;
}

function parseKeyChord(rawKey: string): { key: string; modifiers: string[] } {
  const parts = rawKey.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) return { key: rawKey, modifiers: [] };

  const modifiers: string[] = [];
  for (const token of parts.slice(0, -1)) {
    const normalized = token.toLowerCase();
    if (normalized === 'ctrl' || normalized === 'control') modifiers.push('Ctrl');
    else if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') modifiers.push('Meta');
    else if (normalized === 'option' || normalized === 'alt') modifiers.push('Alt');
    else if (normalized === 'shift') modifiers.push('Shift');
    else return { key: rawKey, modifiers: [] };
  }

  const key = parts.at(-1);
  return key ? { key, modifiers } : { key: rawKey, modifiers: [] };
}

export abstract class BasePage implements IPage {
  protected _lastUrl: string | null = null;
  /** Cached previous snapshot hashes for incremental diff marking */
  private _prevSnapshotHashes: string | null = null;
  private _cdpTargetMarkerSeq = 0;
  private _axRefs = new Map<string, BrowserRef>();

  // ── Transport-specific methods (must be implemented by subclasses) ──

  abstract goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number; allowBoundNavigation?: boolean }): Promise<void>;
  abstract evaluate(js: string): Promise<unknown>;

  /**
   * Safely evaluate JS with pre-serialized arguments.
   * Each key in `args` becomes a `const` declaration with JSON-serialized value,
   * prepended to the JS code. Prevents injection by design.
   *
   * Usage:
   *   page.evaluateWithArgs(`(async () => { return sym; })()`, { sym: userInput })
   */
  async evaluateWithArgs(js: string, args: Record<string, unknown>): Promise<unknown> {
    const declarations = Object.entries(args)
      .map(([key, value]) => {
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
          throw new Error(`evaluateWithArgs: invalid key "${key}"`);
        }
        return `const ${key} = ${JSON.stringify(value)};`;
      })
      .join('\n');
    return this.evaluate(`${declarations}\n${js}`);
  }

  async fetchJson(url: string, opts: FetchJsonOptions = {}): Promise<unknown> {
    const request = {
      url,
      method: opts.method ?? 'GET',
      headers: opts.headers ?? {},
      body: opts.body,
      hasBody: opts.body !== undefined,
      timeoutMs: opts.timeoutMs ?? 15_000,
    };

    const result = await this.evaluateWithArgs(`
      (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), request.timeoutMs);
        try {
          const headers = { Accept: 'application/json', ...request.headers };
          const init = {
            method: request.method,
            credentials: 'include',
            headers,
            signal: ctrl.signal,
          };
          if (request.hasBody) {
            if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
              headers['Content-Type'] = 'application/json';
            }
            init.body = JSON.stringify(request.body);
          }
          const resp = await fetch(request.url, init);
          const text = await resp.text();
          return {
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText,
            url: resp.url,
            contentType: resp.headers.get('content-type') || '',
            text,
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            statusText: '',
            url: request.url,
            contentType: '',
            text: '',
            error: error instanceof Error ? error.message : String(error),
          };
        } finally {
          clearTimeout(timer);
        }
      })()
    `, { request }) as {
      ok?: boolean;
      status?: number;
      statusText?: string;
      url?: string;
      contentType?: string;
      text?: string;
      error?: string;
    };

    const targetUrl = result.url || url;
    if (result.error) {
      throw new CliError(
        'FETCH_ERROR',
        `Browser fetch failed for ${targetUrl}: ${result.error}`,
        'Check that the page is reachable and the current browser profile has access.',
      );
    }
    if (!result.ok) {
      throw new CliError(
        'FETCH_ERROR',
        `HTTP ${result.status ?? 0}${result.statusText ? ` ${result.statusText}` : ''} from ${targetUrl}`,
        previewText(result.text),
      );
    }

    const text = result.text ?? '';
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      const contentType = result.contentType ? ` (${result.contentType})` : '';
      throw new CliError(
        'FETCH_ERROR',
        `Expected JSON from ${targetUrl}${contentType}`,
        previewText(text),
      );
    }
  }

  abstract getCookies(opts?: { domain?: string; url?: string }): Promise<BrowserCookie[]>;
  abstract screenshot(options?: ScreenshotOptions): Promise<string>;
  abstract tabs(): Promise<unknown[]>;
  abstract selectTab(target: number | string): Promise<void>;

  // ── Shared DOM helper implementations ──

  async click(ref: string, opts: ResolveOptions = {}): Promise<ResolveSuccess> {
    const axClick = await this.tryClickAxRef(ref);
    if (axClick) return axClick;

    // Phase 1: Resolve target with fingerprint verification
    const resolved = await runResolve(this, ref, opts);
    const nativeScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');

    // Phase 2: measure first so native click can run before DOM el.click().
    // Custom dropdowns often listen to pointer/mouse down/up; DOM el.click()
    // only fires click and can silently report success without opening/selecting.
    const rect = await this.evaluate(boundingRectResolvedJs({ skipScroll: nativeScrolled })) as
      | { x: number; y: number; w: number; h: number; visible: boolean }
      | null;

    if (rect?.visible === true) {
      const success = await this.tryNativeClick(rect.x, rect.y);
      if (success) return resolved;
    }

    // JS fallback for older backends or zero-rect targets.
    const result = await this.evaluate(clickResolvedJs({ skipScroll: nativeScrolled })) as
      | string
      | { status: string; x?: number; y?: number; w?: number; h?: number; error?: string }
      | null;

    if (typeof result === 'string' || result == null) return resolved;

    if (result.status === 'clicked') return resolved;

    // JS click failed — try CDP native click if coordinates available
    if (result.x != null && result.y != null) {
      const success = await this.tryNativeClick(result.x, result.y);
      if (success) return resolved;
    }

    throw new Error(`Click failed: ${result.error ?? 'JS click and CDP fallback both failed'}`);
  }

  /** Uses native CDP click support when the concrete page exposes it. */
  protected async tryNativeClick(x: number, y: number): Promise<boolean> {
    const nativeClick = (this as IPage).nativeClick;
    if (typeof nativeClick !== 'function') return false;
    try {
      await nativeClick.call(this, x, y);
      return true;
    } catch {
      return false;
    }
  }

  protected async tryNativeMouseMove(x: number, y: number): Promise<boolean> {
    const cdp = (this as IPage).cdp;
    if (typeof cdp !== 'function') return false;
    try {
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      return true;
    } catch {
      return false;
    }
  }

  protected async tryNativeDoubleClick(x: number, y: number): Promise<boolean> {
    const cdp = (this as IPage).cdp;
    if (typeof cdp !== 'function') return false;
    try {
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 });
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 });
      return true;
    } catch {
      return false;
    }
  }

  protected async tryNativeDrag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<boolean> {
    const cdp = (this as IPage).cdp;
    if (typeof cdp !== 'function') return false;
    const midX = Math.round((from.x + to.x) / 2);
    const midY = Math.round((from.y + to.y) / 2);
    try {
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: midX, y: midY, button: 'left', buttons: 1 });
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1 });
      await cdp.call(this, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
      return true;
    } catch {
      return false;
    }
  }

  protected async tryClickAxRef(ref: string): Promise<ResolveSuccess | null> {
    if (!/^\d+$/.test(ref)) return null;
    const entry = this._axRefs.get(ref);
    if (!entry) return null;
    const nativeClick = (this as IPage).nativeClick;
    if (typeof nativeClick !== 'function') return null;

    const resolved = await this.resolveAxRefPoint(entry);
    if (!resolved) return null;
    try {
      await nativeClick.call(this, resolved.x, resolved.y);
      return { matches_n: 1, match_level: resolved.matchLevel };
    } catch {
      return null;
    }
  }

  private async resolveAxRefPoint(entry: BrowserRef): Promise<{ x: number; y: number; matchLevel: TargetMatchLevel } | null> {
    const cdp = (this as IPage).cdp;
    if (typeof cdp !== 'function') return null;

    if (entry.backendNodeId != null) {
      const point = await this.axBoxCenter(entry.backendNodeId).catch(() => null);
      if (point) return { ...point, matchLevel: 'exact' };
    }

    await cdp.call(this, 'Accessibility.enable', {});
    const axTree = await cdp.call(this, 'Accessibility.getFullAXTree', axTreeParams(entry.frame)).catch(() => null);
    const recovered = findAxRefReplacement(axTree, entry);
    if (!recovered?.backendNodeId) return null;
    this._axRefs.set(entry.ref, recovered);
    const point = await this.axBoxCenter(recovered.backendNodeId).catch(() => null);
    return point ? { ...point, matchLevel: 'reidentified' } : null;
  }

  private async axBoxCenter(backendNodeId: number): Promise<{ x: number; y: number } | null> {
    const cdp = (this as IPage).cdp;
    if (typeof cdp !== 'function') return null;
    const result = await cdp.call(this, 'DOM.getBoxModel', { backendNodeId }) as
      | { model?: { content?: unknown[]; border?: unknown[] } }
      | null;
    const quad = Array.isArray(result?.model?.content) && result.model.content.length >= 8
      ? result.model.content
      : Array.isArray(result?.model?.border) && result.model.border.length >= 8
        ? result.model.border
        : null;
    if (!quad) return null;
    const nums = quad.slice(0, 8).map((value) => typeof value === 'number' ? value : Number(value));
    if (nums.some((value) => !Number.isFinite(value))) return null;
    return {
      x: Math.round((nums[0] + nums[2] + nums[4] + nums[6]) / 4),
      y: Math.round((nums[1] + nums[3] + nums[5] + nums[7]) / 4),
    };
  }

  /** Uses native CDP text insertion when the concrete page exposes it. */
  protected async tryNativeType(text: string): Promise<boolean> {
    const nativeType = (this as IPage).nativeType;
    if (typeof nativeType === 'function') {
      try {
        await nativeType.call(this, text);
        return true;
      } catch {
        // Fall through to the older dedicated insertText primitive if present.
      }
    }

    const insertText = (this as IPage).insertText;
    if (typeof insertText !== 'function') return false;
    try {
      await insertText.call(this, text);
      return true;
    } catch {
      return false;
    }
  }

  /** Uses native CDP key events when the concrete page exposes them. */
  protected async tryNativeKeyPress(key: string, modifiers: string[]): Promise<boolean> {
    const nativeKeyPress = (this as IPage).nativeKeyPress;
    if (typeof nativeKeyPress !== 'function') return false;
    try {
      await nativeKeyPress.call(this, key, modifiers);
      return true;
    } catch {
      return false;
    }
  }

  protected async isResolvedFocused(): Promise<boolean> {
    try {
      return await this.evaluate(`
        (() => {
          const el = window.__resolved;
          return !!el && (document.activeElement === el || (typeof el.matches === 'function' && el.matches(':focus')));
        })()
      `) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Run a DOM-domain CDP command against `window.__resolved`.
   *
   * CDP DOM.focus / DOM.scrollIntoViewIfNeeded need a nodeId, while our
   * resolver stores the live Element in page JS. Bridge the two worlds with a
   * short-lived marker attribute, then query it through CDP.
   */
  protected async tryCdpOnResolvedElement(method: 'DOM.focus' | 'DOM.scrollIntoViewIfNeeded'): Promise<boolean> {
    const cdp = (this as IPage).cdp;
    if (typeof cdp !== 'function') return false;

    const markerAttr = 'data-opencli-cdp-target';
    const markerValue = `${Date.now().toString(36)}-${++this._cdpTargetMarkerSeq}`;
    const selector = `[${markerAttr}="${markerValue}"]`;
    let marked = false;

    try {
      const marker = await this.evaluateWithArgs(`
        (() => {
          const el = window.__resolved;
          if (!el || el.nodeType !== 1 || typeof el.setAttribute !== 'function') {
            return { ok: false };
          }
          el.setAttribute(markerAttr, markerValue);
          return { ok: true };
        })()
      `, { markerAttr, markerValue }) as { ok?: boolean } | null;
      marked = marker?.ok === true;
      if (!marked) return false;

      await cdp.call(this, 'DOM.enable', {}).catch(() => undefined);
      const doc = await cdp.call(this, 'DOM.getDocument', {}) as { root?: { nodeId?: unknown } } | null;
      const rootNodeId = doc?.root?.nodeId;
      if (typeof rootNodeId !== 'number') return false;

      const query = await cdp.call(this, 'DOM.querySelector', {
        nodeId: rootNodeId,
        selector,
      }) as { nodeId?: unknown } | null;
      const nodeId = query?.nodeId;
      if (typeof nodeId !== 'number' || nodeId <= 0) return false;

      await cdp.call(this, method, { nodeId });
      return true;
    } catch {
      return false;
    } finally {
      if (marked) {
        await this.evaluateWithArgs(`
          (() => {
            for (const el of document.querySelectorAll(selector)) {
              el.removeAttribute(markerAttr);
            }
          })()
        `, { selector, markerAttr }).catch(() => undefined);
      }
    }
  }

  async typeText(ref: string, text: string, opts: ResolveOptions = {}): Promise<ResolveSuccess> {
    const resolved = await runResolve(this, ref, opts);
    let typed = false;
    let nativeScrolled = false;
    let nativeFocused = false;

    if (typeof (this as IPage).nativeType === 'function' || typeof (this as IPage).insertText === 'function') {
      try {
        nativeScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');
        nativeFocused = await this.tryCdpOnResolvedElement('DOM.focus');
        const preparation = await this.evaluate(prepareNativeTypeResolvedJs({
          skipScroll: nativeScrolled,
          skipFocus: nativeFocused,
        })) as
          | { ok?: boolean; mode?: string; reason?: string }
          | null;
        typed = preparation?.ok === true && await this.tryNativeType(text);
      } catch {
        // Native input is a reliability upgrade, not the only path. Preserve
        // the existing DOM setter fallback if preparation fails.
      }
    }

    if (!typed) {
      await this.evaluate(typeResolvedJs(text));
    }
    return resolved;
  }

  async hover(ref: string, opts: ResolveOptions = {}): Promise<ResolveSuccess> {
    const resolved = await runResolve(this, ref, opts);
    const nativeScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');
    const rect = await this.evaluate(boundingRectResolvedJs({ skipScroll: nativeScrolled })) as
      | { x: number; y: number; w: number; h: number; visible: boolean }
      | null;
    if (rect?.visible === true && await this.tryNativeMouseMove(rect.x, rect.y)) return resolved;

    await this.evaluate(`
      (() => {
        const el = window.__resolved;
        if (!el) throw new Error('No resolved element');
        if (${nativeScrolled ? 'false' : 'true'}) el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = el.getBoundingClientRect();
        const init = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: Math.round(rect.left + rect.width / 2),
          clientY: Math.round(rect.top + rect.height / 2),
        };
        try { el.dispatchEvent(new PointerEvent('pointerover', init)); } catch (_) {}
        try { el.dispatchEvent(new PointerEvent('pointermove', init)); } catch (_) {}
        el.dispatchEvent(new MouseEvent('mouseover', init));
        el.dispatchEvent(new MouseEvent('mousemove', init));
      })()
    `);
    return resolved;
  }

  async focus(ref: string, opts: ResolveOptions = {}): Promise<ResolveSuccess & { focused: boolean }> {
    const resolved = await runResolve(this, ref, opts);
    let focused = await this.tryCdpOnResolvedElement('DOM.focus') && await this.isResolvedFocused();
    if (!focused) {
      focused = await this.evaluate(`
        (() => {
          const el = window.__resolved;
          if (!el || typeof el.focus !== 'function') return false;
          try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (_) {} }
          return document.activeElement === el || (typeof el.matches === 'function' && el.matches(':focus'));
        })()
      `) as boolean;
    }
    return { ...resolved, focused: !!focused };
  }

  async dblClick(ref: string, opts: ResolveOptions = {}): Promise<ResolveSuccess> {
    const resolved = await runResolve(this, ref, opts);
    const nativeScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');
    const rect = await this.evaluate(boundingRectResolvedJs({ skipScroll: nativeScrolled })) as
      | { x: number; y: number; w: number; h: number; visible: boolean }
      | null;
    if (rect?.visible === true && await this.tryNativeDoubleClick(rect.x, rect.y)) return resolved;

    await this.evaluate(`
      (() => {
        const el = window.__resolved;
        if (!el) throw new Error('No resolved element');
        if (${nativeScrolled ? 'false' : 'true'}) el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = el.getBoundingClientRect();
        const init = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: Math.round(rect.left + rect.width / 2),
          clientY: Math.round(rect.top + rect.height / 2),
          button: 0,
          detail: 2,
        };
        el.dispatchEvent(new MouseEvent('dblclick', init));
      })()
    `);
    return resolved;
  }

  private async readCheckableState(): Promise<{
    ok?: boolean;
    checked?: boolean;
    disabled?: boolean;
    kind?: string;
    reason?: string;
    tag?: string;
    role?: string;
  } | null> {
    return await this.evaluate(`
      (() => {
        const el = window.__resolved;
        if (!el || el.nodeType !== 1) return { ok: false, reason: 'not_checkable' };
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
          return {
            ok: true,
            checked: !!el.checked,
            disabled: !!el.disabled,
            kind: type,
          };
        }
        if (role === 'checkbox' || role === 'switch' || role === 'menuitemcheckbox' || role === 'radio' || role === 'menuitemradio') {
          const aria = (el.getAttribute('aria-checked') || '').toLowerCase();
          return {
            ok: true,
            checked: aria === 'true' || aria === 'mixed',
            disabled: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'),
            kind: role,
          };
        }
        return { ok: false, reason: 'not_checkable', tag, role };
      })()
    `) as {
      ok?: boolean;
      checked?: boolean;
      disabled?: boolean;
      kind?: string;
      reason?: string;
      tag?: string;
      role?: string;
    } | null;
  }

  async setChecked(ref: string, checked: boolean, opts: ResolveOptions = {}): Promise<SetCheckedResult> {
    const resolved = await runResolve(this, ref, opts);
    const before = await this.readCheckableState();
    if (before?.ok !== true) {
      throw new TargetError({
        code: 'not_checkable',
        message: `Target "${ref}" is not a checkbox, radio, switch, or aria-checked control.`,
        hint: 'Use `opencli browser state` or `browser find` to pick an input[type=checkbox], input[type=radio], or role=checkbox/switch target.',
      });
    }
    if (before.disabled) {
      throw new TargetError({
        code: 'not_checkable',
        message: `Target "${ref}" is disabled and cannot be ${checked ? 'checked' : 'unchecked'}.`,
        hint: 'Pick an enabled control, or inspect the form state before retrying.',
      });
    }
    if ((before.kind === 'radio' || before.kind === 'menuitemradio') && !checked) {
      throw new TargetError({
        code: 'not_checkable',
        message: `Target "${ref}" is a radio button and cannot be unchecked directly.`,
        hint: 'Select another radio option in the same group instead.',
      });
    }
    if (before.checked === checked) {
      return {
        ...resolved,
        checked,
        changed: false,
        ...(before.kind ? { kind: before.kind } : {}),
      };
    }

    const clicked = await this.click(ref, opts);
    const after = await this.readCheckableState();
    if (after?.ok !== true || after.checked !== checked) {
      throw new TargetError({
        code: 'not_checkable',
        message: `Target "${ref}" did not become ${checked ? 'checked' : 'unchecked'} after click.`,
        hint: 'The control may be custom, disabled by app logic, or require a different target such as its visible label.',
      });
    }
    return {
      matches_n: clicked.matches_n,
      match_level: clicked.match_level,
      checked,
      changed: true,
      ...(after.kind ? { kind: after.kind } : {}),
    };
  }

  private async setFileInputBySelector(files: string[], selector: string): Promise<void> {
    const setFileInput = (this as IPage).setFileInput;
    if (typeof setFileInput === 'function') {
      await setFileInput.call(this, files, selector);
      return;
    }

    const cdp = (this as IPage).cdp;
    if (typeof cdp !== 'function') {
      throw new Error('File upload requires setFileInput or CDP support from the active browser backend.');
    }
    await cdp.call(this, 'DOM.enable', {}).catch(() => undefined);
    const doc = await cdp.call(this, 'DOM.getDocument', {}) as { root?: { nodeId?: unknown } } | null;
    const rootNodeId = doc?.root?.nodeId;
    if (typeof rootNodeId !== 'number') throw new Error('DOM.getDocument returned no root node.');
    const query = await cdp.call(this, 'DOM.querySelector', { nodeId: rootNodeId, selector }) as { nodeId?: unknown } | null;
    const nodeId = query?.nodeId;
    if (typeof nodeId !== 'number' || nodeId <= 0) throw new Error(`No element found matching selector: ${selector}`);
    await cdp.call(this, 'DOM.setFileInputFiles', { files, nodeId });
  }

  async uploadFiles(ref: string, files: string[], opts: ResolveOptions = {}): Promise<UploadFilesResult> {
    if (!Array.isArray(files) || files.length === 0) {
      throw new TargetError({
        code: 'not_file_input',
        message: 'No files were provided for upload.',
        hint: 'Pass one or more local file paths after the target.',
      });
    }
    const resolved = await runResolve(this, ref, opts);
    const markerAttr = 'data-opencli-upload-target';
    const markerValue = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const selector = `[${markerAttr}="${markerValue}"]`;
    let marked = false;
    let info: { ok?: boolean; multiple?: boolean; accept?: string; reason?: string; tag?: string; type?: string } | null = null;

    try {
      info = await this.evaluateWithArgs(`
        (() => {
          const el = window.__resolved;
          if (!el || el.nodeType !== 1) return { ok: false, reason: 'not_file_input' };
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute('type') || '').toLowerCase();
          if (tag !== 'input' || type !== 'file') return { ok: false, reason: 'not_file_input', tag, type };
          el.setAttribute(markerAttr, markerValue);
          return {
            ok: true,
            multiple: !!el.multiple,
            accept: el.getAttribute('accept') || '',
          };
        })()
      `, { markerAttr, markerValue }) as { ok?: boolean; multiple?: boolean; accept?: string; reason?: string; tag?: string; type?: string } | null;
      marked = info?.ok === true;
      if (!marked) {
        throw new TargetError({
          code: 'not_file_input',
          message: `Target "${ref}" is not an input[type=file].`,
          hint: 'Use `opencli browser find --css "input[type=file]"` or inspect `compound` output from browser state/find.',
        });
      }
      if (files.length > 1 && !info?.multiple) {
        throw new TargetError({
          code: 'not_file_input',
          message: `Target "${ref}" does not allow multiple files, but ${files.length} files were provided.`,
          hint: 'Pass one file, or choose a file input with the multiple attribute.',
        });
      }

      await this.setFileInputBySelector(files, selector);
      const verification = await this.evaluate(`
        (() => {
          const el = window.__resolved;
          const names = [];
          try {
            if (el && el.files) {
              for (let i = 0; i < el.files.length; i++) names.push(el.files[i].name || '');
            }
          } catch (_) {}
          return names;
        })()
      `) as unknown;
      const fileNames = Array.isArray(verification)
        ? verification.map((value) => String(value))
        : [];

      return {
        ...resolved,
        uploaded: true,
        files: fileNames.length || files.length,
        file_names: fileNames,
        target: ref,
        multiple: !!info?.multiple,
        ...(info?.accept ? { accept: info.accept } : {}),
      };
    } finally {
      if (marked) {
        await this.evaluateWithArgs(`
          (() => {
            for (const el of document.querySelectorAll(selector)) {
              el.removeAttribute(markerAttr);
            }
          })()
        `, { selector, markerAttr }).catch(() => undefined);
      }
    }
  }

  async drag(
    source: string,
    target: string,
    opts: { from?: ResolveOptions; to?: ResolveOptions } = {},
  ): Promise<DragResult> {
    const sourceResolved = await runResolve(this, source, opts.from ?? {});
    const sourceScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');
    const sourceRect = await this.evaluate(`
      (() => {
        const el = window.__resolved;
        if (!el) throw new Error('No resolved drag source');
        window.__opencli_drag_source = el;
        if (${sourceScrolled ? 'false' : 'true'}) el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = el.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        const x = Math.round(rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);
        const visible = w > 0 && h > 0 && x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
        return { x, y, w, h, visible };
      })()
    `) as
      | { x: number; y: number; w: number; h: number; visible: boolean }
      | null;
    if (sourceRect?.visible !== true) {
      throw new Error(`Drag source "${source}" has no visible bounding box.`);
    }

    try {
      const targetResolved = await runResolve(this, target, opts.to ?? {});
      const targetScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');
      const endpoints = await this.evaluate(`
        (() => {
          const sourceEl = window.__opencli_drag_source;
          const targetEl = window.__resolved;
          if (!sourceEl) throw new Error('No resolved drag source');
          if (!targetEl) throw new Error('No resolved drag target');
          if (${targetScrolled ? 'false' : 'true'}) targetEl.scrollIntoView({ behavior: 'instant', block: 'center' });
          const measure = (el) => {
            const rect = el.getBoundingClientRect();
            const w = Math.round(rect.width);
            const h = Math.round(rect.height);
            const x = Math.round(rect.left + rect.width / 2);
            const y = Math.round(rect.top + rect.height / 2);
            const visible = w > 0 && h > 0 && x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
            return { x, y, w, h, visible };
          };
          return { source: measure(sourceEl), target: measure(targetEl) };
        })()
      `) as
        | {
          source?: { x: number; y: number; w: number; h: number; visible: boolean };
          target?: { x: number; y: number; w: number; h: number; visible: boolean };
        }
        | null;

      if (endpoints?.source?.visible !== true) {
        throw new Error(`Drag source "${source}" is not visible at drag time.`);
      }
      if (endpoints?.target?.visible !== true) {
        throw new Error(`Drag target "${target}" has no visible bounding box.`);
      }

      const dragged = await this.tryNativeDrag(
        { x: endpoints.source.x, y: endpoints.source.y },
        { x: endpoints.target.x, y: endpoints.target.y },
      );
      if (!dragged) throw new Error('Native drag requires CDP Input.dispatchMouseEvent support.');

      return {
        dragged: true,
        source,
        target,
        source_matches_n: sourceResolved.matches_n,
        target_matches_n: targetResolved.matches_n,
        source_match_level: sourceResolved.match_level,
        target_match_level: targetResolved.match_level,
      };
    } finally {
      await this.evaluate('delete window.__opencli_drag_source').catch(() => {});
    }
  }

  async fillText(ref: string, text: string, opts: ResolveOptions = {}): Promise<FillTextResult> {
    const resolved = await runResolve(this, ref, opts);
    let nativeScrolled = false;
    let nativeFocused = false;

    try {
      nativeScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');
      nativeFocused = await this.tryCdpOnResolvedElement('DOM.focus');
    } catch {
      // CDP focus/scroll is best-effort; DOM preparation below remains authoritative.
    }

    const preparation = await this.evaluate(prepareNativeTypeResolvedJs({
      skipScroll: nativeScrolled,
      skipFocus: nativeFocused,
    })) as
      | { ok?: boolean; mode?: string; reason?: string; tag?: string }
      | null;

    if (preparation?.ok !== true) {
      throw new TargetError({
        code: 'not_editable',
        message: `Target "${ref}" is not a fillable input, textarea, or contenteditable element.`,
        hint: 'Use `opencli browser state` to pick an editable target, or use `browser type` for keyboard-like interactions.',
      });
    }

    const usedNativeInput = await this.tryNativeType(text);
    if (!usedNativeInput) {
      await this.evaluate(typeResolvedJs(text));
    }

    let verification = await this.evaluate(verifyFilledResolvedJs(text)) as FillResolvedResult | null;
    if (usedNativeInput && verification?.ok !== true) {
      await this.evaluate(typeResolvedJs(text));
      verification = await this.evaluate(verifyFilledResolvedJs(text)) as FillResolvedResult | null;
    }
    const actual = verification && 'actual' in verification ? verification.actual : '';
    const mode = verification && 'mode' in verification ? verification.mode : undefined;

    return {
      ...resolved,
      filled: true,
      verified: verification?.ok === true,
      expected: text,
      actual,
      length: actual.length,
      ...(mode ? { mode } : {}),
    };
  }

  async pressKey(key: string): Promise<void> {
    const parsed = parseKeyChord(key);
    if (!await this.tryNativeKeyPress(parsed.key, parsed.modifiers)) {
      await this.evaluate(pressKeyJs(parsed.key, parsed.modifiers));
    }
  }

  async scrollTo(ref: string, opts: ResolveOptions = {}): Promise<unknown> {
    const resolved = await runResolve(this, ref, opts);
    const nativeScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');
    const result = (await this.evaluate(scrollResolvedJs({ skipScroll: nativeScrolled }))) as Record<string, unknown> | null;
    // Fold match_level into the scroll payload so the user-facing envelope
    // carries it the same way click / type do.
    if (result && typeof result === 'object') {
      return { ...result, matches_n: resolved.matches_n, match_level: resolved.match_level };
    }
    return { matches_n: resolved.matches_n, match_level: resolved.match_level };
  }

  async getFormState(): Promise<Record<string, unknown>> {
    return (await this.evaluate(getFormStateJs())) as Record<string, unknown>;
  }

  async scroll(direction: string = 'down', amount: number = 500): Promise<void> {
    await this.evaluate(scrollJs(direction, amount));
  }

  async autoScroll(options?: { times?: number; delayMs?: number }): Promise<void> {
    const times = options?.times ?? 3;
    const delayMs = options?.delayMs ?? 2000;
    await this.evaluate(autoScrollJs(times, delayMs));
  }

  async networkRequests(includeStatic: boolean = false): Promise<unknown[]> {
    const result = await this.evaluate(networkRequestsJs(includeStatic));
    return Array.isArray(result) ? result : [];
  }

  async consoleMessages(_level: string = 'info'): Promise<unknown[]> {
    return [];
  }

  async wait(options: number | WaitOptions): Promise<void> {
    if (typeof options === 'number') {
      if (options >= 1) {
        try {
          const maxMs = options * 1000;
          await this.evaluate(waitForDomStableJs(maxMs, Math.min(500, maxMs)));
          return;
        } catch {
          // Fallback: fixed sleep
        }
      }
      await new Promise(resolve => setTimeout(resolve, options * 1000));
      return;
    }
    if (typeof options.time === 'number') {
      await new Promise(resolve => setTimeout(resolve, options.time! * 1000));
      return;
    }
    if (options.selector) {
      const timeout = (options.timeout ?? 10) * 1000;
      await this.evaluate(waitForSelectorJs(options.selector, timeout));
      return;
    }
    if (options.text) {
      const timeout = (options.timeout ?? 30) * 1000;
      await this.evaluate(waitForTextJs(options.text, timeout));
    }
  }

  async snapshot(opts: SnapshotOptions = {}): Promise<unknown> {
    if (opts.source === 'ax') {
      const cdp = (this as IPage).cdp;
      if (typeof cdp !== 'function') {
        throw new CliError(
          'BROWSER_AX_UNAVAILABLE',
          'AX snapshot requires CDP support from the active browser backend.',
          'Use the default DOM state, or update/reload the Browser Bridge extension.',
        );
      }
      const axTrees = await this.collectAxSnapshotTrees(cdp);
      const built = buildAxSnapshotFromTrees(axTrees, {
        maxDepth: opts.maxDepth,
        interactiveOnly: opts.interactive,
      });
      this._axRefs = built.refs;
      return built.text;
    }

    this._axRefs.clear();
    const snapshotJs = generateSnapshotJs({
      viewportExpand: opts.viewportExpand ?? 2000,
      maxDepth: Math.max(1, Math.min(Number(opts.maxDepth) || 50, 200)),
      interactiveOnly: opts.interactive ?? false,
      maxTextLength: opts.maxTextLength ?? 120,
      includeScrollInfo: true,
      bboxDedup: true,
      previousHashes: this._prevSnapshotHashes,
    });

    try {
      const result = await this.evaluate(snapshotJs);
      // Read back the hashes stored by the snapshot for next diff
      try {
        const hashes = await this.evaluate('window.__opencli_prev_hashes') as string | null;
        this._prevSnapshotHashes = typeof hashes === 'string' ? hashes : null;
      } catch {
        // Non-fatal: diff is best-effort
      }
      return result;
    } catch (err) {
      // Log snapshot failure for debugging, then fallback to basic accessibility tree
      if (process.env.DEBUG_SNAPSHOT) {
        process.stderr.write(`[snapshot] DOM snapshot failed, falling back to accessibility tree: ${(err as Error)?.message?.slice(0, 200)}\n`);
      }
      return this._basicSnapshot(opts);
    }
  }

  private async collectAxSnapshotTrees(
    cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  ): Promise<AxSnapshotTree[]> {
    await cdp.call(this, 'Accessibility.enable', {});
    const rootTree = await cdp.call(this, 'Accessibility.getFullAXTree', {});
    const trees: AxSnapshotTree[] = [{ tree: rootTree }];

    const frameTreeResult = await cdp.call(this, 'Page.getFrameTree', {}).catch(() => null);
    const frames = collectSameOriginFrameRefs(frameTreeResult);
    for (const frame of frames) {
      const tree = await cdp.call(this, 'Accessibility.getFullAXTree', { frameId: frame.frameId }).catch(() => null);
      if (tree) trees.push({ tree, frame });
    }

    return trees;
  }

  async getCurrentUrl(): Promise<string | null> {
    if (this._lastUrl) return this._lastUrl;
    try {
      const current = await this.evaluate('window.location.href');
      if (typeof current === 'string' && current) {
        this._lastUrl = current;
        return current;
      }
    } catch {
      // Best-effort
    }
    return null;
  }

  async installInterceptor(pattern: string): Promise<void> {
    const { generateInterceptorJs } = await import('../interceptor.js');
    await this.evaluate(generateInterceptorJs(JSON.stringify(pattern), {
      arrayName: '__opencli_xhr',
      patchGuard: '__opencli_interceptor_patched',
    }));
  }

  async getInterceptedRequests(): Promise<unknown[]> {
    const { generateReadInterceptedJs } = await import('../interceptor.js');
    const result = await this.evaluate(generateReadInterceptedJs('__opencli_xhr'));
    return Array.isArray(result) ? result : [];
  }

  async waitForCapture(timeout: number = 10): Promise<void> {
    const maxMs = timeout * 1000;
    await this.evaluate(waitForCaptureJs(maxMs));
  }

  /** Fallback basic snapshot */
  protected async _basicSnapshot(opts: Pick<SnapshotOptions, 'interactive' | 'compact' | 'maxDepth' | 'raw'> = {}): Promise<unknown> {
    const maxDepth = Math.max(1, Math.min(Number(opts.maxDepth) || 50, 200));
    const code = `
      (async () => {
        function buildTree(node, depth) {
          if (depth > ${maxDepth}) return '';
          const role = node.getAttribute?.('role') || node.tagName?.toLowerCase() || 'generic';
          const name = node.getAttribute?.('aria-label') || node.getAttribute?.('alt') || node.textContent?.trim().slice(0, 80) || '';
          const isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(node.tagName?.toLowerCase()) || node.getAttribute?.('tabindex') != null;

          ${opts.interactive ? 'if (!isInteractive && !node.children?.length) return "";' : ''}

          let indent = '  '.repeat(depth);
          let line = indent + role;
          if (name) line += ' "' + name.replace(/"/g, '\\\\\\"') + '"';
          if (node.tagName?.toLowerCase() === 'a' && node.href) line += ' [' + node.href + ']';
          if (node.tagName?.toLowerCase() === 'input') line += ' [' + (node.type || 'text') + ']';

          let result = line + '\\n';
          if (node.children) {
            for (const child of node.children) {
              result += buildTree(child, depth + 1);
            }
          }
          return result;
        }
        return buildTree(document.body, 0);
      })()
    `;
    const raw = await this.evaluate(code);
    if (opts.raw) return raw;
    if (typeof raw === 'string') return formatSnapshot(raw, opts);
    return raw;
  }
}

function axTreeParams(frame: BrowserRef['frame'] | undefined): Record<string, unknown> {
  return frame?.frameId ? { frameId: frame.frameId } : {};
}

function collectSameOriginFrameRefs(frameTreeResult: unknown): Array<NonNullable<BrowserRef['frame']>> {
  const root = (frameTreeResult as { frameTree?: CdpFrameTreeNode } | null)?.frameTree;
  const rootUrl = root?.frame?.url || root?.frame?.unreachableUrl || '';
  const rootOrigin = urlOrigin(rootUrl);
  if (!root || !rootOrigin) return [];

  const frames: Array<NonNullable<BrowserRef['frame']>> = [];
  function collect(node: CdpFrameTreeNode | undefined): void {
    for (const child of node?.childFrames ?? []) {
      const frame = child.frame;
      const frameId = frame?.id;
      const frameUrl = frame?.url || frame?.unreachableUrl || '';
      const origin = urlOrigin(frameUrl);
      if (frameId && origin === rootOrigin) {
        frames.push({ frameId, url: frameUrl });
        collect(child);
      }
    }
  }
  collect(root);
  return frames;
}

function urlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
