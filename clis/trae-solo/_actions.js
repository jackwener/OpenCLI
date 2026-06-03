// Shared helpers for trae-solo adapter — panel navigation, pointer chain, etc.

import { CommandExecutionError } from '@jackwener/opencli/errors';

// The 3 sidebar panel entries: 'New task' / 'Skills' / 'Automation'.
// Each renders as a clickable DIV with class .task-list-new-task-item.
export async function switchToPanel(page, panelName) {
    const nameJson = JSON.stringify(panelName);
    const result = await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const target = ${nameJson};
    // Check if already active.
    const active = Array.from(document.querySelectorAll('.task-list-new-task-item'))
      .find((el) => el.offsetParent && /\\b(task-list-skills-item|task-list-new-task-item-in)\\b/.test(el.className) && el.className.includes('active') && el.textContent.trim() === target);
    if (active) return { ok: true, already: true };
    const entry = Array.from(document.querySelectorAll('.task-list-new-task-item'))
      .find((el) => el.offsetParent && el.textContent.trim() === target);
    if (!entry) {
      return { ok: false, reason: 'Panel entry not found.', detail: 'wanted=' + target };
    }
    const r = entry.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: Math.round(r.left + Math.min(30, r.width / 2)),
      clientY: Math.round(r.top + Math.min(10, r.height / 2)),
    };
    entry.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    entry.dispatchEvent(new MouseEvent('mousedown', init));
    entry.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    entry.dispatchEvent(new MouseEvent('mouseup', init));
    entry.dispatchEvent(new MouseEvent('click', init));
    await wait(900);
    return { ok: true };
  })()`);
    if (!result?.ok) {
        throw new CommandExecutionError(result?.reason || `Could not switch to ${panelName} panel.`, result?.detail || '');
    }
    return result;
}

// Click a target element using the full pointer-event chain. Useful for
// React + radix components that ignore plain .click().
export async function pointerClickByEval(page, selectorJsExpr) {
    return await page.evaluate(`(async () => {
    const target = ${selectorJsExpr};
    if (!target) return { ok: false, reason: 'target not found' };
    const r = target.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    };
    target.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    target.dispatchEvent(new MouseEvent('click', init));
    return { ok: true };
  })()`);
}
