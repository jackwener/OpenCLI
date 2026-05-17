/**
 * Xiaohongshu delete-note: remove a published note via creator center UI.
 *
 * Flow:
 *   1. Navigate to creator note-manager
 *   2. Switch to "已发布" tab (delete is only available on published notes;
 *      "审核中" and "未通过" rows do not expose a web delete entry, only mobile)
 *   3. Locate the row whose `data-impression` JSON contains the target noteId
 *   4. Click the inline `<span class="control data-del">` action
 *   5. Click "确定" in the `.d-modal-footer` confirmation modal
 *   6. Poll for the row disappearing from the list
 *
 * Requires: logged into creator.xiaohongshu.com in Chrome.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
const NOTE_MANAGER_URL = 'https://creator.xiaohongshu.com/new/note-manager';
const ROW_SETTLE_MS = 3000;
const MODAL_SETTLE_MS = 2000;
const VERIFY_TIMEOUT_MS = 10_000;
const VERIFY_POLL_MS = 1000;
cli({
    site: 'xiaohongshu',
    name: 'delete-note',
    access: 'write',
    description: '删除小红书已发布笔记 (creator center UI automation)',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        {
            name: 'note-id',
            required: true,
            positional: true,
            help: 'Note ID (e.g. 6a08ba0b000000000702a893 from xiaohongshu creator-notes / URL)',
        },
    ],
    columns: ['status', 'note_id'],
    func: async (page, kwargs) => {
        const noteId = String(kwargs['note-id'] ?? '').trim();
        if (!noteId) {
            throw new ArgumentError('xiaohongshu/delete-note: note-id cannot be empty');
        }
        await page.goto(NOTE_MANAGER_URL);
        await page.wait({ time: ROW_SETTLE_MS / 1000 });
        // Detect login redirect (creator.xiaohongshu.com bounces to /login on auth failure)
        const currentUrl = await page.evaluate('() => location.href');
        if (typeof currentUrl === 'string' && /\/login(\?|$)/i.test(currentUrl)) {
            throw new AuthRequiredError('creator.xiaohongshu.com');
        }
        // Step 1: ensure 已发布 tab is active (delete only exposed there).
        const tabClicked = await page.evaluate(`
      () => {
        const isVisible = (el) => !!el && el.offsetParent !== null;
        for (const el of document.querySelectorAll('a, button, [role="tab"], div')) {
          const text = (el.innerText || el.textContent || '').trim();
          if (text === '已发布' && isVisible(el)) {
            el.click();
            return true;
          }
        }
        return false;
      }
    `);
        if (!tabClicked) {
            throw new CommandExecutionError('xiaohongshu/delete-note: 已发布 tab not found on note-manager; xhs creator UI may have changed.');
        }
        await page.wait({ time: ROW_SETTLE_MS / 1000 });
        // Step 2: locate the .note row whose data-impression JSON carries the
        // exact `noteId` field, and click its `<span class="control data-del">`
        // action. Substring matching on the raw attribute would risk matching
        // unrelated fields whose values happen to share the noteId prefix, so
        // parse the JSON and compare `noteTarget.value.noteId` explicitly.
        const initResult = await page.evaluate(`
      (targetId => {
        const isVisible = (el) => !!el && el.offsetParent !== null;
        const matchesNoteId = (impressionRaw) => {
          if (!impressionRaw) return false;
          try {
            const parsed = JSON.parse(impressionRaw);
            const id = parsed && parsed.noteTarget && parsed.noteTarget.value && parsed.noteTarget.value.noteId;
            return typeof id === 'string' && id === targetId;
          } catch {
            return false;
          }
        };
        const notes = Array.from(document.querySelectorAll('.note')).filter(isVisible);
        for (const note of notes) {
          if (matchesNoteId(note.getAttribute('data-impression'))) {
            const del = note.querySelector('span.control.data-del');
            if (!del || !isVisible(del)) {
              return { ok: false, kind: 'no_delete_action', visibleRows: notes.length };
            }
            del.click();
            return { ok: true };
          }
        }
        return { ok: false, kind: 'not_found', visibleRows: notes.length };
      })(${JSON.stringify(noteId)})
    `);
        if (!initResult?.ok) {
            if (initResult?.kind === 'not_found') {
                throw new EmptyResultError('xiaohongshu/delete-note', `Note ${noteId} not visible in the 已发布 tab. Verify the note belongs to the logged-in account and has cleared review (审核中 / 未通过 rows have no web delete entry).`);
            }
            if (initResult?.kind === 'no_delete_action') {
                throw new CommandExecutionError(`xiaohongshu/delete-note: note ${noteId} row found but no delete action visible; xhs creator UI may have changed.`);
            }
            throw new CommandExecutionError('xiaohongshu/delete-note: failed to locate note row');
        }
        await page.wait({ time: MODAL_SETTLE_MS / 1000 });
        // Step 3: click "确定" in the `.d-modal-footer` confirmation modal.
        const confirmResult = await page.evaluate(`
      () => {
        const isVisible = (el) => !!el && el.offsetParent !== null;
        const footer = Array.from(document.querySelectorAll('.d-modal-footer')).find(isVisible);
        if (!footer) return { ok: false, kind: 'no_modal' };
        const buttons = Array.from(footer.querySelectorAll('button, [role="button"]')).filter(isVisible);
        const confirmBtn = buttons.find((b) => (b.innerText || b.textContent || '').trim() === '确定');
        if (!confirmBtn) return { ok: false, kind: 'no_confirm', labels: buttons.map(b => (b.innerText || '').trim()) };
        confirmBtn.click();
        return { ok: true };
      }
    `);
        if (!confirmResult?.ok) {
            throw new CommandExecutionError(`xiaohongshu delete-note: confirmation modal step failed (${confirmResult?.kind ?? 'unknown'})`);
        }
        // Step 4: poll for row removal (proves the delete actually committed,
        // not just the modal was clicked). Iteration-bounded rather than
        // wall-clock so tests with a mocked `page.wait` exhaust the loop
        // quickly instead of stalling on real time.
        const VERIFY_ITERATIONS = Math.ceil(VERIFY_TIMEOUT_MS / VERIFY_POLL_MS);
        let stillPresent = true;
        for (let i = 0; i < VERIFY_ITERATIONS; i++) {
            await page.wait({ time: VERIFY_POLL_MS / 1000 });
            const probe = await page.evaluate(`
        (targetId => {
          const matchesNoteId = (impressionRaw) => {
            if (!impressionRaw) return false;
            try {
              const parsed = JSON.parse(impressionRaw);
              const id = parsed && parsed.noteTarget && parsed.noteTarget.value && parsed.noteTarget.value.noteId;
              return typeof id === 'string' && id === targetId;
            } catch {
              return false;
            }
          };
          const notes = Array.from(document.querySelectorAll('.note'));
          return notes.some((n) => matchesNoteId(n.getAttribute('data-impression')));
        })(${JSON.stringify(noteId)})
      `);
            if (probe === false) {
                stillPresent = false;
                break;
            }
        }
        if (stillPresent) {
            throw new CommandExecutionError(`xiaohongshu/delete-note: note ${noteId} still visible after confirm click; deletion may not have committed.`);
        }
        return [{ status: 'deleted', note_id: noteId }];
    },
});
