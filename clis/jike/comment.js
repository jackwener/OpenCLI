import { cli, Strategy } from '@jackwener/opencli/registry';
/**
 * 评论即刻帖子
 *
 * 帖子详情页有评论输入框（contenteditable 或 textarea），
 * 填入文本后点击"回复"或"发布"按钮提交。
 */
cli({
    site: 'jike',
    name: 'comment',
    description: '评论即刻帖子',
    domain: 'web.okjike.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'id', type: 'string', required: true, positional: true, help: '帖子 ID' },
        { name: 'text', type: 'string', required: true, positional: true, help: '评论内容' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        await page.goto(`https://web.okjike.com/originalPost/${kwargs.id}`);
        // 1. 找到评论输入框并填入文本
        const inputResult = await page.evaluate(`(async () => {
      try {
        const textToInsert = ${JSON.stringify(kwargs.text)};

        // 优先在评论区容器内找 contenteditable，避免误选页面其他编辑器；
        // 若评论区 class 名变更则回退到全页查找
        const editor =
          document.querySelector('[class*="_comment_"] [contenteditable="true"]') ||
          document.querySelector('[contenteditable="true"]');
        if (editor) {
          editor.focus();
          const dt = new DataTransfer();
          dt.setData('text/plain', textToInsert);
          editor.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dt, bubbles: true, cancelable: true,
          }));
          await new Promise(r => setTimeout(r, 800));
          if (editor.textContent?.length > 0) {
            return { ok: true, message: 'contenteditable' };
          }
        }

        // 回退：textarea（带评论相关 placeholder）
        const textareas = document.querySelectorAll('textarea');
        for (const ta of textareas) {
          const ph = ta.getAttribute('placeholder') || '';
          if (ph.includes('评论') || ph.includes('回复') || ph.includes('说点什么')) {
            ta.focus();
            const setter = Object.getOwnPropertyDescriptor(
              HTMLTextAreaElement.prototype, 'value'
            )?.set;
            setter?.call(ta, textToInsert);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 500));
            return { ok: true, message: 'textarea' };
          }
        }

        // 兜底：任意 textarea
        if (textareas.length > 0) {
          const ta = textareas[0];
          ta.focus();
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype, 'value'
          )?.set;
          setter?.call(ta, textToInsert);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 500));
          return { ok: true, message: 'textarea-fallback' };
        }

        return { ok: false, message: '未找到评论输入框' };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);
        if (!inputResult.ok) {
            return [{ status: 'failed', message: inputResult.message }];
        }
        // 2. 点击"回复"或"发布"按钮
        const submitResult = await page.evaluate(`(async () => {
      try {
        await new Promise(r => setTimeout(r, 500));
        const btns = Array.from(document.querySelectorAll('button')).filter(btn => {
          const text = btn.textContent?.trim() || '';
          return (text === '回复' || text === '发布' || text === '发送' || text === '评论') && !btn.disabled;
        });
        if (btns.length === 0) {
          return { ok: false, message: '未找到可用的回复按钮（可能因内容为空而禁用）' };
        }
        btns[0].click();
        return { ok: true, message: '评论发布成功' };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);
        if (submitResult.ok)
            await page.wait(3);
        return [{
                status: submitResult.ok ? 'success' : 'failed',
                message: submitResult.message,
            }];
    },
});
