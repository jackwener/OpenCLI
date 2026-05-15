/**
 * Xiaohongshu reply — reply to a note comment via UI automation.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { buildNoteUrl } from './note-helpers.js';

cli({
    site: 'xiaohongshu',
    name: 'reply',
    access: 'write',
    description: '回复小红书笔记评论',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'note-id', required: true, positional: true, help: 'Note ID or full URL' },
        { name: 'comment-id', required: true, positional: true, help: 'Comment ID from xiaohongshu comments output' },
        { name: 'text', required: true, positional: true, help: 'Reply text' },
        { name: 'comment-text', type: 'string', help: 'Comment text for fuzzy matching if ID fails' },
        { name: 'comment-author', type: 'string', help: 'Comment author for fuzzy matching if ID fails' },
    ],
    columns: ['status', 'message', 'comment_id', 'text'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required');

        const raw = String(kwargs['note-id']);
        const commentId = String(kwargs['comment-id']);
        const text = String(kwargs.text);
        const commentText = String(kwargs['comment-text'] || '');
        const commentAuthor = String(kwargs['comment-author'] || '');

        await page.goto(buildNoteUrl(raw, { commandName: 'xiaohongshu reply' }));
        await page.wait(5);
        await page.evaluate(`(async () => {
      var scroller = document.querySelector('.note-scroller') || document.querySelector('.container');
      if (scroller) {
        for (var i = 0; i < 3; i++) {
          scroller.scrollTo(0, scroller.scrollHeight);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    })()`);

        const result = await page.evaluate(`(async () => {
      try {
        var commentId = ${JSON.stringify(commentId)};
        var replyText = ${JSON.stringify(text)};
        var fuzzyText = ${JSON.stringify(commentText)};
        var fuzzyAuthor = ${JSON.stringify(commentAuthor)};
        var wait = (ms) => new Promise(r => setTimeout(r, ms));
        var parents = document.querySelectorAll('.parent-comment');
        var targetComment = null;

        for (var i = 0; i < parents.length; i++) {
          var p = parents[i];
          var toCheck = [p].concat(Array.from(p.querySelectorAll('*')).slice(0, 30));
          for (var j = 0; j < toCheck.length; j++) {
            var attrs = Array.from(toCheck[j].attributes || []);
            for (var k = 0; k < attrs.length; k++) {
              if (String(attrs[k].value).includes(commentId)) {
                targetComment = p;
                break;
              }
            }
            if (targetComment) break;
          }
          if (targetComment) break;
        }

        if (!targetComment && fuzzyText && fuzzyText.length > 3) {
          var needle = fuzzyText.substring(0, 80).toLowerCase();
          for (var ti = 0; ti < parents.length; ti++) {
            if ((parents[ti].innerText || '').toLowerCase().includes(needle)) {
              targetComment = parents[ti];
              break;
            }
          }
        }

        if (!targetComment && fuzzyAuthor && fuzzyAuthor.length > 1) {
          var authorNeedle = fuzzyAuthor.toLowerCase();
          for (var ai = 0; ai < parents.length; ai++) {
            if ((parents[ai].innerText || '').toLowerCase().includes(authorNeedle)) {
              targetComment = parents[ai];
              break;
            }
          }
        }

        if (!targetComment) {
          return { ok: false, message: 'Could not find comment ' + commentId + '. Try --comment-text or --comment-author. Found ' + parents.length + ' comments.' };
        }

        var replyBtns = targetComment.querySelectorAll('span, button, [role="button"], div');
        var replyBtn = null;
        for (var ri = 0; ri < replyBtns.length; ri++) {
          var t = (replyBtns[ri].textContent || '').trim();
          if (t === '回复' || t === 'Reply' || t === '回覆') {
            replyBtn = replyBtns[ri];
            break;
          }
        }

        if (replyBtn) {
          replyBtn.click();
          await wait(1000);
        } else {
          var commentItem = targetComment.querySelector('.comment-item');
          if (commentItem) {
            commentItem.click();
            await wait(1000);
          }
        }

        var input = document.querySelector('[contenteditable="true"][data-placeholder*="回复"]')
          || document.querySelector('[contenteditable="true"]')
          || document.querySelector('textarea[placeholder*="回复"]')
          || document.querySelector('textarea');
        if (!input) return { ok: false, message: 'Reply input not found — make sure you are logged in' };

        input.focus();
        await wait(300);
        if (!document.execCommand('insertText', false, replyText)) {
          var dt = new DataTransfer();
          dt.setData('text/plain', replyText);
          input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }
        await wait(1000);

        var submitBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
        var submitBtn = submitBtns.find(function(b) {
          var t = (b.textContent || '').trim();
          return (t === '发送' || t === '回复' || t === 'Send' || t === 'Post') && !b.disabled;
        });
        if (!submitBtn) {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          await wait(3000);
          return { ok: true, message: 'Reply submitted via Enter key on comment ' + commentId };
        }

        submitBtn.click();
        await wait(3000);
        return { ok: true, message: 'Reply posted on comment ' + commentId };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

        return [{
            status: result.ok ? 'success' : 'failed',
            message: result.message,
            comment_id: commentId,
            text,
        }];
    },
});
