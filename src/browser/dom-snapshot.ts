/**
 * DOM Snapshot Engine — Advanced DOM pruning for LLM consumption.
 *
 * Inspired by browser-use's multi-layer pruning pipeline, adapted for opencli's
 * Chrome Extension + CDP architecture. Runs entirely in-page via Runtime.evaluate.
 *
 * Pipeline:
 *   1. Walk DOM tree, collect visibility + layout + interactivity signals
 *   2. Prune invisible, zero-area, non-content elements
 *   3. SVG & decoration collapse
 *   4. Shadow DOM traversal
 *   5. Same-origin iframe content extraction
 *   6. Bounding-box parent-child dedup (link/button wrapping children)
 *   7. Paint-order occlusion detection (overlay/modal coverage)
 *   8. Attribute whitelist filtering
 *   9. Table-aware serialization (markdown tables)
 *  10. Token-efficient serialization with interactive indices
 *  11. data-ref annotation for click/type targeting
 *  12. Hidden interactive element hints (scroll-to-reveal)
 *  13. Incremental diff (mark new elements with *)
 *
 * Additional tools:
 *   - scrollToRefJs(ref) — scroll to a data-opencli-ref element
 *   - getFormStateJs()  — extract all form fields as structured JSON
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface DomSnapshotOptions {
  /** Extra pixels beyond viewport to include (default 800) */
  viewportExpand?: number;
  /** Maximum DOM depth to traverse (default 50) */
  maxDepth?: number;
  /** Only emit interactive elements and their landmark ancestors */
  interactiveOnly?: boolean;
  /** Maximum text content length per node (default 120) */
  maxTextLength?: number;
  /** Include scroll position info on scrollable containers (default true) */
  includeScrollInfo?: boolean;
  /** Enable bounding-box parent-child dedup (default true) */
  bboxDedup?: boolean;
  /** Traverse Shadow DOM roots (default true) */
  includeShadowDom?: boolean;
  /** Extract same-origin iframe content (default true) */
  includeIframes?: boolean;
  /** Maximum number of iframes to process (default 5) */
  maxIframes?: number;
  /** Enable paint-order occlusion detection (default true) */
  paintOrderCheck?: boolean;
  /** Annotate interactive elements with data-opencli-ref (default true) */
  annotateRefs?: boolean;
  /** Report hidden interactive elements outside viewport (default true) */
  reportHidden?: boolean;
  /** Filter ad/noise elements (default true) */
  filterAds?: boolean;
  /** Serialize tables as markdown (default true) */
  markdownTables?: boolean;
  /** Previous snapshot hash set (JSON array of hashes) for diff marking (default null) */
  previousHashes?: string | null;
}

// ─── Utility JS Generators ───────────────────────────────────────────

/**
 * Generate JS to scroll to an element identified by data-opencli-ref.
 * Completes the snapshot→action loop: snapshot identifies `[3]<button>`,
 * caller can then `scrollToRef('3')` to bring it into view.
 */
export function scrollToRefJs(ref: string): string {
  const safeRef = JSON.stringify(ref);
  return `
    (() => {
      const ref = ${safeRef};
      const el = document.querySelector('[data-opencli-ref="' + ref + '"]')
        || document.querySelector('[data-ref="' + ref + '"]');
      if (!el) throw new Error('Element not found: ref=' + ref);
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      return { scrolled: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 80) };
    })()
  `.trim();
}

/**
 * Generate JS to extract all form field values from the page.
 * Returns structured JSON: { forms: [{ id, action, fields: [{ tag, type, name, value, ... }] }] }
 */
