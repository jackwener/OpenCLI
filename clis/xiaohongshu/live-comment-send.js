/**
 * Xiaohongshu live-comment-send — post one comment into a live room.
 *
 * UI-driving write: focus the room's contenteditable composer, insert the
 * text (verifying the box shows exactly what was requested before anything
 * is clicked), click the send control that appears, then poll a
 * postcondition — the input cleared AND the comment appeared in the
 * structured liveStream.comments store — before reporting success.
 * Navigates with a plain goto so a live-comments watcher on the same warm
 * tab stays alive.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './shared.js';
import { parseRoomUrl } from './live-comments.js';

const MAX_COMMENT_LENGTH = 200;

export function buildSendPrepareJs(text) {
    return `
    (() => {
      const box = document.querySelector('.input-editable');
      if (!box) return { ok: false, reason: 'no_input_box' };
      box.focus();
      const selection = window.getSelection();
      selection.selectAllChildren(box);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      const sendButton = [...document.querySelectorAll('button, [class*="send"]')]
        .find((el) => el.getBoundingClientRect().width > 0 && /发送/.test(el.innerText || ''));
      return { ok: true, content: (box.innerText || '').trim(), sendVisible: Boolean(sendButton) };
    })()
  `;
}

export function buildSendClickJs() {
    return `
    (() => { // __send_click
      const sendButton = [...document.querySelectorAll('button, [class*="send"]')]
        .find((el) => el.getBoundingClientRect().width > 0 && /发送/.test(el.innerText || ''));
      if (!sendButton) return { clicked: false, reason: 'send_button_not_found' };
      sendButton.click();
      return { clicked: true };
    })()
  `;
}

export function buildSendVerifyJs(text) {
    return `
    (() => { // __send_verify
      const box = document.querySelector('.input-editable');
      const cleared = !box || (box.textContent || '').trim() === '';
      // Primary evidence: our own nickname + the exact text rendered in the
      // chat DOM. The store echo is unreliable (the liveStream.comments store
      // freezes after the SSR batch — observed live: real sends "failed"
      // verification while the watcher saw them land in chat).
      const userInfo = window.__INITIAL_STATE__?.user?.userInfo;
      const ownNick = String((userInfo?._value ?? userInfo)?.nickname ?? '').trim();
      const domHit = ownNick !== '' && [...document.querySelectorAll('.virtual-list-item')].some((item) => {
        const nickEl = item.querySelector('.nickname');
        if (!nickEl || (nickEl.textContent || '').trim() !== ownNick) return false;
        const contentEl = item.querySelector('.msg-content') ?? item;
        let msg = '';
        for (const node of contentEl.childNodes) {
          if (node === nickEl || (node.nodeType === 1 && node.contains(nickEl))) continue;
          msg += node.textContent ?? '';
        }
        return msg.replace(/\s+/g, ' ').trim() === ${JSON.stringify(text)};
      });
      // Secondary: the store echo, when it happens, carries the server id.
      const ls = window.__INITIAL_STATE__?.liveStream;
      const raw = ls?.comments?._value ?? ls?.comments;
      const mine = (Array.isArray(raw) ? raw : [])
        .filter((c) => String(c?.msg ?? '') === ${JSON.stringify(text)})
        .map((c) => String(c?.commentId ?? ''))
        .filter(Boolean);
      return { sent: cleared && (domHit || mine.length > 0), cleared, commentId: mine[mine.length - 1] ?? '' };
    })()
  `;
}

function parseCommentText(raw) {
    const text = String(raw ?? '').trim();
    if (!text) {
        throw new ArgumentError('live-comment-send text cannot be empty');
    }
    if (text.length > MAX_COMMENT_LENGTH) {
        throw new ArgumentError(`live-comment-send text must be at most ${MAX_COMMENT_LENGTH} characters`);
    }
    return text;
}

export const command = cli({
    site: 'xiaohongshu',
    name: 'live-comment-send',
    access: 'write',
    description: '在小红书直播间发送一条评论（发送后以输入框清空 + 评论流出现为后置证据）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'room-url', required: true, positional: true, help: 'Room URL from `xiaohongshu lives` (or a bare numeric room id)' },
        { name: 'text', required: true, positional: true, help: `Comment text (max ${MAX_COMMENT_LENGTH} chars)` },
    ],
    columns: ['status', 'room_id', 'msg', 'comment_id'],
    func: async (page, kwargs) => {
        const url = parseRoomUrl(kwargs['room-url']);
        const text = parseCommentText(kwargs.text);
        const roomId = (/\/livestream\/(\d+)/.exec(url) ?? [])[1] ?? '';
        // Plain goto: a warm tab in this room keeps a live-comments watcher
        // (and the composer state) intact.
        await page.goto(url);
        await page.wait({ time: 2 });
        const prepared = unwrapEvaluateResult(await page.evaluate(buildSendPrepareJs(text)));
        if (!prepared || typeof prepared !== 'object' || prepared.ok !== true) {
            throw new CommandExecutionError(`xiaohongshu live-comment-send: comment box unavailable (${String(prepared?.reason ?? 'unknown')})`, 'Log into www.xiaohongshu.com in Chrome and confirm the room is still live.');
        }
        if (String(prepared.content ?? '') !== text) {
            throw new CommandExecutionError(`xiaohongshu live-comment-send: typed content mismatch (expected ${JSON.stringify(text)}, box shows ${JSON.stringify(String(prepared.content ?? ''))}) — refusing to send`, 'The composer may have interfered with the input; retry.');
        }
        const clicked = unwrapEvaluateResult(await page.evaluate(buildSendClickJs()));
        if (!clicked || clicked.clicked !== true) {
            throw new CommandExecutionError(`xiaohongshu live-comment-send: send control not clickable (${String(clicked?.reason ?? 'unknown')})`);
        }
        let verified = null;
        for (let i = 0; i < 5; i += 1) {
            await page.wait({ time: 1 });
            verified = unwrapEvaluateResult(await page.evaluate(buildSendVerifyJs(text)));
            if (verified?.sent === true) break;
        }
        if (verified?.sent !== true) {
            throw new CommandExecutionError('xiaohongshu live-comment-send: send not confirmed — the input did not clear or the comment never appeared in the stream', 'The room may have comment restrictions (fans-only chat, slow mode, or muted account).');
        }
        return [{ status: 'sent', room_id: roomId, msg: text, comment_id: String(verified.commentId ?? '') }];
    },
});

