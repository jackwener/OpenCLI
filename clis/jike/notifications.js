import { cli, Strategy } from '@jackwener/opencli/registry';
// 将通知类型代码映射为中文标签
function resolveActionLabel(type) {
    if (!type)
        return '通知';
    const upper = type.toUpperCase();
    if (upper.includes('LIKE'))
        return '赞了你';
    if (upper.includes('COMMENT'))
        return '评论了你';
    if (upper.includes('FOLLOW'))
        return '关注了你';
    if (upper.includes('REPOST'))
        return '转发了你';
    if (upper.includes('MENTION'))
        return '提到了你';
    if (upper.includes('REPLY'))
        return '回复了你';
    return type;
}
cli({
    site: 'jike',
    name: 'notifications',
    access: 'read',
    description: '即刻通知',
    domain: 'web.okjike.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20 },
    ],
    columns: ['type', 'user', 'content', 'time'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        // 1. 直接导航到通知页
        await page.goto('https://web.okjike.com/notification');
        // 3. 优先用 React fiber 提取通知数据
        //    通知 fiber 数据结构与帖子不同，需查找含 type + user 字段的 props
        const fiberResults = (await page.evaluate(`(() => {
      // 从 React fiber 树中提取通知数据，向上最多走 15 层
      function getNotificationData(element) {
        for (const key of Object.keys(element)) {
          if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
            let fiber = element[key];
            for (let i = 0; i < 15 && fiber; i++) {
              const props = fiber.memoizedProps || fiber.pendingProps;
              if (props && props.data) {
                const d = props.data;
                // 通知条目特征：含 type/actionType 字段，以及来源用户字段
                if (d.type || d.actionType || d.notificationType) return d;
              }
              fiber = fiber.return;
            }
          }
        }
        return null;
      }

      const results = [];
      const seen = new Set();

      // 通知页使用 _item_ 类前缀作为条目容器
      const elements = Array.from(document.querySelectorAll('[class*="_item_"]'));

      for (const el of elements) {
        const data = getNotificationData(el);
        if (!data) continue;

        const actionType = data.actionType || data.type || data.notificationType || '';
        const fromUser =
          (data.sourceUser && data.sourceUser.screenName) ||
          (data.user && data.user.screenName) ||
          (data.actionUser && data.actionUser.screenName) ||
          (data.actor && data.actor.screenName) ||
          '';
        const targetContent =
          (data.targetPost && data.targetPost.content) ||
          (data.post && data.post.content) ||
          '';
        const commentContent =
          (data.comment && data.comment.content) ||
          data.commentContent ||
          '';
        const content = commentContent || targetContent;
        const time = data.createdAt || data.updatedAt || '';

        // 用 user+time+type 去重，避免同一用户同一时间不同类型通知被合并
        const key = fromUser + '\x00' + time + '\x00' + (data.type || data.actionType || '');
        if (seen.has(key)) continue;
        seen.add(key);

        if (!fromUser && !content) continue;

        results.push({ actionType, fromUser, content, time });
      }

      return results;
    })()`));
        // 4. fiber 提取成功，映射类型标签后返回
        if (fiberResults.length > 0) {
            const notifications = fiberResults.map((r) => ({
                type: resolveActionLabel(r.actionType),
                user: r.fromUser,
                content: r.content.replace(/\n/g, ' ').slice(0, 100),
                time: r.time,
            }));
            return notifications.slice(0, limit);
        }
        // 5. 回退：解析通知条目的 innerText（格式: 用户名\n操作描述\n日期）
        await page.autoScroll({ times: Math.ceil(limit / 10), delayMs: 2000 });
        const domResults = (await page.evaluate(`(() => {
      const results = [];
      const items = document.querySelectorAll('[class*="_item_"]');

      // 动作关键词，用于定位通知类型行
      // 长模式优先匹配，避免"赞了你"截断"赞了你的动态"
      const actionPatterns = [
        '赞了你的动态', '赞了你的评论', '赞了你的转发',
        '评论了你的动态', '评论了你的转发',
        '回复了你的评论', '回复了你',
        '转发了你的动态',
        '提到了你', '关注了你',
        '赞了你', '评论了你', '转发了你',
      ];

      for (const item of items) {
        const text = item.innerText || '';
        const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) continue;

        // 策略：在全文中搜索动作关键词来定位类型
        let type = '';
        let user = '';
        let time = '';
        let content = '';

        const fullText = lines.join(' ');
        for (const pattern of actionPatterns) {
          const idx = fullText.indexOf(pattern);
          if (idx >= 0) {
            // 关键词前面是用户名（可能多人用、分隔）
            user = fullText.slice(0, idx).replace(/[、,]/g, ' ').trim();
            type = pattern;
            // 关键词后面可能是时间和原帖内容
            const rest = fullText.slice(idx + pattern.length).trim();
            // 时间通常以数字或"刚刚"/"分钟前"等开头
            const timeMatch = rest.match(/^[\\S]*?(?:刚刚|\\d+.*?前|\\d{4}\\/\\d{2}\\/\\d{2})/);
            time = timeMatch ? timeMatch[0] : '';
            content = rest.slice(time.length).trim().slice(0, 100);
            break;
          }
        }

        // 没匹配到动作关键词，回退到简单行序
        if (!type) {
          user = lines[0] || '';
          type = lines[1] || '';
          time = lines[2] || '';
        }

        if (!user && !type) continue;
        results.push({ type, user, content, time });
      }

      return results;
    })()`));
        return domResults.slice(0, limit);
    },
});
