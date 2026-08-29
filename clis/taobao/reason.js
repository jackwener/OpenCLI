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
  name: 'reason',
  access: 'read',
  description: '对指定卖家的聊天记录进行智能推理与结构化提炼 (承诺/质保/规格/发货/纠纷证据/摘要)',
  domain: 'market.m.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'seller', positional: true, required: true, help: '卖家店铺名称或会话CID' },
    { name: 'limit', type: 'int', default: 100, help: '分析最近多少条消息 (默认 100)' },
    { name: 'type', type: 'str', default: 'all', help: '分析维度: all (全景), promises (承诺), dispute (纠纷留证), specs (参数定制)' },
  ],
  columns: [
    'seller',
    'total_messages',
    'summary',
    'commitments',
    'specs_agreed',
    'risk_alerts',
    'attachments_count',
  ],
  func: async (page, kwargs) => {
    const sellerQuery = String(kwargs?.seller || '').trim();
    if (!sellerQuery) {
      throw new ArgumentError('请指定要分析的卖家店铺名称或会话 CID');
    }

    const limit = Math.max(1, Math.min(Number(kwargs?.limit) || 100, 1000));
    const analysisType = String(kwargs?.type || 'all').toLowerCase();

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
        
        if (!iframe) return { ok: false, message: '未找到旺旺 iframe 容器' };
        
        const win = iframe.contentWindow;
        let sdk = win._imsdk;
        attempts = 0;
        while (!sdk && attempts < 10) {
          await sleep(500);
          sdk = win._imsdk;
          attempts++;
        }
        
        if (!sdk) return { ok: false, message: 'IM SDK 未就绪' };
        
        const origin = sdk.getOriginSdk ? sdk.getOriginSdk() : null;
        const convService = sdk.getConversationService ? sdk.getConversationService() : null;
        const msgService = origin?.getMsgService ? origin.getMsgService() : null;
        
        if (!msgService) return { ok: false, message: 'MsgService 未就绪' };
        
        let matchedCid = '';
        let matchedSellerName = '';
        
        if (sellerQuery.includes('@cntaobao') || sellerQuery.includes('#11001')) {
          matchedCid = sellerQuery;
        } else {
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

          const found = (allConvs || []).find(c => {
            const ext = c.ext || {};
            const target = ext.target || {};
            const content = c.conversationContent || {};
            const name = target.dnick || content.conversationName || target.snick || '';
            const cid = c.conversationCode || c.cid || '';
            return name.toLowerCase().includes(sellerQuery.toLowerCase()) || 
                   cid.toLowerCase().includes(sellerQuery.toLowerCase());
          });
          
          if (!found) {
            return { ok: false, message: '未找到卖家: ' + sellerQuery };
          }
          
          matchedCid = found.conversationCode || found.cid;
          const ext = found.ext || {};
          const target = ext.target || {};
          const content = found.conversationContent || {};
          matchedSellerName = target.dnick || content.conversationName || target.snick || sellerQuery;
        }
        
        // Fetch messages
        const allMessages = [];
        let cursor = (Date.now() + 1000000000).toString();
        let hasMore = true;
        let round = 0;
        
        while (hasMore && allMessages.length < targetLimit && round < 20) {
          round++;
          const batchSize = Math.min(50, targetLimit - allMessages.length);
          const res = await msgService.listPrevMsgs(matchedCid, cursor, batchSize);
          const rawModels = res?.userMessageModels || [];
          if (rawModels.length === 0) break;
          
          let minTime = Number.MAX_SAFE_INTEGER;
          for (const m of rawModels) {
            const msg = m.message;
            if (!msg) continue;
            const createAt = msg.createAt || 0;
            if (createAt < minTime) minTime = createAt;
            
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
            let mediaUrl = '';
            let type = 'text';
            if (msg.content?.contentType === 1) {
              text = msg.content?.text?.content || '';
            } else if (msg.content?.contentType === 101) {
              try {
                const data = JSON.parse(msg.content?.custom?.data || '{}');
                if (data.url) {
                  type = 'image';
                  mediaUrl = data.url;
                  text = '[图片附件]';
                } else if (data.title) {
                  type = 'product';
                  text = '[商品] ' + data.title + ' ' + (data.price || '');
                } else {
                  text = msg.searchableContent?.summary || '';
                }
              } catch {
                text = msg.searchableContent?.summary || '';
              }
            } else if (msg.content?.contentType === 2) {
              type = 'image';
              mediaUrl = msg.content?.image?.url || '';
              text = '[图片]';
            }
            
            allMessages.push({
              time: createAt ? new Date(createAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
              timestamp: createAt,
              role: isSelf ? 'buyer' : 'seller',
              sender: msg.extension?.sender_nick?.replace(/^cntaobao/, '') || (isSelf ? '买家' : '卖家'),
              type,
              text,
              mediaUrl
            });
          }
          if (res?.hasMore === false || rawModels.length < batchSize) break;
          cursor = (minTime - 1).toString();
          await sleep(100);
        }
        
        allMessages.sort((a, b) => a.timestamp - b.timestamp);
        
        return {
          ok: true,
          seller: matchedSellerName,
          cid: matchedCid,
          messages: allMessages
        };
      })()
    `));

    if (!evalResult || evalResult.ok === false) {
      throw new CommandExecutionError(`分析失败: ${evalResult?.message || '未知错误'}`);
    }

    const messages = evalResult.messages || [];
    const seller = evalResult.seller || sellerQuery;

    // Rule-based entity extraction and heuristic reasoning
    const commitments = [];
    const specs = [];
    const risks = [];
    let attachmentsCount = 0;

    for (const msg of messages) {
      const text = msg.text || '';
      if (msg.mediaUrl || msg.type === 'image') attachmentsCount++;

      // Commitments keywords (质保、保修、换新、发货、包邮、退、补发)
      if (msg.role === 'seller') {
        if (/保修|质保|换新|终身|保[0-9一二三两]年|包退|包换|运费我们|退货包运费/.test(text)) {
          commitments.push(`[${msg.time}] ${text}`);
        }
        if (/当天发|次日|顺丰|现货|现在下单.*发货|今天.*寄出|加急/.test(text)) {
          commitments.push(`[${msg.time} 发货承诺] ${text}`);
        }
        if (/微信|转账|扫码|私下|线下|好评返现|刷单/.test(text)) {
          risks.push(`[${msg.time} 风险提示] 涉及站外交易/好评: ${text}`);
        }
      }

      // Specs keywords (型号、颜色、版本、67W、45W、PS5、双向、国行、港版、外版)
      if (/版本|型号|颜色|配置|套餐|国行|港版|支持|只能|必须|充电|功率|\d+W|\d+G|\d+T/i.test(text)) {
        if (text.length > 5 && text.length < 150) {
          specs.push(`[${msg.role === 'buyer' ? '买家诉求' : '卖家说明'}] ${text}`);
        }
      }
    }

    // Build intelligent concise summary
    let summary = `共沟通 ${messages.length} 条消息。`;
    if (messages.length > 0) {
      const buyerMsgs = messages.filter(m => m.role === 'buyer').map(m => m.text).filter(t => t && !t.startsWith('['));
      const sellerMsgs = messages.filter(m => m.role === 'seller').map(m => m.text).filter(t => t && !t.startsWith('['));
      
      const firstTopic = buyerMsgs[0] ? `咨询起点: "${buyerMsgs[0].slice(0, 30)}"` : '';
      const lastStatus = sellerMsgs[sellerMsgs.length - 1] ? `最新回复: "${sellerMsgs[sellerMsgs.length - 1].slice(0, 30)}"` : '';
      summary = `${summary} ${firstTopic} -> ${lastStatus}`.trim();
    }

    return {
      seller,
      total_messages: messages.length,
      summary,
      commitments: commitments.length > 0 ? commitments.slice(0, 5).join('\n') : '暂无明确文字承诺',
      specs_agreed: specs.length > 0 ? specs.slice(0, 5).join('\n') : '标准商品沟通',
      risk_alerts: risks.length > 0 ? risks.join('\n') : '未检测到违规风险',
      attachments_count: attachmentsCount,
    };
  },
});
