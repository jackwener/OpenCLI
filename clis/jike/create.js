import { cli, Strategy } from '@jackwener/opencli/registry';
/**
 * 发布即刻动态
 *
 * 即刻首页 /following 顶部有内联发帖框（"分享你的想法..."），
 * 直接在其中输入文本，点击"发送"按钮即可发布。
 */
cli({
    site: 'jike',
    name: 'create',
    description: '发布即刻动态',
    domain: 'web.okjike.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', type: 'string', required: true, positional: true, help: '动态正文内容' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        // 1. 导航到首页（有内联发帖框）
        await page.goto('https://web.okjike.com');
        // 2. 在发帖框中输入文本
        const textResult = await page.evaluate(`(async () => {
      try {
        const textToInsert = ${JSON.stringify(kwargs.text)};

        // 首页发帖框在 _postForm_ 容器内，查找其中的 contenteditable
        const form = document.querySelector('[class*="_postForm_"]');
        const editor = form
          ? form.querySelector('[contenteditable="true"]')
          : document.querySelector('[contenteditable="true"]');

        if (editor) {
          editor.focus();
          // 用 ClipboardEvent paste 触发 React 状态更新
          const dt = new DataTransfer();
          dt.setData('text/plain', textToInsert);
          editor.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dt, bubbles: true, cancelable: true,
          }));
          await new Promise(r => setTimeout(r, 800));

          // 检查是否成功插入
          const inserted = editor.textContent || '';
          if (inserted.length > 0) {
            return { ok: true, message: 'contenteditable' };
          }
        }

        // 回退：textarea
        const textarea = form
          ? form.querySelector('textarea')
          : document.querySelector('textarea');

        if (textarea) {
          textarea.focus();
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype, 'value'
          )?.set;
          setter?.call(textarea, textToInsert);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 500));
          return { ok: true, message: 'textarea' };
        }

        return { ok: false, message: '未找到发帖输入框' };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);
        if (!textResult.ok) {
            return [{ status: 'failed', message: textResult.message }];
        }
        // 3. 点击"发送"按钮
        const submitResult = await page.evaluate(`(async () => {
      try {
        await new Promise(r => setTimeout(r, 500));

        // 即刻首页发帖框的按钮文字为"发送"
        const candidates = [
          ...Array.from(document.querySelectorAll('button')).filter(btn => {
            const text = btn.textContent?.trim() || '';
            return text === '发送' || text === '发布';
          }),
        ].filter(el => el && !el.disabled);

        if (candidates.length === 0) {
          return { ok: false, message: '未找到可用的发送按钮（按钮可能因内容为空而禁用）' };
        }

        candidates[0].click();
        return { ok: true, message: '动态发布成功' };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);
        if (submitResult.ok) {
            await page.wait(3);
        }
        return [{
                status: submitResult.ok ? 'success' : 'failed',
                message: submitResult.message,
            }];
    },
});
