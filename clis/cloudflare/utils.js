// Run in the page. Deliberately use visible semantic controls rather than generated classes.
export function leeDOM(action, value) {
    const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const text = e => (e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || '').trim();
    const controls = root => [...root.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"]')].filter(visible);
    const find = (root, names) => controls(root).filter(e => names.includes(text(e)));
    const input = [...document.querySelectorAll('textarea[placeholder="Type @ to tag a resource or ? for shortcuts"]')].find(visible);
    const newNames = ['New conversation', 'New chat'];
    let panel = null;
    for (let p = input?.parentElement; p && p !== document.body; p = p.parentElement) {
        if (find(p, newNames).length === 1) { panel = p; break; }
    }
    const click = (root, names) => {
        const matches = find(root, names);
        if (matches.length !== 1 || matches[0].disabled || matches[0].getAttribute('aria-disabled') === 'true') return false;
        matches[0].click();
        return true;
    };
    if (action === 'state') {
        const headings = [...document.querySelectorAll('h1,h2')].filter(visible).map(text).join(' ');
        return {
            url: location.href, visibility: document.visibilityState,
            challenge: /Just a moment/i.test(document.title) || /Performing security verification|Verify you are human/i.test(headings),
            login: /\/(login|sign-in)(\/|$)/.test(location.pathname) || [...document.querySelectorAll('input[type="password"]')].some(visible),
            composer: !!input, panel: !!panel,
        };
    }
    if (document.visibilityState !== 'visible') return { error: 'Lee requires document.visibilityState=visible' };
    if (action === 'open') return { ok: click(document, ['Ask AI']) };
    if (!panel) return { error: 'Could not identify the Lee panel and its New conversation control' };
    if (action === 'new') return { ok: click(panel, newNames) };
    if (action === 'mode') return { ok: click(panel, ['Ask', 'Edit', 'Ask before editing', 'Automatically edit']) };
    if (action === 'choose') return { ok: click(document, [value]) };
    if (action === 'selected') {
        const matches = find(panel, value === 'edit' ? ['Edit', 'Automatically edit'] : ['Ask', 'Ask before editing']);
        return { ok: matches.length === 1 };
    }
    if (action === 'approve') return { ok: click(panel, ['Allow for this conversation']) };
    if (action === 'empty') return { ok: input.value === '' && !/Worked\s+[^\n]+/.test(panel.innerText) };
    if (action === 'composer') {
        return { ok: !input.disabled && !input.readOnly && input.value === value };
    }
    if (action === 'answer') {
        const approvals = find(panel, ['Allow for this conversation', 'Just this time']);
        const busy = controls(panel).some(e => /^(Stop|Stop generating|Stop response)$/.test(text(e))) ||
            [...panel.querySelectorAll('[aria-busy="true"]')].some(visible);
        // A fresh conversation is required before sending. Only text following its Worked marker
        // can be a final response; never return a previous conversation or a streaming partial.
        const markers = [...panel.querySelectorAll('*')].filter(e => visible(e) &&
            /^Worked\s+[^\n]+$/.test(text(e)) && ![...e.children].some(c => /^Worked\s+[^\n]+$/.test(text(c))));
        const marker = markers.at(-1);
        let composer = input;
        for (let p = input.parentElement; p && p !== panel; p = p.parentElement) {
            if (find(p, ['Ask', 'Edit', 'Ask before editing', 'Automatically edit']).length) { composer = p; break; }
        }
        let response = '';
        if (marker && (marker.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            const range = document.createRange();
            range.setStartAfter(marker.closest('button') || marker);
            range.setEndBefore(composer);
            const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
            const lines = [];
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const p = n.parentElement;
                if (n.textContent.trim() && visible(p) && !p.closest('button,[role="button"],script,style,textarea') &&
                    range.comparePoint(n, 0) === 0) lines.push(n.textContent.trim());
            }
            response = lines.join('\n');
        }
        return { approval: approvals.length > 0, busy, worked: marker ? text(marker) : '', response };
    }
    return { error: 'Unknown Lee DOM operation' };
}

