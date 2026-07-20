import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

cli({
  site: 'qwen-studio',
  name: 'chat-list',
  description: '获取 Qwen Studio (chat.qwen.ai) 对话历史列表（最近对话默认 10 条）',
  access: 'read',
  example: 'opencli qwen-studio chat-list --limit 20',
  domain: 'chat.qwen.ai',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: '返回条数 (max 50)' },
  ],
  columns: ['rank', 'id', 'title', 'chatType', 'updatedAt', 'createdAt', 'pinned'],
  func: async (page, args) => {
    const limit = Number(args.limit ?? 10);
    if (!Number.isInteger(limit) || limit <= 0) throw new ArgumentError('limit must be a positive integer');
    if (limit > 50) throw new ArgumentError('limit must be <= 50');

    // Ensure we're on chat.qwen.ai before making same-origin fetch
    const currentUrl = await page.evaluate(() => window.location.href).catch(() => '');
    if (!currentUrl.includes('chat.qwen.ai')) {
      await page.goto('https://chat.qwen.ai/');
      await page.wait(2);
    }

    let data;
    try {
      const body = await page.evaluate(async (maxRows) => {
        const resp = await fetch('https://chat.qwen.ai/api/v2/chats/?page=1&exclude_project=true');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const j = await resp.json();
        return j?.data?.slice(0, maxRows) ?? [];
      }, limit);
      data = body;
    } catch (error) {
      const msg = error?.message || String(error);
      if (msg.includes('HTTP 401') || msg.includes('HTTP 403') || msg.includes('401') || msg.includes('403')) {
        throw new AuthRequiredError('chat.qwen.ai', 'Session expired. Please log into chat.qwen.ai in your browser.');
      }
      throw new CommandExecutionError(`Qwen Studio chat list request failed: ${msg}`);
    }

    if (!Array.isArray(data) || data.length === 0) {
      throw new EmptyResultError('qwen-studio chat-list', 'No conversations found');
    }

    return data.map((item, i) => ({
      rank: i + 1,
      id: item.id,
      title: item.title,
      chatType: item.chat_type,
      updatedAt: item.updated_at,
      createdAt: item.created_at,
      pinned: item.pinned,
    }));
  },
});