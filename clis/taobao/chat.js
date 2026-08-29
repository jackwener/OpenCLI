import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export function unwrapEvaluateResult(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

const TAOBAO_CHAT_URL = 'https://market.m.taobao.com/app/im/chat/index.html';

export const command = cli({
  site: 'taobao',
  name: 'chat',
  access: 'read',
  description: '获取与指定淘宝卖家的完整历史聊天记录 (支持店铺名称或CID搜索，自动多轮分页逆向拉取全部消息)',
  domain: 'market.m.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'seller', positional: true, required: true, help: '卖家店铺名称或会话CID (例如: 郭氏永盛旗舰店 或 1779237934.1-...)' },
    { name: 'limit', type: 'int', default: 100, help: '拉取最大消息条数 (默认 100, 最大 5000)' },
    { name: 'all', type: 'bool', default: false, help: '是否拉取该店铺全部历史消息' },
    { name: 'order', type: 'str', default: 'asc', help: '排序方式: asc (正序/时间先后) 或 desc (倒序/最新在前)' },
  ],
  columns: [
    'index',
    'id',
    'create_at',
    'time',
    'sender_role',
    'sender_nick',
    'type',
    'content',
    'attachment_url',
  ],
  func: async (page, kwargs) => {
    const sellerQuery = String(kwargs?.seller || '').trim();
    if (!sellerQuery) {
      throw new ArgumentError('请指定要查询的卖家店铺名称或会话 CID');
    }

    const isAll = Boolean(kwargs?.all);
    const limit = isAll ? 5000 : Math.max(1, Math.min(Number(kwargs?.limit) || 100, 5000));
    const order = String(kwargs?.order || 'asc').toLowerCase();

    // Check if we are already on the chat page
    const currentUrl = await page.evaluate(`location.href`);
    if (!currentUrl.includes('/app/im/chat/')) {
      await page.goto(TAOBAO_CHAT_URL);
      await page.wait?.(3);
    }

    const evalResult = unwrapEvaluateResult(await page.evaluate(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const sellerQuery = ${JSON.stringify(sellerQuery)};
        const targetLimit = ${Number(limit)};
        
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
        
        const win = iframe.contentWindow;
        let sdk = win._imsdk;
        attempts = 0;
        while (!sdk && attempts < 10) {
          await sleep(500);
          sdk = win._imsdk;
          attempts++;
        }
        
        if (!sdk) {
          return { ok: false, error: 'no_sdk', message: 'IM SDK 初始化未就绪' };
        }
        
        const origin = sdk.getOriginSdk ? sdk.getOriginSdk() : null;
        const convService = sdk.getConversationService ? sdk.getConversationService() : null;
        const msgService = origin?.getMsgService ? origin.getMsgService() : null;
        
        if (!msgService) {
          return { ok: false, error: 'no_msg_service', message: '未能获取 MsgService 实例' };
        }
        
        // 1. Resolve target CID
        let matchedCid = '';
        let matchedSellerName = '';
        
        if (sellerQuery.includes('@cntaobao') || sellerQuery.includes('#11001')) {
          matchedCid = sellerQuery;
        } else {
          // Find in conversation list
          let allConvs = [];
          if (convService) {
            allConvs = await new Promise((resolve, reject) => {
              convService.listAllConversation({
                dataCallback: resolve,
                errorCallBack: reject
              });
            });
          } else if (origin?.getConvService) {
            allConvs = await origin.getConvService().listConversations(0, 2000);
          }

          const queryLower = sellerQuery.toLowerCase();
          const found = (allConvs || []).find(c => {
            const ext = c.ext || {};
            const target = ext.target || {};
            const content = c.conversationContent || {};
            const name = target.dnick || content.conversationName || target.snick || '';
            const cid = c.conversationCode || c.cid || '';
            return name.toLowerCase().includes(queryLower) || 
                   cid.toLowerCase().includes(queryLower);
          });
          
          if (!found) {
            return {
              ok: false,
              error: 'seller_not_found',
              message: '未在会话列表中找到匹配的卖家店铺: ' + sellerQuery
            };
          }
          
          matchedCid = found.conversationCode || found.cid;
          const ext = found.ext || {};
          const target = ext.target || {};
          const content = found.conversationContent || {};
          matchedSellerName = target.dnick || content.conversationName || target.snick || sellerQuery;
        }
        
        // 2. Fetch messages with robust backward pagination
        const allMessages = [];
        let cursor = (Date.now() + 10000000000).toString();
        let hasMore = true;
        let fetchRound = 0;
        const maxRounds = Math.ceil(targetLimit / 45) + 5;
        
        while (hasMore && allMessages.length < targetLimit && fetchRound < maxRounds) {
          fetchRound++;
          const batchSize = Math.min(50, targetLimit - allMessages.length);
          const res = await msgService.listPrevMsgs(matchedCid, cursor, batchSize);
          
          const rawModels = res?.userMessageModels || [];
          if (rawModels.length === 0) {
            hasMore = false;
            break;
          }
          
          let minCreateAt = Number.MAX_SAFE_INTEGER;
          for (const m of rawModels) {
            const msg = m.message;
            if (!msg) continue;
            
            const createAt = msg.createAt || 0;
            if (createAt > 0 && createAt < minCreateAt) {
              minCreateAt = createAt;
            }
            
            // Determine sender role dynamically
            const currentUserId = (sdk?.context?.base?.currentUserId || sdk?.context?.base?.userId || window.g_config?.nick || '').toLowerCase();
            const senderUid = (msg.sender?.uid || msg.senderUid || '').toLowerCase();
            const senderNick = (msg.extension?.sender_nick || '').toLowerCase();
            const isSelf = msg.isSelf === true || 
                           msg.from?.isSelf === true ||
                           msg.sender?.role === 'buyer' ||
                           msg.direction === 'send' ||
                           (currentUserId && (senderUid.includes(currentUserId) || senderNick.includes(currentUserId))) ||
                           (msg.sender?.isSeller === false);
            
            let text = '';
            let type = 'text';
            let attachmentUrl = '';
            
            const ct = msg.content?.contentType;
            if (ct === 1) {
              type = 'text';
              text = msg.content?.text?.content || '';
            } else if (ct === 101) {
              try {
                const customData = JSON.parse(msg.content?.custom?.data || '{}');
                if (customData.url) {
                  type = 'image';
                  attachmentUrl = customData.url;
                  text = '[图片附件: ' + (customData.fileId || customData.suffix || 'image') + ']';
                } else if (customData.title || customData.itemName) {
                  type = 'product_card';
                  text = '[商品卡片] ' + (customData.title || customData.itemName) + ' ¥' + (customData.price || '');
                  attachmentUrl = customData.itemUrl || customData.picUrl || '';
                } else {
                  type = 'custom';
                  text = msg.searchableContent?.summary || JSON.stringify(customData);
                }
              } catch {
                type = 'custom';
                text = msg.searchableContent?.summary || msg.content?.custom?.summary || '[自定义消息]';
              }
            } else if (ct === 2) {
              type = 'image';
              attachmentUrl = msg.content?.image?.url || '';
              text = '[图片]';
            } else {
              type = 'other';
              text = msg.content?.text?.content || msg.searchableContent?.summary || '[非文本消息]';
            }
            
            const senderNick = msg.extension?.sender_nick || (isSelf ? '买家 (我)' : matchedSellerName);
            const timeStr = createAt ? new Date(createAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
            
            allMessages.push({
              id: msg.messageId || (matchedCid + '_' + createAt),
              create_at: createAt,
              time: timeStr,
              sender_role: isSelf ? 'buyer' : 'seller',
              sender_nick: senderNick.replace(/^cntaobao/, ''),
              type,
              content: text,
              attachment_url: attachmentUrl,
            });
          }
          
          if (res?.hasMore === false || rawModels.length < batchSize || minCreateAt === Number.MAX_SAFE_INTEGER) {
            hasMore = false;
            break;
          }
          
          cursor = (minCreateAt - 1).toString();
          await sleep(100);
        }
        
        return {
          ok: true,
          seller: matchedSellerName,
          cid: matchedCid,
          total: allMessages.length,
          messages: allMessages
        };
      })()
    `));

    if (!evalResult || evalResult.ok === false) {
      throw new CommandExecutionError(`获取聊天记录失败: ${evalResult?.message || evalResult?.error || '未知错误'}`);
    }

    let msgs = evalResult.messages || [];

    // Deduplicate
    const seen = new Set();
    msgs = msgs.filter(m => {
      const key = m.id || `${m.create_at}_${m.content}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort
    if (order === 'asc') {
      msgs.sort((a, b) => a.create_at - b.create_at);
    } else {
      msgs.sort((a, b) => b.create_at - a.create_at);
    }

    return msgs.map((m, idx) => ({
      index: idx + 1,
      id: m.id,
      create_at: m.create_at,
      time: m.time,
      sender_role: m.sender_role === 'buyer' ? '买家' : '卖家',
      sender_nick: m.sender_nick,
      type: m.type,
      content: m.content,
      attachment_url: m.attachment_url,
    }));
  },
});
