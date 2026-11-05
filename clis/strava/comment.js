import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cleanText, normalizeActivityId, requireExecute } from './utils.js';
// ── strava comments (read) ──────────────────────────────────────────────
//
// The ADP comment list is lazy-loaded into a modal, so we open it
// ([data-testid="open_comment_modal_button"]) and scrape the rendered comment
// entries ([data-testid="entry"][data-comment-id]).
cli({
    site: 'strava',
    name: 'comments',
    access: 'read',
    description: 'Comments on a Strava activity',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'activity', type: 'str', positional: true, required: true, help: 'Activity ID or activity URL' },
        { name: 'limit', type: 'int', default: 30, help: 'Number of comments' },
    ],
    columns: ['rank', 'comment_id', 'author', 'athlete_id', 'text', 'time'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 30;
        const id = normalizeActivityId(kwargs.activity);
        if (!id)
            throw new EmptyResultError('strava comments', `Could not parse an activity id from "${kwargs.activity}".`);
        await page.goto(`https://www.strava.com/activities/${id}`);
        await page.wait(2);
        const opened = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      const n = document.querySelector('[data-react-class="ADPKudosAndComments"]');
      let count = null;
      if (n) { try { count = JSON.parse(n.getAttribute('data-react-props') || '{}').commentsCount; } catch (e) {} }
      const b = document.querySelector('[data-testid="open_comment_modal_button"]');
      if (b) b.click();
      return { count, opened: !!b };
    })()`);
        if (opened && opened.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        if (opened && opened.count === 0)
            throw new EmptyResultError('strava comments', 'This activity has no comments.');
        await page.wait(2);
        const raw = await page.evaluate(`(() => {
      return [...document.querySelectorAll('[data-testid="entry"][data-comment-id]')].map((e) => {
        const img = e.querySelector('img');
        const authorLink = e.querySelector('a[href*="/athletes/"]');
        const author = (img && (img.getAttribute('title') || img.getAttribute('alt'))) || (authorLink ? authorLink.textContent.replace(/\\s+/g, ' ').trim() : '');
        const href = authorLink ? authorLink.getAttribute('href') : '';
        const timeEl = e.querySelector('time');
        const time = timeEl ? timeEl.textContent.replace(/\\s+/g, ' ').trim() : '';
        // Comment body = entry minus the author link, timestamp, avatar and control buttons.
        const clone = e.cloneNode(true);
        clone.querySelectorAll('a[href*="/athletes/"], time, button, [data-testid="avatar"], [data-testid="avatar-wrapper"]').forEach((n) => n.remove());
        const text = clone.textContent.replace(/\\s+/g, ' ').trim();
        return { commentId: e.getAttribute('data-comment-id'), author, href, time, text };
      });
    })()`);
        if (!Array.isArray(raw) || raw.length === 0)
            throw new EmptyResultError('strava comments', 'This activity has no comments (or the page structure changed).');
        return raw.slice(0, limit).map((item, index) => {
            const athleteId = (item.href || '').match(/\/athletes\/(\d+)/);
            return {
                rank: index + 1,
                comment_id: item.commentId || '',
                author: cleanText(item.author, 60),
                athlete_id: athleteId ? athleteId[1] : '',
                text: cleanText(item.text, 200),
                time: item.time || '',
            };
        });
    },
});
// ── strava comment (write) ──────────────────────────────────────────────
//
// Posts a comment via the ADP comment modal: open modal, fill the textarea
// (React-controlled, so we use the native value setter + an input event), then
// click [data-testid="post-comment-btn"]. Guarded by --execute.
cli({
    site: 'strava',
    name: 'comment',
    access: 'write',
    description: 'Comment on a Strava activity (requires --execute)',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'activity', type: 'str', positional: true, required: true, help: 'Activity ID or activity URL' },
        { name: 'text', type: 'str', positional: true, required: true, help: 'Comment text (@ to mention)' },
        { name: 'execute', type: 'boolean', default: false, help: 'Actually post the comment (otherwise refuses)' },
    ],
    columns: ['status', 'message', 'activity_id', 'comment_text'],
    func: async (page, kwargs) => {
        requireExecute(kwargs, 'comment on this activity');
        const id = normalizeActivityId(kwargs.activity);
        if (!id)
            throw new EmptyResultError('strava comment', `Could not parse an activity id from "${kwargs.activity}".`);
        const text = String(kwargs.text || '');
        if (!text.trim())
            throw new CommandExecutionError('Comment text is empty.');
        await page.goto(`https://www.strava.com/activities/${id}`);
        await page.wait(3);
        const open = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      const b = document.querySelector('[data-testid="open_comment_modal_button"]');
      if (!b) return { ok: false };
      b.click();
      return { ok: true };
    })()`);
        if (open && open.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        if (!open || !open.ok)
            throw new CommandExecutionError('Could not open the comment box.');
        await page.wait(2);
        const filled = await page.evaluate(`(() => {
      const ta = document.querySelector('textarea');
      if (!ta) return { ok: false, message: 'Comment textarea not found' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, value: ta.value };
    })()`);
        if (!filled || !filled.ok)
            throw new CommandExecutionError((filled && filled.message) || 'Could not fill the comment box.');
        await page.wait(1);
        const posted = await page.evaluate(`(() => {
      const b = document.querySelector('[data-testid="post-comment-btn"]');
      if (!b) return { ok: false, message: 'Post button not found' };
      if (b.disabled) return { ok: false, message: 'Post button is disabled (empty comment?)' };
      b.click();
      return { ok: true };
    })()`);
        if (!posted || !posted.ok)
            return [{ status: 'failed', message: posted ? posted.message : 'Could not click Post', activity_id: id, comment_text: text }];
        await page.wait(2);
        return [{ status: 'success', message: 'Comment posted', activity_id: id, comment_text: text }];
    },
});
// ── strava comment-delete (write) ───────────────────────────────────────
//
// Deletes one of your comments: open the modal, find the entry by data-comment-id,
// click its [data-testid="delete-comment-btn"], then the confirm
// [data-testid="confirm-delete-comment-btn"]. Guarded by --execute.
cli({
    site: 'strava',
    name: 'comment-delete',
    access: 'write',
    description: 'Delete one of your comments on a Strava activity (requires --execute)',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'activity', type: 'str', positional: true, required: true, help: 'Activity ID or activity URL' },
        { name: 'comment-id', type: 'str', positional: true, required: true, help: 'Comment ID (from `strava comments`)' },
        { name: 'execute', type: 'boolean', default: false, help: 'Actually delete the comment (otherwise refuses)' },
    ],
    columns: ['status', 'message', 'activity_id', 'comment_id'],
    func: async (page, kwargs) => {
        requireExecute(kwargs, 'delete this comment');
        const id = normalizeActivityId(kwargs.activity);
        const commentId = String(kwargs['comment-id'] || '').match(/(\d+)/)?.[1] || '';
        if (!id || !commentId)
            throw new EmptyResultError('strava comment-delete', 'Need a valid activity id and comment id.');
        await page.goto(`https://www.strava.com/activities/${id}`);
        await page.wait(2);
        const open = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      const b = document.querySelector('[data-testid="open_comment_modal_button"]');
      if (b) b.click();
      return { ok: !!b };
    })()`);
        if (open && open.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        await page.wait(3);
        const del = await page.evaluate(`(() => {
      const entry = document.querySelector('[data-testid="entry"][data-comment-id="${commentId}"]');
      if (!entry) return { ok: false, message: 'Comment not found (only your own comments are deletable)' };
      const btn = entry.querySelector('[data-testid="delete-comment-btn"]');
      if (!btn) return { ok: false, message: 'Delete control not found for this comment' };
      btn.click();
      return { ok: true };
    })()`);
        if (!del || !del.ok)
            return [{ status: 'failed', message: del ? del.message : 'Delete failed', activity_id: id, comment_id: commentId }];
        await page.wait(2);
        const confirmed = await page.evaluate(`(() => {
      const c = document.querySelector('[data-testid="confirm-delete-comment-btn"]');
      if (!c) return { ok: false };
      c.click();
      return { ok: true };
    })()`);
        if (!confirmed || !confirmed.ok)
            return [{ status: 'failed', message: 'Delete confirmation dialog did not appear', activity_id: id, comment_id: commentId }];
        await page.wait(3);
        const gone = await page.evaluate(`(() => !document.querySelector('[data-testid="entry"][data-comment-id="${commentId}"]'))()`);
        return [{
                status: gone ? 'success' : 'failed',
                message: gone ? 'Comment deleted' : 'Comment may not have been deleted',
                activity_id: id,
                comment_id: commentId,
            }];
    },
});
