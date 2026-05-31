// Per-message + composer actions in the Codex Desktop app.
// All operate on the CURRENT conversation (whatever is visible in the
// main pane). Use `openCodexConversation` from sidebar.js if you need
// to navigate first via --project/--chat.
//
//   react <kind>     — click Good response or Bad response on the last
//                      assistant turn (kind = good|bad)
//   copy-message     — return the text of the last assistant message
//                      (and optionally click the Copy button)
//   fork             — Fork from this point (creates a new branch from the
//                      last assistant message). --yes gated.
//   edit-message     — click "Edit message" on the last user message and
//                      return the original text (for the caller to then
//                      submit a modified version)
//   undo             — click Undo (Codex's undo for the most recent agent
//                      action, e.g. file edit). --yes gated.
//   scroll-bottom    — scroll the chat pane to the bottom (jumps past
//                      collapsed "Show N more" sections)

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

// Locale fallbacks would go here if Codex were i18n'd; the Desktop app
// currently ships English-only, so single labels are enough.
const REACT_GOOD_LABEL = 'Good response';
const REACT_BAD_LABEL = 'Bad response';
const COPY_MESSAGE_LABEL = 'Copy message';
const FORK_LABEL = 'Fork from this point';
const EDIT_MESSAGE_LABEL = 'Edit message';
const UNDO_LABEL = 'Undo';
const SCROLL_BOTTOM_LABEL = 'Scroll to bottom';

// Build a small helper to click the LAST visible button with aria-label === label.
function clickByLabelScript(label) {
    return `(() => {
    const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const btns = Array.from(document.querySelectorAll('button[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']'))
      .filter(isVis);
    if (!btns.length) return { ok: false, reason: 'No visible button with aria-label="${label}".' };
    const target = btns[btns.length - 1];
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

// -------- react --------
cli({
    site: 'codex',
    name: 'react',
    access: 'write',
    description: 'Click "Good response" or "Bad response" on the LAST assistant message. Codex shows these inline below each assistant turn.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'kind', positional: true, required: true, help: 'good or bad' },
    ],
    columns: ['Status', 'Reaction'],
    func: async (page, kwargs) => {
        const kind = String(kwargs?.kind || '').trim().toLowerCase();
        if (kind !== 'good' && kind !== 'bad') {
            throw new ArgumentError('kind', 'must be "good" or "bad"');
        }
        const label = kind === 'good' ? REACT_GOOD_LABEL : REACT_BAD_LABEL;
        const res = await page.evaluate(clickByLabelScript(label));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'react click failed', '');
        return [{ Status: 'clicked', Reaction: kind }];
    },
});

// -------- copy-message --------
cli({
    site: 'codex',
    name: 'copy-message',
    access: 'read',
    description: 'Return the text of the last assistant message in the current Codex conversation. Use --click-button to also fire the in-UI Copy button (writes to system clipboard).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'click-button', type: 'boolean', default: false, help: 'Also click Copy message button (writes to system clipboard)' },
    ],
    columns: ['Field', 'Value'],
    func: async (page, kwargs) => {
        // Codex marks message turns with various data-testid values; the
        // most stable signal is the visible "Copy message" button which
        // sits at the bottom of each assistant turn. We find the LAST
        // such button, then walk up to find its enclosing message text.
        const data = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const copyBtns = Array.from(document.querySelectorAll('button[aria-label="Copy message"]')).filter(isVis);
      if (!copyBtns.length) return null;
      const lastCopy = copyBtns[copyBtns.length - 1];
      // The assistant message text usually lives in a sibling div or in the
      // parent's preceding-sibling block. Walk up a few levels to find a
      // container with substantial text.
      let container = lastCopy;
      let bestText = '';
      for (let i = 0; i < 8 && container.parentElement; i++) {
        container = container.parentElement;
        const txt = (container.innerText || '').trim();
        if (txt.length > bestText.length) bestText = txt;
        if (bestText.length > 200) break;
      }
      return { text: bestText, foundButton: true };
    })()`);
        if (!data) {
            throw new EmptyResultError('codex copy-message', 'No "Copy message" button found — make sure a conversation with an assistant reply is visible.');
        }
        if (kwargs?.['click-button'] === true || kwargs?.['click-button'] === 'true') {
            await page.evaluate(clickByLabelScript(COPY_MESSAGE_LABEL));
        }
        return [
            { Field: 'Length', Value: String((data.text || '').length) + ' chars' },
            { Field: 'ClipboardClicked', Value: (kwargs?.['click-button'] === true || kwargs?.['click-button'] === 'true') ? 'yes' : 'no' },
            { Field: 'Text', Value: data.text || '' },
        ];
    },
});

