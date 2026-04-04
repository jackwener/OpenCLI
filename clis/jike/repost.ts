import { cli, Strategy } from '../../registry.js';

/**
 * 转发即刻帖子
 *
 * 操作栏转发按钮点击后弹出 Popover 菜单，
 * 选择"转发动态"后弹出编辑器弹窗（可添加附言），
 * 再点击"发布"确认转发。
 */

cli({
  site: 'jike',
  name: 'repost',
  description: '转发即刻帖子',
  domain: 'web.okjike.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'id', type: 'string', required: true, positional: true, help: '帖子 ID' },
    { name: 'text', positional: true, type: 'string', required: false, help: '转发附言（可选）' },
  ],
  columns: ['status', 'message'],
  func: async (page, kwargs) => {
    await page.goto(`https://web.okjike.com/originalPost/${kwargs.id}`);

    // 1. 点击操作栏中的转发按钮（第三个子元素）
    const clickResult = await page.evaluate(`(async () => {
      try {
        const actions = document.querySelector('[class*="_actions_"]');
        if (!actions) return { ok: false, message: '未找到操作栏' };
        const children = Array.from(actions.children).filter(c => c.offsetHeight > 0);
        if (!children[2]) return { ok: false, message: '未找到转发按钮' };
        // 注意：按位置定位，即刻操作栏顺序变化时需调整
        children[2].click();
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

    if (!clickResult.ok) {
      return [{ status: 'failed', message: clickResult.message }];
    }

    await page.wait(1);

    // 2. 在弹出菜单中点击"转发动态"
    const menuResult = await page.evaluate(`(async () => {
      try {
        const btn = Array.from(document.querySelectorAll('button')).find(
          b => b.textContent?.trim() === '转发动态'
        );
        if (!btn) return { ok: false, message: '未找到"转发动态"菜单项' };
        btn.click();
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

    if (!menuResult.ok) {
      return [{ status: 'failed', message: menuResult.message }];
    }

    await page.wait(2);

    // 3. 若有附言，在弹窗编辑器中填入
    if (kwargs.text) {
      const textResult = await page.evaluate(`(async () => {
        try {
          const textToInsert = ${JSON.stringify(kwargs.text)};
          const editor = document.querySelector('[contenteditable="true"]');
          if (!editor) return { ok: false, message: '未找到附言输入框' };
          editor.focus();
          const dt = new DataTransfer();
          dt.setData('text/plain', textToInsert);
          editor.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dt, bubbles: true, cancelable: true,
          }));
          await new Promise(r => setTimeout(r, 500));
          return { ok: true };
        } catch(e) { return { ok: false, message: '附言写入失败: ' + e.toString() }; }
      })()`);
      if (!textResult.ok) {
        return [{ status: 'failed', message: textResult.message }];
      }
    }

    // 4. 点击"发送"按钮确认转发
    const confirmResult = await page.evaluate(`(async () => {
      try {
        await new Promise(r => setTimeout(r, 500));
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          const text = b.textContent?.trim() || '';
          // 不匹配"转发动态"，避免重复触发 Popover 菜单项
          return (text === '发送' || text === '发布') && !b.disabled;
        });
        if (!btn) return { ok: false, message: '未找到发送按钮' };
        btn.click();
        return { ok: true, message: '转发成功' };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

    if (confirmResult.ok) await page.wait(3);

    return [{
      status: confirmResult.ok ? 'success' : 'failed',
      message: confirmResult.message,
    }];
  },
});
