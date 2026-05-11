/**
 * Client-side HTML → structured tree serializer.
 *
 * Returned as a JS string that gets passed to `page.evaluate`. The expression
 * walks the DOM subtree rooted at the first selector match (or documentElement
 * when no selector is given) and emits a compact `{tag, attrs, text, children}`
 * tree for agents to consume instead of re-parsing raw HTML.
 *
 * Text handling: `text` is the concatenated text of direct text children only,
 * whitespace-collapsed. Nested element text is left inside `children[].text`.
 * Ordering between text and elements is not preserved — agents that need it
 * should fall back to raw HTML mode.
 *
 * Budget knobs let the caller bound the output on large pages — previously an
 * unscoped `get html --as json` could return a giant tree. Callers set any
 * combination of `depth` / `childrenMax` / `textMax`; each hit is reported in
 * the `truncated` envelope so agents know to narrow their selector or raise
 * the budget.
 *
 * Compound controls (date / time / datetime-local / month / week / select /
 * file) gain a `compound` field so agents inspecting the JSON tree see the
 * full contract — date format, full option list (up to cap) with selections
 * preserved for options beyond the cap, file `accept` and `multiple`. Without
 * this wiring agents repeatedly guess values on these controls from the raw
 * attributes, which is the failure mode compound.ts was built to eliminate.
 */

import { COMPOUND_INFO_JS, type CompoundInfo } from './compound.js';

export interface BuildHtmlTreeJsOptions {
    /** CSS selector to scope the tree; unscoped = documentElement */
    selector?: string | null;
    /** Max depth below the root (0 = root only, no children). Omit = unlimited. */
    depth?: number | null;
    /** Max element children per node before the rest get dropped. Omit = unlimited. */
    childrenMax?: number | null;
    /** Max chars of direct text per node before truncation. Omit = unlimited. */
    textMax?: number | null;
}

/**
 * Returns a JS expression string. When evaluated in a page context the
 * expression resolves to either
 *   `{selector, matched, tree, truncated}` on success, or
 *   `{selector, invalidSelector: true, reason}` when `querySelectorAll`
 *   throws a `SyntaxError` for an unparseable selector.
 *
 * Callers must branch on `invalidSelector` to convert it into the CLI's
 * `invalid_selector` structured error; otherwise the browser-level exception
 * would bubble out of `page.evaluate` and bypass the structured-error
 * contract that agents rely on.
 */
export function buildHtmlTreeJs(opts: BuildHtmlTreeJsOptions = {}): string {
    const selectorLiteral = opts.selector ? JSON.stringify(opts.selector) : 'null';
    const depthLiteral = Number.isFinite(opts.depth as number) && (opts.depth as number) >= 0
        ? String(opts.depth)
        : 'null';
    const childrenMaxLiteral = Number.isFinite(opts.childrenMax as number) && (opts.childrenMax as number) >= 0
        ? String(opts.childrenMax)
        : 'null';
    const textMaxLiteral = Number.isFinite(opts.textMax as number) && (opts.textMax as number) >= 0
        ? String(opts.textMax)
        : 'null';
    return `(() => {
  ${COMPOUND_INFO_JS}
  const selector = ${selectorLiteral};
  const maxDepth = ${depthLiteral};
  const maxChildren = ${childrenMaxLiteral};
  const maxText = ${textMaxLiteral};
  let matches;
  if (selector) {
    try { matches = document.querySelectorAll(selector); }
    catch (e) {
      return { selector: selector, invalidSelector: true, reason: (e && e.message) || String(e) };
    }
  } else {
    matches = [document.documentElement];
  }
  const matched = matches.length;
  const root = matches[0] || null;
  const trunc = { depth: false, children_dropped: 0, text_truncated: 0 };
  function serialize(el, depth) {
    if (!el || el.nodeType !== 1) return null;
    const attrs = {};
    for (const a of el.attributes) attrs[a.name] = a.value;
    let text = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) text += n.nodeValue;
    }
    text = text.replace(/\\s+/g, ' ').trim();
    if (maxText !== null && text.length > maxText) {
      text = text.slice(0, maxText);
      trunc.text_truncated++;
    }
    const children = [];
    if (maxDepth === null || depth < maxDepth) {
      const childEls = [];
      for (const n of el.childNodes) if (n.nodeType === 1) childEls.push(n);
      const keep = maxChildren === null ? childEls.length : Math.min(childEls.length, maxChildren);
      for (let i = 0; i < keep; i++) {
        const child = serialize(childEls[i], depth + 1);
        if (child) children.push(child);
      }
      if (maxChildren !== null && childEls.length > maxChildren) {
        trunc.children_dropped += childEls.length - maxChildren;
      }
    } else {
      // Budget hit: we're at max depth. Count any element children we would have visited.
      for (const n of el.childNodes) if (n.nodeType === 1) { trunc.depth = true; break; }
    }
    const node = { tag: el.tagName.toLowerCase(), attrs, text, children };
    const compound = compoundInfoOf(el);
    if (compound) node.compound = compound;
    return node;
  }
  const tree = root ? serialize(root, 0) : null;
  const truncatedOut = {};
  if (trunc.depth) truncatedOut.depth = true;
  if (trunc.children_dropped > 0) truncatedOut.children_dropped = trunc.children_dropped;
  if (trunc.text_truncated > 0) truncatedOut.text_truncated = trunc.text_truncated;
  const envelope = { selector: selector, matched: matched, tree: tree };
  if (Object.keys(truncatedOut).length > 0) envelope.truncated = truncatedOut;
  return envelope;
})()`;
}

export interface HtmlNode {
    tag: string;
    attrs: Record<string, string>;
    text: string;
    children: HtmlNode[];
    /**
     * Rich view for date/select/file controls. Omitted for non-compound elements
     * so agents can rely on `compound != null` as a signal.
     */
    compound?: CompoundInfo;
}

export interface HtmlTreeTruncationInfo {
    /** At least one element child was dropped because depth budget was hit. */
    depth?: true;
    /** Count of element children dropped across the tree due to `childrenMax`. */
    children_dropped?: number;
    /** Count of nodes whose `text` was cut to `textMax`. */
    text_truncated?: number;
}

export interface HtmlTreeResult {
    selector: string | null;
    matched: number;
    tree: HtmlNode | null;
    truncated?: HtmlTreeTruncationInfo;
}
