/**
 * Visual ref overlay for annotated screenshots.
 *
 * The overlay is intentionally DOM-side and temporary. It reuses the same
 * `data-opencli-ref` attributes produced by the DOM snapshot path so the
 * screenshot labels map back to normal `browser click <ref>` targets.
 */

const OVERLAY_ID = '__opencli_visual_ref_overlay';

export function installVisualRefOverlayJs(opts: { maxRefs?: number } = {}): string {
  const maxRefs = Math.max(1, Math.min(opts.maxRefs ?? 120, 500));
  return `
    (() => {
      const OVERLAY_ID = ${JSON.stringify(OVERLAY_ID)};
      const MAX_REFS = ${maxRefs};
      document.getElementById(OVERLAY_ID)?.remove();

      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        pointerEvents: 'none',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      });

      const refs = Array.from(document.querySelectorAll('[data-opencli-ref]'))
        .map((el) => {
          const rawRef = el.getAttribute('data-opencli-ref') || '';
          const ref = Number(rawRef);
          const rect = el.getBoundingClientRect();
          const visible = Number.isFinite(ref)
            && rect.width >= 2
            && rect.height >= 2
            && rect.bottom >= 0
            && rect.right >= 0
            && rect.top <= window.innerHeight
            && rect.left <= window.innerWidth;
          return { el, rawRef, ref, rect, visible };
        })
        .filter((entry) => entry.visible)
        .sort((a, b) => a.ref - b.ref)
        .slice(0, MAX_REFS);

      for (const entry of refs) {
        const left = Math.max(0, Math.min(window.innerWidth - 1, entry.rect.left));
        const top = Math.max(0, Math.min(window.innerHeight - 1, entry.rect.top));
        const right = Math.max(0, Math.min(window.innerWidth, entry.rect.right));
        const bottom = Math.max(0, Math.min(window.innerHeight, entry.rect.bottom));
        const width = Math.max(2, right - left);
        const height = Math.max(2, bottom - top);

        const box = document.createElement('div');
        Object.assign(box.style, {
          position: 'fixed',
          left: left + 'px',
          top: top + 'px',
          width: width + 'px',
          height: height + 'px',
          border: '2px solid #ff3b30',
          borderRadius: '4px',
          boxSizing: 'border-box',
          boxShadow: '0 0 0 1px rgba(255,255,255,.9), 0 4px 16px rgba(0,0,0,.25)',
          background: 'rgba(255,59,48,.08)',
        });

        const badge = document.createElement('div');
        badge.textContent = entry.rawRef;
        Object.assign(badge.style, {
          position: 'fixed',
          left: left + 'px',
          top: Math.max(0, top - 20) + 'px',
          minWidth: '18px',
          height: '18px',
          padding: '0 5px',
          borderRadius: '999px',
          border: '1px solid rgba(255,255,255,.95)',
          background: '#ff3b30',
          color: '#fff',
          fontSize: '12px',
          fontWeight: '700',
          lineHeight: '18px',
          textAlign: 'center',
          textShadow: '0 1px 1px rgba(0,0,0,.25)',
          boxShadow: '0 2px 8px rgba(0,0,0,.35)',
        });

        overlay.appendChild(box);
        overlay.appendChild(badge);
      }

      document.documentElement.appendChild(overlay);
      return {
        annotated: refs.length,
        truncated: refs.length >= MAX_REFS,
      };
    })()
  `.trim();
}

export function removeVisualRefOverlayJs(): string {
  return `
    (() => {
      document.getElementById(${JSON.stringify(OVERLAY_ID)})?.remove();
      return true;
    })()
  `.trim();
}