// -------- fork --------
cli({
    site: 'codex',
    name: 'fork',
    access: 'write',
    description: 'Click "Fork from this point" on the LAST assistant message — creates a new conversation branch from that point. Requires --yes (this is non-undoable; it starts a new chat).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'yes', type: 'boolean', default: false, help: 'Actually fork (default: dry-run)' },
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const yes = kwargs?.yes === true || kwargs?.yes === 'true' || kwargs?.yes === '1';
        if (!yes) {
            return [{ Status: 'dry-run — pass --yes to fork from this point' }];
        }
        const res = await page.evaluate(clickByLabelScript(FORK_LABEL));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'fork click failed', '');
        await page.wait(1);
        return [{ Status: 'forked' }];
    },
});

// -------- edit-message --------
cli({
    site: 'codex',
    name: 'edit-message',
    access: 'write',
    description: 'Click "Edit message" on the LAST user message and return its original text (the input becomes editable in-place).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status', 'OriginalText'],
    func: async (page) => {
        const data = await page.evaluate(`(() => {
      const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const editBtns = Array.from(document.querySelectorAll('button[aria-label="Edit message"]')).filter(isVis);
      if (!editBtns.length) return null;
      const lastEdit = editBtns[editBtns.length - 1];
      // Find the user message text — walk up to a container.
      let container = lastEdit;
      let bestText = '';
      for (let i = 0; i < 6 && container.parentElement; i++) {
        container = container.parentElement;
        const txt = (container.innerText || '').trim();
        if (txt.length > bestText.length && txt.length < 4000) bestText = txt;
        if (bestText.length > 100) break;
      }
      // Click.
      const r = lastEdit.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      lastEdit.dispatchEvent(new PointerEvent('pointerdown', opts));
      lastEdit.dispatchEvent(new MouseEvent('mousedown', opts));
      lastEdit.dispatchEvent(new PointerEvent('pointerup', opts));
      lastEdit.dispatchEvent(new MouseEvent('mouseup', opts));
      lastEdit.click();
      return { text: bestText };
    })()`);
        if (!data) {
            throw new EmptyResultError('codex edit-message', 'No "Edit message" button found — make sure a user message is visible in the current conversation.');
        }
        return [{ Status: 'edit-opened', OriginalText: (data.text || '').slice(0, 400) }];
    },
});

// -------- undo --------
cli({
    site: 'codex',
    name: 'undo',
    access: 'write',
    description: 'Click Undo to revert Codex\'s most recent agent action (e.g., file edit, command run). Requires --yes (this modifies your workspace).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'yes', type: 'boolean', default: false, help: 'Actually undo (default: dry-run)' },
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const yes = kwargs?.yes === true || kwargs?.yes === 'true' || kwargs?.yes === '1';
        if (!yes) {
            return [{ Status: 'dry-run — pass --yes to undo the last agent action' }];
        }
        const res = await page.evaluate(clickByLabelScript(UNDO_LABEL));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'undo click failed', '');
        await page.wait(0.8);
        return [{ Status: 'undone' }];
    },
});

// -------- scroll-bottom --------
cli({
    site: 'codex',
    name: 'scroll-bottom',
    access: 'write',
    description: 'Scroll the chat pane to the bottom (click "Scroll to bottom" button if visible, otherwise issue End key).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await page.evaluate(clickByLabelScript(SCROLL_BOTTOM_LABEL));
        if (res?.ok) return [{ Status: 'scrolled' }];
        // Fallback: scroll all message-containing scrollers to bottom.
        await page.evaluate(`(() => {
      const scrollers = Array.from(document.querySelectorAll('[class*="overflow"]')).filter((el) => el.scrollHeight > el.clientHeight + 50);
      scrollers.forEach((el) => { el.scrollTop = el.scrollHeight; });
    })()`);
        return [{ Status: 'scrolled (fallback)' }];
    },
});