export function getFormStateJs(): string {
  return `
    (() => {
      const result = { forms: [], orphanFields: [] };

      // Collect all forms
      for (const form of document.forms) {
        const formData = {
          id: form.id || null,
          name: form.name || null,
          action: form.action || null,
          method: (form.method || 'get').toUpperCase(),
          fields: [],
        };
        for (const el of form.elements) {
          const field = extractField(el);
          if (field) formData.fields.push(field);
        }
        if (formData.fields.length > 0) result.forms.push(formData);
      }

      // Collect orphan fields (not inside a form)
      const allInputs = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
      for (const el of allInputs) {
        if (el.form) continue; // already in a form
        const field = extractField(el);
        if (field) result.orphanFields.push(field);
      }

      function extractField(el) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text')).toLowerCase();
        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') return null;
        const name = el.name || el.id || null;
        const ref = el.getAttribute('data-opencli-ref') || null;
        const label = findLabel(el);
        let value;
        if (tag === 'select') {
          const opt = el.options?.[el.selectedIndex];
          value = opt ? opt.textContent.trim() : '';
        } else if (type === 'checkbox' || type === 'radio') {
          value = el.checked;
        } else if (type === 'password') {
          value = el.value ? '••••' : '';
        } else if (el.isContentEditable) {
          value = (el.textContent || '').trim().slice(0, 200);
        } else {
          value = (el.value || '').slice(0, 200);
        }
        return { tag, type, name, ref, label, value, required: el.required || false, disabled: el.disabled || false };
      }

      function findLabel(el) {
        // 1. aria-label
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
        // 2. associated <label>
        if (el.id) {
          const label = document.querySelector('label[for="' + el.id + '"]');
          if (label) return label.textContent.trim().slice(0, 80);
        }
        // 3. parent label
        const parentLabel = el.closest('label');
        if (parentLabel) return parentLabel.textContent.trim().slice(0, 80);
        // 4. placeholder
        return el.placeholder || null;
      }

      return result;
    })()
  `.trim();
}

// ─── Main Snapshot JS Generator ──────────────────────────────────────

/**
 * Generate JavaScript code that, when evaluated in a page context via CDP
 * Runtime.evaluate, returns a pruned DOM snapshot string optimised for LLMs.
 *
 * The snapshot output format:
 *   [42]<button type=submit>Search</button>
 *   |scroll|<div> (0.5↑ 3.2↓)
 *     *[58]<a href=/r/1>Result 1</a>
 *     [59]<a href=/r/2>Result 2</a>
 *
 * - `[id]` — interactive element with backend index for targeting
 * - `*` prefix — newly appeared element (incremental diff)
 * - `|scroll|` — scrollable container with page counts
 * - `|shadow|` — Shadow DOM boundary
 * - `|iframe|` — iframe content
 * - `|table|` — markdown table rendering
 */
