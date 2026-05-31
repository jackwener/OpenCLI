// Shared helpers for the Qoder adapter.
//
// Qoder is an Electron-based AI IDE (Alibaba; com.qoder.ide). It's
// VSCode-derived (same Electron + Monaco shell) and shares many DOM
// patterns with Trae SOLO. CDP port: 9237 (declared in
// src/electron-apps.ts and launched by ~/.claude/bin/qoder-launch-with-cdp.sh).
//
// Terminology:
//   - "Quest"      = conversation (Qoder's term for a chat thread)
//   - "Workspace"  = open folder (VSCode-style)
//   - "Knowledge"  = personal/team knowledge base
//   - "Marketplace"= plugin/skill marketplace

export const IS_VISIBLE_JS = `
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    return true;
  };
`;

// Build a JS snippet that clicks the first visible element matching any
// of the given CSS selectors. Uses the full pointer-event chain to
// satisfy radix/headless menu libraries.
export function clickFirstScript(selectors) {
    return `(() => {
    ${IS_VISIBLE_JS}
    const sels = ${JSON.stringify(selectors)};
    for (const sel of sels) {
      const target = Array.from(document.querySelectorAll(sel)).filter(isVisible)[0];
      if (target) {
        const r = target.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
        target.dispatchEvent(new PointerEvent('pointerdown', opts));
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new PointerEvent('pointerup', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.click();
        return { ok: true, sel };
      }
    }
    return { ok: false, reason: 'No matching visible element.' };
  })()`;
}

// Variant: match a button by visible innerText (substring or full match).
// Useful when Qoder buttons lack aria-label.
export function clickByTextScript(textPatterns, opts = {}) {
    const { exact = false, maxLen = 60 } = opts;
    return `(() => {
    ${IS_VISIBLE_JS}
    const patterns = ${JSON.stringify(textPatterns)};
    const exact = ${exact ? 'true' : 'false'};
    const maxLen = ${maxLen};
    const isVis = isVisible;
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, [role="tab"]')).filter(isVis);
    for (const pat of patterns) {
      const target = candidates.find((b) => {
        const tx = (b.innerText || b.textContent || '').trim();
        if (tx.length > maxLen) return false;
        return exact ? tx === pat : tx.toLowerCase().includes(pat.toLowerCase());
      });
      if (target) {
        const r = target.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
        target.dispatchEvent(new PointerEvent('pointerdown', opts));
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new PointerEvent('pointerup', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.click();
        return { ok: true, matched: pat };
      }
    }
    return { ok: false, reason: 'No button matching: ' + patterns.join(' / ') };
  })()`;
}

// Wait for an element to appear by polling page.evaluate.
export async function waitForSelector(page, selector, timeoutMs = 5000, intervalMs = 200) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const exists = await page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
        if (exists) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}
