import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export function unwrapEvaluateResult(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

const TAOBAO_CHAT_URL = 'https://market.m.taobao.com/app/im/chat/index.html';

export const command = cli({
  site: 'taobao',
  name: 'sessions',
  access: 'read',
  description: '列出所有淘宝卖家客服聊天会话 (联系人列表、最后消息、未读数)',
  domain: 'market.m.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: false, help: '按卖家店铺名称关键词搜索筛选' },
    { name: 'limit', type: 'int', default: 50, help: '返回最大会话数量 (默认 50, 最大 1000)' },
  ],
  columns: [
    'rank',
    'seller',
    'cid',
    'last_message',
    'last_time',
    'unread',
    'is_seller',
    'modify_time',
  ],
  func: async (page, kwargs) => {
    const query = String(kwargs?.query || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(kwargs?.limit) || 50, 1000));

    // Check if we are already on the chat page
    const currentUrl = await page.evaluate(`location.href`);
    if (!currentUrl.includes('/app/im/chat/')) {
      await page.goto(TAOBAO_CHAT_URL);
      await page.wait?.(3);
    }

    const evalResult = unwrapEvaluateResult(await page.evaluate(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        
        let iframe = document.querySelector('iframe');
        let attempts = 0;
        while (!iframe && attempts < 10) {
          await sleep(500);
          iframe = document.querySelector('iframe');
          attempts++;
        }
        
        if (!iframe) {
          return { ok: false, error: 'no_iframe', message: '未找到淘宝网页旺旺 iframe 容器' };
        }
        
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const win = iframe.contentWindow;
        
        let sdk = win._imsdk;
        attempts = 0;
        while (!sdk && attempts < 10) {
          await sleep(500);
          sdk = win._imsdk;
          attempts++;
        }
        
        if (!sdk) {
          const contactItems = Array.from(doc.querySelectorAll('.conversation-item'));
          if (contactItems.length === 0) {
            return { ok: false, error: 'no_sdk_or_dom', message: '无法获取聊天会话列表，请确认是否已登录淘宝' };
          }
          const results = contactItems.map((item, idx) => {
            const lines = item.innerText.split('\\n').map(s => s.trim()).filter(Boolean);
            return {
              rank: idx + 1,
              seller: lines[0] || '未知卖家',
              cid: item.id || '',
              last_message: lines.slice(2).join(' ') || lines[1] || '',
              last_time: lines[1] || '',
              unread: 0,
              is_seller: true,
              modify_time: Date.now() - idx * 60000,
            };
          });
          return { ok: true, data: results };
        }
        
        try {
          const origin = sdk.getOriginSdk ? sdk.getOriginSdk() : null;
          const convService = sdk.getConversationService ? sdk.getConversationService() : null;
          
          let rawList = [];
          if (convService) {
            try {
              rawList = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => resolve([]), 4000);
                convService.listAllConversation({
                  dataCallback: (res) => { clearTimeout(timer); resolve(res); },
                  errorCallBack: (err) => { clearTimeout(timer); resolve([]); }
                });
              });
            } catch {}
          }
          
          if ((!rawList || rawList.length === 0) && origin?.getConvService) {
            try {
              rawList = await origin.getConvService().listConversations(0, 2000);
            } catch {}
          }
          
          if (!rawList || rawList.length === 0) {
            const contactItems = Array.from(doc.querySelectorAll('.conversation-item'));
            if (contactItems.length > 0) {
              rawList = contactItems.map((item, idx) => {
                const lines = item.innerText.split('\\n').map(s => s.trim()).filter(Boolean);
                return {
                  conversationCode: item.id || '',
                  ext: { target: { dnick: lines[0] || '未知卖家' } },
                  conversationContent: { lastMessageSummary: { content: lines.slice(2).join(' ') || lines[1] || '' } },
                };
              });
            }
          }
          
          const formatted = (rawList || []).map((c, idx) => {
            const content = c.conversationContent || {};
            const ext = c.ext || {};
            const target = ext.target || {};
            const sellerName = target.dnick || content.conversationName || target.snick || '未知店铺';
            const lastMsg = content.lastMessageSummary?.content || c.latestMessage?.summary || '';
            const modifyTime = c.modifyTime || content.lastMessageSummary?.sendTime || 0;
            const timeStr = modifyTime ? new Date(modifyTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
            
            return {
              rank: idx + 1,
              seller: sellerName,
              cid: c.conversationCode || c.cid || '',
              last_message: lastMsg.replace(/\\n/g, ' ').slice(0, 100),
              last_time: timeStr,
              unread: c.unreadCount || content.unReadNumber || 0,
              is_seller: true,
              modify_time: modifyTime,
            };
          });
          
          return { ok: true, data: formatted };
        } catch (err) {
          const errMsg = typeof err === 'object' ? JSON.stringify(err) : String(err);
          return { ok: false, error: 'sdk_call_failed', message: errMsg };
        }
      })()
    `));

    if (!evalResult || evalResult.ok === false) {
      throw new CommandExecutionError(`获取会话列表失败: ${evalResult?.message || evalResult?.error || '未知错误'}`);
    }

    let list = evalResult.data || [];
    if (query) {
      list = list.filter(item => 
        item.seller.toLowerCase().includes(query) || 
        item.last_message.toLowerCase().includes(query) ||
        item.cid.toLowerCase().includes(query)
      );
    }

    list.sort((a, b) => (b.modify_time || 0) - (a.modify_time || 0));

    return list.slice(0, limit).map((item, idx) => ({
      rank: idx + 1,
      seller: item.seller,
      cid: item.cid,
      last_message: item.last_message,
      last_time: item.last_time,
      unread: item.unread,
      is_seller: item.is_seller,
      modify_time: item.modify_time,
    }));
  },
});
