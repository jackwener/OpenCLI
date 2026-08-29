import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

export function unwrapEvaluateResult(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

const TAOBAO_CHAT_URL = 'https://market.m.taobao.com/app/im/chat/index.html';

export const command = cli({
  site: 'taobao',
  name: 'sync',
  access: 'read',
  description: '高速批量同步淘宝卖家会话及全量聊天记录 (在浏览器 SDK 内部批量循环拉取)',
  domain: 'market.m.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: 30, help: '批量同步的会话数量 (默认 30, 最大 500)' },
    { name: 'all', type: 'bool', default: false, help: '是否同步账号下全部店铺的所有历史聊天记录' },
    { name: 'msg-limit', type: 'int', default: 200, help: '每个店铺最大拉取消息数 (默认 200)' },
  ],
  columns: [
    'seller',
    'cid',
    'messages_count',
    'status',
    'last_time',
  ],
  func: async (page, kwargs) => {
    const isAll = Boolean(kwargs?.all);
    const sessionLimit = isAll ? 500 : Math.max(1, Math.min(Number(kwargs?.limit) || 30, 500));
    const msgLimit = isAll ? 2000 : Math.max(20, Math.min(Number(kwargs?.['msg-limit']) || 200, 2000));

    // Ensure on chat page
    const currentUrl = await page.evaluate(`location.href`);
    if (!currentUrl.includes('/app/im/chat/')) {
      await page.goto(TAOBAO_CHAT_URL);
      await page.wait?.(3);
    }

    const evalResult = unwrapEvaluateResult(await page.evaluate(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const sessionLimit = ${Number(sessionLimit)};
        const msgLimit = ${Number(msgLimit)};
        
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
        
        if (!convService && !origin?.getConvService) {
          return { ok: false, error: 'no_conv_service', message: '未能获取 ConvService' };
        }
        
        // 1. Get all conversations
        let allConvs = [];
        if (convService) {
          allConvs = await new Promise((resolve, reject) => {
            convService.listAllConversation({
              dataCallback: resolve,
              errorCallBack: reject
            });
          });
        } else if (origin?.getConvService) {
          allConvs = await origin.getConvService().listConversations(0, 1000);
        }
        
        // Sort by modifyTime
        allConvs.sort((a, b) => {
          const tA = a.modifyTime || a.conversationContent?.lastMessageSummary?.sendTime || 0;
          const tB = b.modifyTime || b.conversationContent?.lastMessageSummary?.sendTime || 0;
          return tB - tA;
        });
        
        const targetConvs = allConvs.slice(0, sessionLimit);
        const results = [];
        
        for (let i = 0; i < targetConvs.length; i++) {
          const c = targetConvs[i];
          const ext = c.ext || {};
          const target = ext.target || {};
          const content = c.conversationContent || {};
          const sellerName = target.dnick || content.conversationName || target.snick || '未知店铺';
          const cid = c.conversationCode || c.cid || '';
          const modifyTime = c.modifyTime || content.lastMessageSummary?.sendTime || 0;
          const timeStr = modifyTime ? new Date(modifyTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
          const unread = c.unreadCount || content.unReadNumber || 0;
          
          const sessionObj = {
            rank: i + 1,
            seller: sellerName,
            cid: cid,
            last_message: (content.lastMessageSummary?.content || c.latestMessage?.summary || '').slice(0, 80),
            last_time: timeStr,
            unread: unread,
            is_seller: true,
            modify_time: modifyTime,
            messages: [],
          };
          
          // Pull messages if msgService exists
          if (msgService && cid) {
            try {
              let cursor = (Date.now() + 10000000000).toString();
              let hasMore = true;
              let round = 0;
              const maxRounds = Math.ceil(msgLimit / 45) + 2;
              
              while (hasMore && sessionObj.messages.length < msgLimit && round < maxRounds) {
                round++;
                const batchSize = Math.min(50, msgLimit - sessionObj.messages.length);
                const res = await msgService.listPrevMsgs(cid, cursor, batchSize);
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
                  if (createAt > 0 && createAt < minCreateAt) minCreateAt = createAt;
                  
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
                      const cd = JSON.parse(msg.content?.custom?.data || '{}');
                      if (cd.url) {
                        type = 'image';
                        attachmentUrl = cd.url;
                        text = '[图片附件]';
                      } else if (cd.title || cd.itemName) {
                        type = 'product_card';
                        text = '[商品卡片] ' + (cd.title || cd.itemName);
                        attachmentUrl = cd.itemUrl || cd.picUrl || '';
                      } else {
                        type = 'custom';
                        text = msg.searchableContent?.summary || '[自定义消息]';
                      }
                    } catch {
                      type = 'custom';
                      text = '[自定义消息]';
                    }
                  } else if (ct === 2) {
                    type = 'image';
                    attachmentUrl = msg.content?.image?.url || '';
                    text = '[图片]';
                  } else {
                    type = 'other';
                    text = msg.content?.text?.content || '[消息]';
                  }
                  
                  const senderNick = msg.extension?.sender_nick || (isSelf ? '买家 (我)' : sellerName);
                  sessionObj.messages.push({
                    id: msg.messageId || (cid + '_' + createAt),
                    create_at: createAt,
                    time: createAt ? new Date(createAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
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
                await sleep(50);
              }
            } catch (err) {
              // skip message pull error on single shop
            }
          }
          
          results.push(sessionObj);
          await sleep(60); // rate limiting
        }
        
        return {
          ok: true,
          total_sessions: results.length,
          data: results,
        };
      })()
    `));

    if (!evalResult || evalResult.ok === false) {
      throw new CommandExecutionError(`批量同步失败: ${evalResult?.message || evalResult?.error || '未知错误'}`);
    }

    const sessions = evalResult.data || [];
    return sessions.map(s => ({
      seller: s.seller,
      cid: s.cid,
      messages_count: s.messages?.length || 0,
      status: 'OK',
      last_time: s.last_time,
      _full: s,
    }));
  },
});
