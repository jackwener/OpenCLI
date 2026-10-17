import { describe, expect, it } from 'vitest';
import { boundingRectResolvedJs } from './target-resolver.js';

/**
 * Build a fake element usable by the generated boundingRectResolvedJs. Rects are
 * {left,top,width,height}; getBoundingClientRect derives right/bottom.
 */
function makeEl(opts: {
  tag: string; rect: { left: number; top: number; width: number; height: number };
  cursor?: string; onclick?: boolean; role?: string; attrs?: Record<string, string>;
}) {
  const attrs = opts.attrs ?? {};
  const el: any = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    _cursor: opts.cursor ?? 'auto',
    onclick: opts.onclick ? () => {} : null,
    parentElement: null,
    children: [] as any[],
    scrollIntoView() {},
    getBoundingClientRect() {
      const r = opts.rect;
      return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height };
    },
    getAttribute(k: string) { return k === 'role' ? (opts.role ?? null) : (attrs[k] ?? null); },
    hasAttribute(k: string) { return k === 'role' ? opts.role != null : k in attrs; },
    contains(other: any) {
      if (other === el) return true;
      for (const c of el.children) { if (c === other || (c.contains && c.contains(other))) return true; }
      return false;
    },
  };
  return el;
}

/** Resolve computed cursor with CSS inheritance, so the fake DOM matches the
 * browser: a child with no own cursor inherits its ancestors' pointer cursor. */
function inheritedCursor(node: any): string {
  let n = node;
  while (n) {
    if (n._cursor && n._cursor !== 'auto') return n._cursor;
    n = n.parentElement;
  }
  return 'auto';
}

/** Run the generated boundingRectResolvedJs against a fake DOM. */
function runRect(resolved: any, elementAt: (x: number, y: number) => any) {
  const fakeWindow: any = { __resolved: resolved, getComputedStyle: (n: any) => ({ cursor: inheritedCursor(n) }) };
  const fakeDoc: any = { elementFromPoint: (x: number, y: number) => elementAt(x, y) };
  const js = boundingRectResolvedJs({ skipScroll: true, forClick: true });
  // js is an IIFE expression `(() => {...})()`; arrow captures window/document
  // params. Wrap in parens so ASI doesn't turn `return\n(` into `return;`.
  return new Function('window', 'document', 'return (' + js + ')')(fakeWindow, fakeDoc);
}

describe('boundingRectResolvedJs runtime behavior', () => {
  it('reports hit=target and no retarget when the centre lands on the element', () => {
    const btn = makeEl({ tag: 'button', rect: { left: 0, top: 0, width: 100, height: 40 } });
    const out = runRect(btn, () => btn);
    expect(out.visible).toBe(true);
    expect(out.hit).toBe('target');
    expect(out.retargeted).toBe(false);
    expect(out.x).toBe(50); expect(out.y).toBe(20);
  });

  it('retargets an <svg> icon to its clickable <div> ancestor (#2071)', () => {
    const div = makeEl({ tag: 'div', rect: { left: 0, top: 0, width: 80, height: 80 }, cursor: 'pointer' });
    const svg = makeEl({ tag: 'svg', rect: { left: 20, top: 20, width: 40, height: 40 } });
    svg.parentElement = div; div.children = [svg];
    // elementFromPoint at the div centre returns the svg (topmost paint), which
    // is contained by div → hit=target on the retargeted element.
    const out = runRect(svg, () => svg);
    expect(out.retargeted).toBe(true);
    expect(out.hit).toBe('target');
    // measured rect is the div's (80x80 → centre 40,40), not the svg's
    expect(out.w).toBe(80); expect(out.x).toBe(40); expect(out.y).toBe(40);
  });

  it('retargets to an ancestor that owns an onclick handler even without cursor:pointer (#2071)', () => {
    const div = makeEl({ tag: 'div', rect: { left: 0, top: 0, width: 60, height: 60 }, onclick: true });
    const svg = makeEl({ tag: 'svg', rect: { left: 10, top: 10, width: 40, height: 40 } });
    svg.parentElement = div; div.children = [svg];
    const out = runRect(svg, () => svg);
    expect(out.retargeted).toBe(true);
    expect(out.w).toBe(60);
  });

  it('does not retarget when no ancestor is clickable', () => {
    const wrap = makeEl({ tag: 'div', rect: { left: 0, top: 0, width: 60, height: 60 } });
    const span = makeEl({ tag: 'span', rect: { left: 10, top: 10, width: 40, height: 40 } });
    span.parentElement = wrap; wrap.children = [span];
    const out = runRect(span, () => span);
    expect(out.retargeted).toBe(false);
    expect(out.w).toBe(40);
  });

  it('treats an ancestor hit as trustworthy (open shadow-DOM host / own wrapper) and keeps the centre', () => {
    // elementFromPoint returns a light-DOM ancestor (e.g. the shadow host) that
    // contains the target — CDP pierces to the target, so this must NOT fall back.
    const host = makeEl({ tag: 'div', rect: { left: 0, top: 0, width: 120, height: 60 } });
    const btn = makeEl({ tag: 'button', rect: { left: 10, top: 10, width: 100, height: 40 } });
    btn.parentElement = host; host.children = [btn];
    const out = runRect(btn, () => host); // topmost at every point is the host (ancestor)
    expect(out.hit).toBe('ancestor');
    expect(out.retargeted).toBe(false);
    // centre kept — no wasted probing when the hit is already trustworthy
    expect(out.x).toBe(60); expect(out.y).toBe(30);
  });

  it('hover/dblClick mode (forClick omitted) returns the plain element centre with no hit-test', () => {
    const div = makeEl({ tag: 'div', rect: { left: 0, top: 0, width: 80, height: 80 }, cursor: 'pointer' });
    const svg = makeEl({ tag: 'svg', rect: { left: 20, top: 20, width: 40, height: 40 } });
    svg.parentElement = div; div.children = [svg];
    const js = boundingRectResolvedJs({ skipScroll: true }); // no forClick
    const out = new Function('window', 'document', 'return (' + js + ')')(
      { __resolved: svg, getComputedStyle: () => ({ cursor: 'pointer' }) },
      { elementFromPoint: () => div },
    );
    // no retarget, no hit field — svg's own centre (40,40), unchanged behavior
    expect(out.hit).toBeUndefined();
    expect(out.retargeted).toBeUndefined();
    expect(out.x).toBe(40); expect(out.y).toBe(40); expect(out.w).toBe(40);
  });

  it('reports hit=other when an overlay covers the element and no probe point lands (#2076)', () => {
    const btn = makeEl({ tag: 'button', rect: { left: 0, top: 0, width: 100, height: 40 } });
    const overlay = makeEl({ tag: 'div', rect: { left: 0, top: 0, width: 1000, height: 1000 } });
    const out = runRect(btn, () => overlay); // every point hits the overlay
    expect(out.hit).toBe('other');
    expect(out.retargeted).toBe(false);
  });

  it('recovers a hitting point by probing when the centre is occluded but a corner is clear (#2076)', () => {
    const btn = makeEl({ tag: 'button', rect: { left: 0, top: 0, width: 100, height: 40 } });
    const overlay = makeEl({ tag: 'div', rect: { left: 40, top: 15, width: 20, height: 10 } });
    // Centre (50,20) is covered by the overlay; the top-left inset (3,3) is clear.
    const out = runRect(btn, (x, y) => (x === 50 && y === 20 ? overlay : btn));
    expect(out.hit).toBe('target');
    // the returned point moved off the occluded centre (50,20)
    expect(out.x === 50 && out.y === 20).toBe(false);
  });
});
