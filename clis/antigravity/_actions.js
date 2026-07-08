// Shared helpers for Antigravity sidebar conversation management.
//
// Each conversation in the sidebar is rendered as a row whose visible
// title element has stable testid `convo-pill-<uuid>`. The row container
// is the 3rd ancestor — it carries `role="button"` and acts as the
// clickable row.
//
// On hover the row shows 3 icon-only buttons. The FIRST (button[0]) is a
// "more options" 3-dot trigger that opens a 3-item dropdown:
//
//   Mark as Read
//   Rename
//   Delete Conversation
//
// We use that dropdown for all management operations. Antigravity does
// not currently expose Pin/Unpin as menu items (different model than
// Codex / Grok).
//
// All clicks go through the full pointer-event chain because the menu is
// likely radix-based and ignores bare .click().

import { CommandExecutionError, selectorError } from '@jackwener/opencli/errors';

const PILL_SELECTOR_PREFIX = 'convo-pill-';

export function unwrapEvaluateResult(payload) {
    if (
        payload
        && typeof payload === 'object'
        && Object.prototype.hasOwnProperty.call(payload, 'data')
        && Object.prototype.hasOwnProperty.call(payload, 'session')
    ) {
        return payload.data;
    }
    return payload;
}

export function buildPillTestId(conversationId) {
    return `${PILL_SELECTOR_PREFIX}${String(conversationId).toLowerCase()}`;
}

/**
 * Return all visible conversation pills with their {id, title} for
 * history-style listings or for fuzzy match.
 */
export async function listConversations(page) {
    const result = unwrapEvaluateResult(await page.evaluate(`(function() {
    return Array.from(document.querySelectorAll('[data-testid^="${PILL_SELECTOR_PREFIX}"]'))
      .filter((el) => el.offsetParent)
      .map((el, idx) => ({
        index: idx + 1,
        id: el.getAttribute('data-testid').slice(${PILL_SELECTOR_PREFIX.length}),
        title: (el.textContent || '').trim().slice(0, 200),
      }));
  })()`));
    return Array.isArray(result) ? result : [];
}

export async function conversationVisible(page, conversationId) {
    const testId = buildPillTestId(conversationId);
    return !!unwrapEvaluateResult(await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)});
    return !!(el && el.offsetParent);
  })()`));
}

export async function getConversationMenuLabels(page, conversationId) {
    const testId = buildPillTestId(conversationId);
    const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const pill = document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)});
    if (!pill) return { ok: false, reason: 'Conversation pill not found.', detail: 'testid=${testId}' };
    let row = pill;
    for (let i = 0; i < 3; i++) row = row.parentElement || row;
    row.scrollIntoView({ block: 'center' });
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    let dotBtn = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await wait(80);
      const btns = Array.from(row.querySelectorAll('button')).filter((b) => b.offsetParent);
      if (btns.length >= 1) { dotBtn = btns[0]; break; }
    }
    if (!dotBtn) return { ok: false, reason: 'Per-row 3-dot trigger never mounted after hover.' };
    const r = dotBtn.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    };
    dotBtn.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    dotBtn.dispatchEvent(new MouseEvent('mousedown', init));
    dotBtn.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    dotBtn.dispatchEvent(new MouseEvent('mouseup', init));
    dotBtn.dispatchEvent(new MouseEvent('click', init));
    let menuItems = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(80);
      menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'))
        .filter((it) => it instanceof HTMLElement && it.offsetParent);
      if (menuItems.length) break;
    }
    const labels = menuItems.map((it) => {
      const clone = it.cloneNode(true);
      clone.querySelectorAll('kbd').forEach((k) => k.remove());
      return (clone.textContent || '').trim();
    }).filter(Boolean);
    document.body.click();
    return { ok: true, labels };
  })()`));
    return result || { ok: false, reason: 'Empty result from page.evaluate.' };
}

/**
 * Open the per-row 3-dot menu for the given conversation, click the
 * menu item whose visible text matches `labelOptions`, return status.
 * Single page.evaluate so the menu stays mounted while we click.
 *
 * Returns { ok, clicked? , reason?, detail? }.
 */