export function generateSnapshotJs(opts: DomSnapshotOptions = {}): string {
  const viewportExpand = opts.viewportExpand ?? 800;
  const maxDepth = Math.max(1, Math.min(opts.maxDepth ?? 50, 200));
  const interactiveOnly = opts.interactiveOnly ?? false;
  const maxTextLength = opts.maxTextLength ?? 120;
  const includeScrollInfo = opts.includeScrollInfo ?? true;
  const bboxDedup = opts.bboxDedup ?? true;
  const includeShadowDom = opts.includeShadowDom ?? true;
  const includeIframes = opts.includeIframes ?? true;
  const maxIframes = opts.maxIframes ?? 5;
  const paintOrderCheck = opts.paintOrderCheck ?? true;
  const annotateRefs = opts.annotateRefs ?? true;
  const reportHidden = opts.reportHidden ?? true;
  const filterAds = opts.filterAds ?? true;
  const markdownTables = opts.markdownTables ?? true;
  const previousHashes = opts.previousHashes ?? null;

  return `
(() => {
  'use strict';

  // ── Config ─────────────────────────────────────────────────────────
  const VIEWPORT_EXPAND = ${viewportExpand};
  const MAX_DEPTH = ${maxDepth};
  const INTERACTIVE_ONLY = ${interactiveOnly};
  const MAX_TEXT_LEN = ${maxTextLength};
  const INCLUDE_SCROLL_INFO = ${includeScrollInfo};
  const BBOX_DEDUP = ${bboxDedup};
  const INCLUDE_SHADOW_DOM = ${includeShadowDom};
  const INCLUDE_IFRAMES = ${includeIframes};
  const MAX_IFRAMES = ${maxIframes};
  const PAINT_ORDER_CHECK = ${paintOrderCheck};
  const ANNOTATE_REFS = ${annotateRefs};
  const REPORT_HIDDEN = ${reportHidden};
  const FILTER_ADS = ${filterAds};
  const MARKDOWN_TABLES = ${markdownTables};
  const PREV_HASHES = ${previousHashes ? `new Set(${previousHashes})` : 'null'};

  // ── Constants ──────────────────────────────────────────────────────

  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'link', 'meta', 'head',
    'template', 'br', 'wbr', 'col', 'colgroup',
  ]);

  const SVG_CHILDREN = new Set([
    'path', 'rect', 'g', 'circle', 'ellipse', 'line', 'polyline',
    'polygon', 'use', 'defs', 'clippath', 'mask', 'pattern',
    'text', 'tspan', 'lineargradient', 'radialgradient', 'stop',
    'filter', 'fegaussianblur', 'fecolormatrix', 'feblend',
    'symbol', 'marker', 'foreignobject', 'desc', 'title',
  ]);

  const INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'details',
    'summary', 'option', 'optgroup',
  ]);

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'option', 'radio', 'checkbox',
    'tab', 'textbox', 'combobox', 'slider', 'spinbutton',
    'searchbox', 'switch', 'menuitemcheckbox', 'menuitemradio',
    'treeitem', 'gridcell', 'row',
  ]);

  const LANDMARK_ROLES = new Set([
    'main', 'navigation', 'banner', 'search', 'region',
    'complementary', 'contentinfo', 'form', 'dialog',
  ]);

  const LANDMARK_TAGS = new Set([
    'nav', 'main', 'header', 'footer', 'aside', 'form',
    'search', 'dialog', 'section', 'article',
  ]);

  const ATTR_WHITELIST = new Set([
    'id', 'name', 'type', 'value', 'placeholder', 'title', 'alt',
    'role', 'aria-label', 'aria-expanded', 'aria-checked', 'aria-selected',
    'aria-disabled', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow',
    'aria-haspopup', 'aria-live', 'aria-required',
    'href', 'src', 'action', 'method', 'for', 'checked', 'selected',
    'disabled', 'required', 'multiple', 'accept', 'min', 'max',
    'pattern', 'maxlength', 'minlength', 'data-testid', 'data-test',
    'contenteditable', 'tabindex', 'autocomplete',
  ]);

  const PROPAGATING_TAGS = new Set(['a', 'button']);

  const AD_PATTERNS = [
    'googleadservices.com', 'doubleclick.net', 'googlesyndication.com',
    'facebook.com/tr', 'analytics.google.com', 'connect.facebook.net',
    'ad.doubleclick', 'pagead', 'adsense',
  ];

  const AD_SELECTOR_RE = /\\b(ad[_-]?(?:banner|container|wrapper|slot|unit|block|frame|leaderboard|sidebar)|google[_-]?ad|sponsored|adsbygoogle|banner[_-]?ad)\\b/i;

  // ── Viewport & Layout Helpers ──────────────────────────────────────

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  function isInExpandedViewport(rect) {
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;
    return rect.bottom > -VIEWPORT_EXPAND && rect.top < vh + VIEWPORT_EXPAND &&
           rect.right > -VIEWPORT_EXPAND && rect.left < vw + VIEWPORT_EXPAND;
  }

  function isVisibleByCSS(el) {
    const style = el.style;
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.opacity === '0') return false;
    try {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none') return false;
      if (cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) <= 0) return false;
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)' && cs.position === 'absolute') return false;
      if (cs.overflow === 'hidden' && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    } catch {}
    return true;
  }

  // ── Paint Order Occlusion ──────────────────────────────────────────

  function isOccludedByOverlay(el) {
    if (!PAINT_ORDER_CHECK) return false;
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) return false;
      const topEl = document.elementFromPoint(cx, cy);
      if (!topEl || topEl === el || el.contains(topEl) || topEl.contains(el)) return false;
      const cs = window.getComputedStyle(topEl);
      if (parseFloat(cs.opacity) < 0.5) return false;
      const bg = cs.backgroundColor;
      if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;
      return true;
    } catch { return false; }
  }

  // ── Ad/Noise Detection ─────────────────────────────────────────────

  function isAdElement(el) {
    if (!FILTER_ADS) return false;
    try {
      const id = el.id || '';
      const cls = el.className || '';
      const testStr = id + ' ' + (typeof cls === 'string' ? cls : '');
      if (AD_SELECTOR_RE.test(testStr)) return true;
      if (el.tagName === 'IFRAME') {
        const src = el.src || '';
        for (const p of AD_PATTERNS) { if (src.includes(p)) return true; }
      }
      if (el.hasAttribute('data-ad') || el.hasAttribute('data-ad-slot') ||
          el.hasAttribute('data-adunit') || el.hasAttribute('data-google-query-id')) return true;
    } catch {}
    return false;
  }

  // ── Interactivity Detection ────────────────────────────────────────

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) {
      if (tag === 'label' && el.hasAttribute('for')) return false;
      if (el.disabled && (tag === 'button' || tag === 'input')) return false;
      return true;
    }
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.hasAttribute('onclick') || el.hasAttribute('onmousedown') || el.hasAttribute('ontouchstart')) return true;
    if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return true;
    try { if (window.getComputedStyle(el).cursor === 'pointer') return true; } catch {}
    if (el.isContentEditable && el.getAttribute('contenteditable') !== 'false') return true;
    return false;
  }

  function isLandmark(el) {
    const role = el.getAttribute('role');
    if (role && LANDMARK_ROLES.has(role)) return true;
    return LANDMARK_TAGS.has(el.tagName.toLowerCase());
  }

  // ── Scrollability Detection ────────────────────────────────────────

  function getScrollInfo(el) {
    if (!INCLUDE_SCROLL_INFO) return null;
    const sh = el.scrollHeight, ch = el.clientHeight;
    const sw = el.scrollWidth, cw = el.clientWidth;
    const isV = sh > ch + 5, isH = sw > cw + 5;
    if (!isV && !isH) return null;
    try {
      const cs = window.getComputedStyle(el);
      const scrollable = ['auto', 'scroll', 'overlay'];
      const tag = el.tagName.toLowerCase();
      const isBody = tag === 'body' || tag === 'html';
      if (isV && !isBody && !scrollable.includes(cs.overflowY)) return null;
      const info = {};
      if (isV) {
        const above = ch > 0 ? +(el.scrollTop / ch).toFixed(1) : 0;
        const below = ch > 0 ? +((sh - ch - el.scrollTop) / ch).toFixed(1) : 0;
        if (above > 0 || below > 0) info.v = { above, below };
      }
      if (isH && scrollable.includes(cs.overflowX)) {
        info.h = { pct: cw > 0 ? Math.round(el.scrollLeft / (sw - cw) * 100) : 0 };
      }
      return Object.keys(info).length > 0 ? info : null;
    } catch { return null; }
  }

  // ── BBox Containment Check ─────────────────────────────────────────

  function isContainedBy(childRect, parentRect, threshold) {
    if (!childRect || !parentRect) return false;
    const cArea = childRect.width * childRect.height;
    if (cArea === 0) return false;
    const xO = Math.max(0, Math.min(childRect.right, parentRect.right) - Math.max(childRect.left, parentRect.left));
    const yO = Math.max(0, Math.min(childRect.bottom, parentRect.bottom) - Math.max(childRect.top, parentRect.top));
    return (xO * yO) / cArea >= threshold;
  }

  // ── Text Helpers ───────────────────────────────────────────────────

  function getDirectText(el) {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const t = child.textContent.trim();
        if (t) text += (text ? ' ' : '') + t;
      }
    }
    return text;
  }

  function capText(s) {
    if (!s) return '';
    const t = s.replace(/\\s+/g, ' ').trim();
    return t.length > MAX_TEXT_LEN ? t.slice(0, MAX_TEXT_LEN) + '…' : t;
  }

  // ── Element Hashing (for incremental diff) ─────────────────────────

  function hashElement(el) {
    // Simple hash: tag + id + className + textContent prefix
    const tag = el.tagName || '';
    const id = el.id || '';
    const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 50);
    const text = (el.textContent || '').trim().slice(0, 40);
    const s = tag + '|' + id + '|' + cls + '|' + text;
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return '' + (h >>> 0); // unsigned
  }

  // ── Attribute Serialization ────────────────────────────────────────

  function serializeAttrs(el) {
    const parts = [];
    for (const attr of el.attributes) {
      if (!ATTR_WHITELIST.has(attr.name)) continue;
      let val = attr.value.trim();
      if (!val) continue;
      if (val.length > 120) val = val.slice(0, 100) + '…';
      if (attr.name === 'type' && val.toLowerCase() === el.tagName.toLowerCase()) continue;
      if (attr.name === 'value' && el.getAttribute('type') === 'password') { parts.push('value=••••'); continue; }
      if (attr.name === 'href') {
        if (val.startsWith('javascript:')) continue;
        try {
          const u = new URL(val, location.origin);
          if (u.origin === location.origin) val = u.pathname + u.search + u.hash;
        } catch {}
      }
      parts.push(attr.name + '=' + val);
    }
    // Synthetic attributes
    const tag = el.tagName;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const fmts = { 'date':'YYYY-MM-DD', 'time':'HH:MM', 'datetime-local':'YYYY-MM-DDTHH:MM', 'month':'YYYY-MM', 'week':'YYYY-W##' };
      if (fmts[type]) parts.push('format=' + fmts[type]);
      if (['text','email','tel','url','search','number','date','time','datetime-local','month','week'].includes(type)) {
        if (el.value && !parts.some(p => p.startsWith('value='))) parts.push('value=' + capText(el.value));
      }
      if (type === 'password' && el.value && !parts.some(p => p.startsWith('value='))) parts.push('value=••••');
      if ((type === 'checkbox' || type === 'radio') && el.checked && !parts.some(p => p.startsWith('checked'))) parts.push('checked');
      if (type === 'file' && el.files && el.files.length > 0) parts.push('files=' + Array.from(el.files).map(f => f.name).join(','));
    }
    if (tag === 'TEXTAREA' && el.value && !parts.some(p => p.startsWith('value='))) parts.push('value=' + capText(el.value));
    if (tag === 'SELECT') {
      const sel = el.options?.[el.selectedIndex];
      if (sel && !parts.some(p => p.startsWith('value='))) parts.push('value=' + capText(sel.textContent));
      const optEls = Array.from(el.options || []).slice(0, 6);
      if (optEls.length > 0) {
        const ot = optEls.map(o => capText(o.textContent).slice(0, 30));
        if (el.options.length > 6) ot.push('…' + (el.options.length - 6) + ' more');
        parts.push('options=[' + ot.join('|') + ']');
      }
    }
    return parts.join(' ');
  }

  // ── Table → Markdown Serialization ─────────────────────────────────

  function serializeTable(table, depth) {
    if (!MARKDOWN_TABLES) return false;
    try {
      const rows = table.querySelectorAll('tr');
      if (rows.length === 0 || rows.length > 50) return false; // skip huge tables
      const grid = [];
      let maxCols = 0;
      for (const row of rows) {
        const cells = [];
        for (const cell of row.querySelectorAll('th, td')) {
          let text = capText(cell.textContent || '');
          // Include interactive elements in cells
          const links = cell.querySelectorAll('a[href]');
          if (links.length === 1 && text) {
            const href = links[0].getAttribute('href');
            if (href && !href.startsWith('javascript:')) {
              try {
                const u = new URL(href, location.origin);
                text = '[' + text + '](' + (u.origin === location.origin ? u.pathname + u.search : href) + ')';
              } catch { text = '[' + text + '](' + href + ')'; }
            }
          }
          cells.push(text || '');
        }
        if (cells.length > 0) {
          grid.push(cells);
          if (cells.length > maxCols) maxCols = cells.length;
        }
      }
      if (grid.length < 2 || maxCols === 0) return false; // need at least header + 1 row
      // Pad rows to maxCols
      for (const row of grid) { while (row.length < maxCols) row.push(''); }
      // Compute column widths
      const widths = [];
      for (let c = 0; c < maxCols; c++) {
        let w = 3;
        for (const row of grid) { if (row[c].length > w) w = Math.min(row[c].length, 40); }
        widths.push(w);
      }
      const indent = '  '.repeat(depth);
      const tableLines = [];
      // Header
      tableLines.push(indent + '| ' + grid[0].map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |');
      tableLines.push(indent + '| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |');
      // Body
      for (let r = 1; r < grid.length; r++) {
        tableLines.push(indent + '| ' + grid[r].map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |');
      }
      return tableLines;
    } catch { return false; }
  }

  // ── Main Tree Walk ─────────────────────────────────────────────────

  let interactiveIndex = 0;
  const lines = [];
  const hiddenInteractives = [];
  const currentHashes = [];
  let iframeCount = 0;

  function walk(el, depth, parentPropagatingRect) {
    if (depth > MAX_DEPTH) return false;
    if (el.nodeType !== 1) return false;

    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return false;
    if (isAdElement(el)) return false;

    // SVG: emit tag, collapse children
    if (tag === 'svg') {
      const attrs = serializeAttrs(el);
      const interactive = isInteractive(el);
      let prefix = '';
      if (interactive) {
        interactiveIndex++;
        if (ANNOTATE_REFS) el.setAttribute('data-opencli-ref', '' + interactiveIndex);
        prefix = '[' + interactiveIndex + ']';
      }
      lines.push('  '.repeat(depth) + prefix + '<svg' + (attrs ? ' ' + attrs : '') + ' />');
      return interactive;
    }
    if (SVG_CHILDREN.has(tag)) return false;

    // Table: try markdown serialization before generic walk
    if (tag === 'table' && MARKDOWN_TABLES) {
      const tableLines = serializeTable(el, depth);
      if (tableLines) {
        const indent = '  '.repeat(depth);
        lines.push(indent + '|table|');
        for (const tl of tableLines) lines.push(tl);
        return false; // tables usually non-interactive
      }
      // Fall through to generic walk if markdown failed
    }

    // iframe handling
    if (tag === 'iframe' && INCLUDE_IFRAMES && iframeCount < MAX_IFRAMES) {
      return walkIframe(el, depth);
    }

    // Visibility check
    let rect;
    try { rect = el.getBoundingClientRect(); } catch { return false; }
    const hasArea = rect.width > 0 && rect.height > 0;
    if (hasArea && !isVisibleByCSS(el)) {
      if (!(tag === 'input' && el.type === 'file')) return false;
    }

    const interactive = isInteractive(el);

    // Viewport threshold pruning
    if (hasArea && !isInExpandedViewport(rect)) {
      if (interactive && REPORT_HIDDEN) {
        const scrollDist = rect.top > vh ? rect.top - vh : -rect.bottom;
        const pagesAway = Math.abs(scrollDist / vh).toFixed(1);
        const direction = rect.top > vh ? 'below' : 'above';
        const text = capText(getDirectText(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '');
        hiddenInteractives.push({ tag, text, direction, pagesAway });
      }
      return false;
    }

    // Paint order occlusion
    if (interactive && hasArea && isOccludedByOverlay(el)) return false;

    const landmark = isLandmark(el);
    const scrollInfo = getScrollInfo(el);
    const isScrollable = scrollInfo !== null;

    // BBox dedup
    let excludedByParent = false;
    if (BBOX_DEDUP && parentPropagatingRect && !interactive) {
      if (hasArea && isContainedBy(rect, parentPropagatingRect, 0.95)) {
        const hasSemantic = el.hasAttribute('aria-label') ||
          (el.getAttribute('role') && INTERACTIVE_ROLES.has(el.getAttribute('role')));
        if (!hasSemantic && !['input','select','textarea','label'].includes(tag)) {
          excludedByParent = true;
        }
      }
    }

    let propagateRect = parentPropagatingRect;
    if (BBOX_DEDUP && PROPAGATING_TAGS.has(tag) && hasArea) propagateRect = rect;

    // Process children
    const origLen = lines.length;
    let hasInteractiveDescendant = false;

    for (const child of el.children) {
      const r = walk(child, depth + 1, propagateRect);
      if (r) hasInteractiveDescendant = true;
    }

    // Shadow DOM
    if (INCLUDE_SHADOW_DOM && el.shadowRoot) {
      const shadowOrigLen = lines.length;
      for (const child of el.shadowRoot.children) {
        const r = walk(child, depth + 1, propagateRect);
        if (r) hasInteractiveDescendant = true;
      }
      if (lines.length > shadowOrigLen) {
        lines.splice(shadowOrigLen, 0, '  '.repeat(depth + 1) + '|shadow|');
      }
    }

    const childLinesCount = lines.length - origLen;
    const text = capText(getDirectText(el));

    // Decide whether to emit
    if (INTERACTIVE_ONLY && !interactive && !landmark && !hasInteractiveDescendant && !text) {
      lines.length = origLen;
      return false;
    }
    if (excludedByParent && !interactive && !isScrollable) return hasInteractiveDescendant;
    if (!interactive && !isScrollable && !text && childLinesCount === 0 && !landmark) return false;

    // ── Emit node ────────────────────────────────────────────────────
    const indent = '  '.repeat(depth);
    let line = indent;

    // Incremental diff: mark new elements with *
    if (PREV_HASHES) {
      const h = hashElement(el);
      currentHashes.push(h);
      if (!PREV_HASHES.has(h)) line += '*';
    } else {
      currentHashes.push(hashElement(el));
    }

    // Scroll marker
    if (isScrollable && !interactive) line += '|scroll|';

    // Interactive index + data-ref
    if (interactive) {
      interactiveIndex++;
      if (ANNOTATE_REFS) el.setAttribute('data-opencli-ref', '' + interactiveIndex);
      line += isScrollable ? '|scroll[' + interactiveIndex + ']|' : '[' + interactiveIndex + ']';
    }

    // Tag + attributes
    const attrs = serializeAttrs(el);
    line += '<' + tag;
    if (attrs) line += ' ' + attrs;

    // Scroll info suffix, inline text, or self-close
    if (isScrollable && scrollInfo) {
      const parts = [];
      if (scrollInfo.v) parts.push(scrollInfo.v.above + '↑ ' + scrollInfo.v.below + '↓');
      if (scrollInfo.h) parts.push('h:' + scrollInfo.h.pct + '%');
      line += ' /> (' + parts.join(', ') + ')';
    } else if (text && childLinesCount === 0) {
      line += '>' + text + '</' + tag + '>';
    } else {
      line += ' />';
    }

    lines.splice(origLen, 0, line);
    if (text && childLinesCount > 0) lines.splice(origLen + 1, 0, indent + '  ' + text);

    return interactive || hasInteractiveDescendant;
  }

  // ── iframe Processing ──────────────────────────────────────────────

  function walkIframe(el, depth) {
    const indent = '  '.repeat(depth);
    try {
      const doc = el.contentDocument;
      if (!doc || !doc.body) {
        const attrs = serializeAttrs(el);
        lines.push(indent + '|iframe|<iframe' + (attrs ? ' ' + attrs : '') + ' /> (cross-origin)');
        return false;
      }
      iframeCount++;
      const attrs = serializeAttrs(el);
      lines.push(indent + '|iframe|<iframe' + (attrs ? ' ' + attrs : '') + ' />');
      let has = false;
      for (const child of doc.body.children) {
        if (walk(child, depth + 1, null)) has = true;
      }
      return has;
    } catch {
      const attrs = serializeAttrs(el);
      lines.push(indent + '|iframe|<iframe' + (attrs ? ' ' + attrs : '') + ' /> (blocked)');
      return false;
    }
  }

  // ── Entry Point ────────────────────────────────────────────────────

  lines.push('url: ' + location.href);
  lines.push('title: ' + document.title);
  lines.push('viewport: ' + vw + 'x' + vh);
  const pageScrollInfo = getScrollInfo(document.documentElement) || getScrollInfo(document.body);
  if (pageScrollInfo && pageScrollInfo.v) {
    lines.push('page_scroll: ' + pageScrollInfo.v.above + '↑ ' + pageScrollInfo.v.below + '↓');
  }
  lines.push('---');

  const root = document.body || document.documentElement;
  if (root) walk(root, 0, null);

  // Hidden interactive elements hint
  if (REPORT_HIDDEN && hiddenInteractives.length > 0) {
    lines.push('---');
    lines.push('hidden_interactive (' + hiddenInteractives.length + '):');
    const shown = hiddenInteractives.slice(0, 10);
    for (const h of shown) {
      const label = h.text ? ' "' + h.text + '"' : '';
      lines.push('  <' + h.tag + '>' + label + ' ~' + h.pagesAway + ' pages ' + h.direction);
    }
    if (hiddenInteractives.length > 10) lines.push('  …' + (hiddenInteractives.length - 10) + ' more');
  }

  // Footer
  lines.push('---');
  lines.push('interactive: ' + interactiveIndex + ' | iframes: ' + iframeCount);

  // Store hashes on window for next diff snapshot
  try { window.__opencli_prev_hashes = JSON.stringify(currentHashes); } catch {}

  return lines.join('\\n');
})()
  `.trim();
}
