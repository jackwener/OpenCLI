import { cli, Strategy } from '../../registry.js';

/**
 * 点赞即刻帖子
 *
 * 即刻帖子详情页的操作栏是 div 元素（非 button），
 * 点赞按钮可通过 class 前缀 _likeButton_ 定位。
 */

cli({
  site: 'jike',
  name: 'like',
  description: '点赞即刻帖子',
  domain: 'web.okjike.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'id', type: 'string', required: true, positional: true, help: '帖子 ID' },
  ],
  columns: ['status', 'message'],
  func: async (page, kwargs) => {
    // 1. 导航到帖子详情页
    await page.goto(`https://web.okjike.com/originalPost/${kwargs.id}`);

    // 2. 找到点赞按钮并点击
    const result = await page.evaluate(`(async () => {
      try {
        // 点赞按钮：class 包含 _likeButton_，在 _actions_ 容器内
        const likeBtn = document.querySelector('[class*="_likeButton_"]');
        if (!likeBtn) {
          return { ok: false, message: '未找到点赞按钮' };
        }

        // 检查是否已点赞（已赞按钮带有 _liked_ 类）
        const cls = likeBtn.className || '';
        if (cls.includes('_liked')) {
          return { ok: true, message: '该帖子已赞过' };
        }

        // 记录点击前的类名
        const beforeCls = likeBtn.className;

        likeBtn.click();
        await new Promise(r => setTimeout(r, 1500));

        // 验证：类名变化表示点赞成功
        const afterCls = likeBtn.className;
        if (afterCls !== beforeCls) {
          return { ok: true, message: '点赞成功' };
        }

        // 类名未变化，无法确认点赞是否成功
        return { ok: false, message: '点赞状态未确认，请手动检查' };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

    return [{
      status: result.ok ? 'success' : 'failed',
      message: result.message,
    }];
  },
});