export async function clickConversationMenuItem(page, conversationId, labelOptions) {
    const testId = buildPillTestId(conversationId);
    const testIdJson = JSON.stringify(testId);
    const labelsJson = JSON.stringify(labelOptions);

    // Wrap in try/catch — Antigravity menu clicks often trigger a
    // sidebar re-render that destroys the eval reply mid-stream, surfacing
    // as "Promise was collected" or 30s Runtime.evaluate timeout. The
    // click DID happen (we verified live by toggling Mark as Read /
    // Unread). Treat these specific failures as success-with-no-confirmation
    // and let the caller re-query history to verify.
    let result;
    try {
        result = unwrapEvaluateResult(await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const testId = ${testIdJson};
    const labels = ${labelsJson};

    const pill = document.querySelector(\`[data-testid="\${testId}"]\`);
    if (!pill) {
      return { ok: false, reason: 'Conversation pill not found.', detail: 'testid=' + testId };
    }

    // Walk up to the row container — depth 3 holds the role="button" row
    // with the per-row action buttons.
    let row = pill;
    for (let i = 0; i < 3; i++) row = row.parentElement || row;
    if (!row) {
      return { ok: false, reason: 'Could not locate the row container above the pill.' };
    }

    row.scrollIntoView({ block: 'center' });

    // React synthetic hover mounts the per-row buttons. Visibility-state
    // doesn't appear to gate Antigravity's overlay (unlike Codex), but
    // we still dispatch the full set for safety.
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    // Wait for the row's 3-dot trigger to mount.
    let dotBtn = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await wait(80);
      const btns = Array.from(row.querySelectorAll('button')).filter((b) => b.offsetParent);
      if (btns.length >= 1) { dotBtn = btns[0]; break; }  // First button == more-options
    }
    if (!dotBtn) {
      return { ok: false, reason: 'Per-row 3-dot trigger never mounted after hover.' };
    }

    // Open the menu via full pointer chain.
    const r = dotBtn.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    };
    dotBtn.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    dotBtn.dispatchEvent(new MouseEvent('mousedown', init));
    dotBtn.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    dotBtn.dispatchEvent(new MouseEvent('mouseup', init));
    dotBtn.dispatchEvent(new MouseEvent('click', init));

    // Wait for menu items to mount.
    let menuItems = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(80);
      menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'))
        .filter((it) => it instanceof HTMLElement && it.offsetParent);
      if (menuItems.length) break;
    }
    if (!menuItems.length) {
      return { ok: false, reason: 'Conversation 3-dot menu did not open after click.' };
    }

    function leadingText(el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('kbd').forEach((k) => k.remove());
      return (clone.textContent || '').trim();
    }

    let target = null;
    for (const item of menuItems) {
      const text = leadingText(item);
      for (const label of labels) {
        if (text === label || text.startsWith(label)) {
          target = item;
          break;
        }
      }
      if (target) break;
    }
    if (!target) {
      const visible = menuItems.map(leadingText);
      document.body.click();  // close menu
      return {
        ok: false,
        reason: 'No menu item matched the requested label.',
        detail: 'wanted=' + JSON.stringify(labels) + ' visible=' + JSON.stringify(visible),
      };
    }

    // Click via pointer chain too — radix is picky.
    const tr = target.getBoundingClientRect();
    const tinit = {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: Math.round(tr.left + tr.width / 2),
      clientY: Math.round(tr.top + tr.height / 2),
    };
    const matchedLabel = leadingText(target);
    // Defer to next microtask so the eval reply returns before any re-render.
    Promise.resolve().then(() => {
      try {
        target.dispatchEvent(new PointerEvent('pointerdown', { ...tinit, pointerType: 'mouse' }));
        target.dispatchEvent(new MouseEvent('mousedown', tinit));
        target.dispatchEvent(new PointerEvent('pointerup', { ...tinit, pointerType: 'mouse' }));
        target.dispatchEvent(new MouseEvent('mouseup', tinit));
        target.dispatchEvent(new MouseEvent('click', tinit));
      } catch {}
    });
    return { ok: true, clicked: matchedLabel };
  })()`));
    } catch (err) {
        const msg = String(err?.message || err);
        if (/Promise was collected|timed out after \d+s|Runtime\.evaluate/i.test(msg)) {
            // Click was scheduled inside a microtask before destruction, so
            // the action almost certainly fired. Report ambiguous-but-likely-ok.
            return {
                ok: true,
                clicked: labelOptions[0],
                note: 'eval reply destroyed by post-click re-render; click likely fired',
            };
        }
        throw err;
    }

    return result || { ok: false, reason: 'Empty result from page.evaluate.' };
}

/**
 * After Delete Conversation menu item is clicked, Antigravity shows a
 * confirm dialog. Locate it and click the confirm button.
 */
export async function confirmDeleteDialog(page, confirmLabels) {
    const labelsJson = JSON.stringify(confirmLabels);
    const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let dialog = null;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await wait(120);
      dialog = document.querySelector('[role="alertdialog"], [role="dialog"]');
      if (dialog && dialog.offsetParent) break;
    }
    if (!dialog) {
      return { ok: false, reason: 'Delete confirm dialog did not appear.' };
    }
    const buttons = Array.from(dialog.querySelectorAll('button'));
    const labels = ${labelsJson};
    const confirmBtn = buttons.find((b) => {
      const t = (b.textContent || '').trim();
      return labels.some((l) => t === l || t.toLowerCase() === l.toLowerCase());
    });
    if (!confirmBtn) {
      return {
        ok: false,
        reason: 'Confirm button not found in dialog.',
        detail: 'present=' + JSON.stringify(buttons.map((b) => (b.textContent || '').trim())),
      };
    }
    const r = confirmBtn.getBoundingClientRect();
    const init = {
      bubbles: true, button: 0, buttons: 1, cancelable: true,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    };
    Promise.resolve().then(() => {
      try {
        confirmBtn.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
        confirmBtn.dispatchEvent(new MouseEvent('mousedown', init));
        confirmBtn.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
        confirmBtn.dispatchEvent(new MouseEvent('mouseup', init));
        confirmBtn.dispatchEvent(new MouseEvent('click', init));
      } catch {}
    });
    return { ok: true, confirmed: (confirmBtn.textContent || '').trim() };
  })()`));
    return result || { ok: false, reason: 'Empty result.' };
}

export const conversationTargetArgs = [
    {
        name: 'id',
        positional: true,
        type: 'string',
        required: true,
        help: 'Conversation UUID (the part after "convo-pill-" in the sidebar testid)',
    },
];
