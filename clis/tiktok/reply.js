/**
 * TikTok reply — reply to a specific comment on a video via UI automation.
 */
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'tiktok',
    name: 'reply',
    access: 'write',
    description: 'Reply to a specific TikTok comment',
    domain: 'www.tiktok.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'url', type: 'string', required: true, positional: true, help: 'TikTok video URL' },
        { name: 'comment-id', type: 'string', required: true, positional: true, help: 'Comment ID (cid from get-comments output)' },
        { name: 'text', type: 'string', required: true, positional: true, help: 'Reply text' },
        { name: 'comment-text', type: 'string', help: 'Comment text for fuzzy matching if ID fails' },
        { name: 'comment-author', type: 'string', help: 'Comment author for fuzzy matching if ID fails' },
    ],
    columns: ['status', 'message', 'comment_id', 'text'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required');

        const videoUrl = String(kwargs.url);
        const commentId = String(kwargs['comment-id']);
        const text = String(kwargs.text);
        const commentText = String(kwargs['comment-text'] || '');
        const commentAuthor = String(kwargs['comment-author'] || '');

        await page.goto(videoUrl, { waitUntil: 'load', settleMs: 6000 });
        await page.evaluate(`new Promise((resolve) => {
          const started = Date.now();
          const tick = () => {
            if (document.querySelector('[data-e2e="comment-icon"]') || Date.now() - started > 10000) resolve(true);
            else setTimeout(tick, 250);
          };
          tick();
        })`);
        await page.click('[data-e2e="comment-icon"]').catch(() => undefined);
        await page.evaluate(`new Promise(resolve => setTimeout(resolve, 2500))`);
        const result = await page.evaluate(`(async () => {
      try {
        const commentId = ${JSON.stringify(commentId)};
        const replyText = ${JSON.stringify(text)};
        const fuzzyText = ${JSON.stringify(commentText)};
        const fuzzyAuthor = ${JSON.stringify(commentAuthor)};
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const hasCaptcha = () => {
          const bodyText = document.body?.innerText || '';
          return Boolean(document.querySelector('[data-e2e="captcha"], .captcha-mask, .secsdk-captcha-wrapper'))
            || /captcha|verify to continue|verification|将拼图滑块|验证码|安全验证/i.test(bodyText);
        };
        const waitFor = async (predicate, timeoutMs) => {
          const started = Date.now();
          while (Date.now() - started < timeoutMs) {
            if (predicate()) return true;
            await wait(250);
          }
          return false;
        };
        const collectCommentRoots = () => Array.from(document.querySelectorAll([
          '[data-e2e="comment-level-1"]',
          '[data-e2e^="comment-level-"]',
          '[data-e2e="search-comment-container"]',
          '[data-e2e*="comment-item"]',
          '[class*="CommentItem"]',
        ].join(',')));

        if (hasCaptcha()) {
          return { ok: false, code: 'CAPTCHA_REQUIRED', message: 'TikTok requires captcha verification before comments can be loaded' };
        }

        const commentIcon = document.querySelector('[data-e2e="comment-icon"]');
        if (commentIcon) {
          const cBtn = commentIcon.closest('button') || commentIcon.closest('[role="button"]') || commentIcon;
          cBtn.click();
          await waitFor(() => collectCommentRoots().length > 0 || hasCaptcha(), 10000);
        }

        if (hasCaptcha()) {
          return { ok: false, code: 'CAPTCHA_REQUIRED', message: 'TikTok requires captcha verification before comments can be loaded' };
        }

        const commentSpans = collectCommentRoots();
        let targetContainer = null;
        for (var ci = 0; ci < commentSpans.length; ci++) {
          var container = commentSpans[ci].closest('[data-e2e*="comment"], [class*="Comment"], li, div') || commentSpans[ci].parentElement;
          if (!container) continue;
          var toCheck = [container].concat(Array.from(container.querySelectorAll('*')).slice(0, 30));
          for (var j = 0; j < toCheck.length; j++) {
            var attrs = Array.from(toCheck[j].attributes || []);
            for (var k = 0; k < attrs.length; k++) {
              if (String(attrs[k].value).includes(commentId)) {
                targetContainer = container;
                break;
              }
            }
            if (targetContainer) break;
          }
          if (targetContainer) break;
        }

        if (!targetContainer) {
          var needle = (fuzzyText || '').substring(0, 80).toLowerCase();
          for (var ti = 0; ti < commentSpans.length; ti++) {
            var fuzzyContainer = commentSpans[ti].parentElement;
            if (!fuzzyContainer) continue;
            var containerText = (fuzzyContainer.innerText || '').toLowerCase();
            if ((needle && containerText.includes(needle)) || (fuzzyAuthor && containerText.includes(fuzzyAuthor.toLowerCase()))) {
              targetContainer = fuzzyContainer;
              break;
            }
          }
        }

        if (!targetContainer) {
          return { ok: false, message: 'Could not find comment with ID ' + commentId + ' in the DOM. Try --comment-text or --comment-author for fuzzy matching. Found ' + commentSpans.length + ' comments.' };
        }

        var replyBtn = targetContainer.querySelector('[data-e2e="comment-reply-1"]')
          || targetContainer.querySelector('[data-e2e*="reply"]');
        if (!replyBtn) {
          var allEls = targetContainer.querySelectorAll('span, p, button, [role="button"]');
          for (var ri = 0; ri < allEls.length; ri++) {
            var t = (allEls[ri].textContent || '').trim();
            if (t === 'Reply' || t === '回复' || t === '回覆') {
              replyBtn = allEls[ri];
              break;
            }
          }
        }
        if (!replyBtn) return { ok: false, message: 'Reply button not found on comment' };

        replyBtn.click();
        await wait(1500);
        const input = document.querySelector('[data-e2e="comment-input"] [contenteditable="true"]')
          || document.querySelector('[contenteditable="true"]');
        if (!input) return { ok: false, message: 'Reply input not found — make sure you are logged in' };

        input.focus();
        document.execCommand('insertText', false, replyText);
        await wait(1000);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await wait(500);
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await wait(3000);

        const composerRoot = input.closest('[data-e2e="comment-input"]') || input.parentElement || document;
        const btns = Array.from(composerRoot.querySelectorAll('[data-e2e="comment-post"], button'));
        const postBtn = btns.find(function(b) {
          var t = (b.textContent || '').trim();
          return b.getAttribute('data-e2e') === 'comment-post' || t === 'Post' || t === '发布' || t === '发送';
        });
        if (postBtn) {
          postBtn.click();
          await wait(3000);
        }
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
