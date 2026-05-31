// Shared helpers for the Kimi (kimi.com) web adapter.
//
// Kimi is Moonshot's web app at kimi.com (formerly kimi.moonshot.cn).
// The UI uses SVG icons identified by `name="XXX"` attributes rather
// than aria-labels — finding buttons typically means walking up from
// `<svg role="img" name="Copy">` to the nearest <div> or <button>.

export const KIMI_DOMAIN = 'kimi.com';
export const KIMI_URL = 'https://www.kimi.com/';

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

// Ensure the current page is on kimi.com (any subpath). If not, navigate to root.
export function isKimiUrl(value) {
    try {
        const url = new URL(String(value || ''));
        const host = url.hostname.toLowerCase();
        return url.protocol === 'https:' && (host === KIMI_DOMAIN || host === `www.${KIMI_DOMAIN}`);
    } catch {
        return false;
    }
}

export async function ensureOnKimi(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (isKimiUrl(url)) return;
    await page.goto(KIMI_URL);
    await page.wait(2);
}

// Parse a chat ID (UUID-like) from either a raw id or a /chat/<id> URL.
const CHAT_ID_RE = /^[0-9a-f-]{8,}$/i;

export function parseChatId(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    const normalizeId = (value) => (CHAT_ID_RE.test(value) ? value.toLowerCase() : '');
    if (/^https?:\/\//i.test(s)) {
        try {
            const url = new URL(s);
            const host = url.hostname.toLowerCase();
            if (url.protocol !== 'https:' || (host !== KIMI_DOMAIN && host !== `www.${KIMI_DOMAIN}`)) return '';
            const match = url.pathname.match(/^\/chat\/([0-9a-f-]{8,})$/i);
            return match ? normalizeId(match[1]) : '';
        } catch {
            return '';
        }
    }
    if (s.startsWith('/')) {
        try {
            const url = new URL(s, KIMI_URL);
            const match = url.pathname.match(/^\/chat\/([0-9a-f-]{8,})$/i);
            return match ? normalizeId(match[1]) : '';
        } catch {
            return '';
        }
    }
    return normalizeId(s);
}

// Build a JS snippet that clicks a button containing an <svg name="X">.
// Kimi nests them: <div onClick><svg role=img name=Copy /></div>.
// We walk up from the SVG to the first <div role=button> or clickable
// ancestor and dispatch the pointer chain.
export function clickBySvgNameScript(svgName, opts = {}) {
    const { last = true } = opts;
    return `(() => {
    ${IS_VISIBLE_JS}
    const svgs = Array.from(document.querySelectorAll('svg[name="' + ${JSON.stringify(svgName)} + '"], svg[role="img"][name="' + ${JSON.stringify(svgName)} + '"]')).filter(isVisible);
    if (!svgs.length) return { ok: false, reason: 'No visible svg[name="' + ${JSON.stringify(svgName)} + '"].' };
    const svg = ${last ? 'svgs[svgs.length - 1]' : 'svgs[0]'};
    // Walk up to the nearest clickable ancestor.
    let target = svg;
    for (let i = 0; i < 6; i++) {
      const parent = target.parentElement;
      if (!parent) break;
      target = parent;
      if (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button' || target.onclick || target.tagName === 'A') break;
    }
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.click();
    return { ok: true };
  })()`;
}

// Click first link whose href matches a pattern (used for sidebar mode nav).
export function navByHrefScript(hrefPattern) {
    return `(() => {
    ${IS_VISIBLE_JS}
    const anchors = Array.from(document.querySelectorAll('a[href]')).filter(isVisible);
    const target = anchors.find((a) => a.getAttribute('href') === ${JSON.stringify(hrefPattern)} || a.getAttribute('href').startsWith(${JSON.stringify(hrefPattern)}));
    if (!target) return { ok: false, reason: 'No visible <a href="' + ${JSON.stringify(hrefPattern)} + '">.' };
    target.click();
    return { ok: true, href: target.getAttribute('href') };
  })()`;
}
