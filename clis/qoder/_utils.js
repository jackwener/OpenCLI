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

import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

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

export function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

export async function evaluateQoder(page, script) {
    return unwrapEvaluateResult(await page.evaluate(script));
}

export function requireArrayResult(value, label) {
    if (!Array.isArray(value)) {
        throw new CommandExecutionError(`${label}: unexpected evaluate result shape`);
    }
    return value;
}

export function parsePositiveInt(raw, fallback, label) {
    const value = raw == null || raw === '' ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    return value;
}

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

export const QODER_TURNS_JS = `(() => {
  ${IS_VISIBLE_JS}
  const chatPanes = Array.from(document.querySelectorAll('[class*="chat"i], [class*="conversation"i], [class*="message"i]')).filter(isVisible);
  if (!chatPanes.length) return [];
  const pane = chatPanes.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  const candidates = Array.from(pane.querySelectorAll('div, article, [class*="message"i], [class*="turn"i], [class*="bubble"i]'))
    .filter(isVisible)
    .filter((el) => {
      const tx = (el.innerText || '').trim();
      return tx.length > 5 && tx.length < 4000 && el.children.length < 20;
    });
  const seen = new Set();
  return candidates.map((el) => {
    const tx = (el.innerText || '').trim().replace(/\\s+/g, ' ');
    if (seen.has(tx)) return null;
    seen.add(tx);
    const cls = (el.className || '').toString().toLowerCase();
    const role = /user|me-|right/.test(cls) ? 'User' : (/assistant|ai|bot|response/.test(cls) ? 'Assistant' : 'Turn');
    return { role, text: tx };
  }).filter(Boolean);
})()`;

export function buildQoderInjectTextScript(text) {
    return `(() => {
      ${IS_VISIBLE_JS}
      const editors = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(isVisible);
      const candidates = editors.map((editor, index) => {
        const rect = editor.getBoundingClientRect();
        const attrs = [
          editor.getAttribute('aria-label') || '',
          editor.getAttribute('placeholder') || '',
          editor.getAttribute('data-placeholder') || '',
          editor.textContent || '',
          editor.className || '',
          editor.closest('[class*="composer"i], [class*="input"i], [class*="chat"i]')?.className || '',
        ].join(' ').toLowerCase();
        let score = 0;
        if (editor.getAttribute('role') === 'textbox') score += 25;
        if (attrs.includes('message') || attrs.includes('prompt') || attrs.includes('ask')) score += 120;
        if (attrs.includes('composer') || attrs.includes('input')) score += 60;
        if (attrs.includes('optional description') || attrs.includes('user context document') || attrs.includes('knowledge')) score -= 240;
        if (window.innerHeight > 0) score += Math.max(0, 80 - Math.abs(window.innerHeight - (rect.y + rect.height)) / 8);
        return { editor, index, score };
      }).sort((a, b) => b.score - a.score || b.index - a.index);
      const best = candidates[0];
      if (!best || best.score < 40) return { ok: false, reason: 'No high-confidence Qoder composer found.' };
      const editor = best.editor;
      editor.focus();
      document.execCommand('selectAll', false);
      const inserted = document.execCommand('insertText', false, ${JSON.stringify(String(text ?? ''))});
      if (!inserted) {
        editor.textContent = ${JSON.stringify(String(text ?? ''))};
      }
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(String(text ?? ''))} }));
      return { ok: true, score: best.score };
    })()`;
}

export const QODER_MESSAGE_COUNT_JS = `(() => {
  const turns = ${QODER_TURNS_JS};
  return Array.isArray(turns) ? turns.length : 0;
})()`;

export function qoderResponseAfterScript(previousCount, userText) {
    return `(() => {
      const turns = ${QODER_TURNS_JS};
      if (!Array.isArray(turns) || turns.length <= ${Number(previousCount) || 0}) return null;
      const fresh = turns.slice(${Number(previousCount) || 0})
        .filter((turn) => turn && turn.text && turn.text !== ${JSON.stringify(String(userText ?? ''))});
      return fresh.length ? fresh[fresh.length - 1] : null;
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
