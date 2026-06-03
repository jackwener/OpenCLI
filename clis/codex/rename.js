import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    conversationSelectionArgs,
    selectAndClickAction,
    unwrapEvaluateResult,
    waitForConversationPostcondition,
} from './_actions.js';

cli({
    site: 'codex',
    name: 'rename',
    access: 'write',
    description: 'Rename the selected Codex conversation. Opens the Chat actions menu → "Rename chat", then types the new title.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'title', required: true, positional: true, help: 'New title (single line, no newlines)' },
        ...conversationSelectionArgs,
    ],
    columns: ['status', 'title', 'thread_id', 'project'],
    func: async (page, kwargs) => {
        const title = String(kwargs.title || '').trim();
        if (!title) throw new ArgumentError('title cannot be empty');
        if (title.includes('\n')) throw new ArgumentError('title must be a single line');

        // 1. Select the target chat AND click "Rename chat" in the menu.
        const action = await selectAndClickAction(page, kwargs, ['Rename chat']);
        await page.wait(0.5);

        // 2. The rename input is the only non-ProseMirror editable that just appeared.
        //    Fill it via execCommand insertText (Codex uses a contenteditable, not a plain input).
        const filled = unwrapEvaluateResult(await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let input = null;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const candidates = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), [contenteditable="true"]'))
          .filter((el) => el.offsetParent && !el.classList.contains('ProseMirror'));
        if (candidates.length) {
          candidates.sort((a, b) => (a.getBoundingClientRect().left || 9999) - (b.getBoundingClientRect().left || 9999));
          input = candidates[0];
          break;
        }
        await wait(120);
      }
      if (!input) return { ok: false, reason: 'Rename input did not appear after menu click.' };
      input.focus();
      const newTitle = ${JSON.stringify(title)};
      if (input instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setter.call(input, newTitle);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const range = document.createRange();
        range.selectNodeContents(input);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete');
        document.execCommand('insertText', false, newTitle);
      }
      return { ok: true };
    })()`));
        if (!filled?.ok) {
            throw new CommandExecutionError(filled?.reason || 'Failed to fill rename input.', '');
        }

        await page.pressKey('Enter');
        await waitForConversationPostcondition(
            page,
            action.selected,
            match => (match?.conversation?.title || '').trim() === title,
            'rename',
        );

        return [{
            status: 'renamed',
            title,
            thread_id: action.selected.threadId,
            project: action.selected.project,
        }];
    },
});
