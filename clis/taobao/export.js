import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import fs from 'fs';
import path from 'path';

export function unwrapEvaluateResult(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

const TAOBAO_CHAT_URL = 'https://market.m.taobao.com/app/im/chat/index.html';

export const command = cli({
  site: 'taobao',
  name: 'export',
  access: 'read',
  description: '将与淘宝卖家的完整聊天记录导出为 Markdown、JSON 或 HTML 文件',
  domain: 'market.m.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'seller', positional: true, required: true, help: '卖家店铺名称或会话CID' },
    { name: 'output', type: 'str', default: './taobao-chat-export.md', help: '输出文件路径 (.md, .json, .html)' },
    { name: 'limit', type: 'int', default: 500, help: '导出最大消息条数 (默认 500)' },
    { name: 'file-type', type: 'str', default: 'md', help: '导出文件格式: md | json | html' },
  ],
  columns: [
    'seller',
    'total_exported',
    'output_file',
    'file_size',
    'date_range',
  ],
  func: async (page, kwargs) => {
    const sellerQuery = String(kwargs?.seller || '').trim();
    if (!sellerQuery) {
      throw new ArgumentError('请指定要导出的卖家店铺名称或会话 CID');
    }

    const limit = Math.max(1, Math.min(Number(kwargs?.limit) || 500, 3000));
    let outputPath = String(kwargs?.output || './taobao-chat-export.md').trim();
    const format = String(kwargs?.['file-type'] || (outputPath.endsWith('.json') ? 'json' : outputPath.endsWith('.html') ? 'html' : 'md')).toLowerCase();

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
          
          if (!found) return { ok: false, message: '未在会话列表中找到匹配卖家: ' + sellerQuery };
          
          matchedCid = found.conversationCode || found.cid;
          const ext = found.ext || {};
          const target = ext.target || {};
          const content = found.conversationContent || {};
          matchedSellerName = target.dnick || content.conversationName || target.snick || sellerQuery;
        }
        
        const allMessages = [];
        let cursor = (Date.now() + 1000000000).toString();
        let hasMore = true;
        let round = 0;
        
        while (hasMore && allMessages.length < targetLimit && round < 40) {
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
              id: msg.messageId,
              timestamp: createAt,
              time: createAt ? new Date(createAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
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
      throw new CommandExecutionError(`导出失败: ${evalResult?.message || '未知错误'}`);
    }

    const messages = evalResult.messages || [];
    const seller = evalResult.seller || sellerQuery;
    const cid = evalResult.cid || '';

    // Generate output file
    const resolvedPath = path.resolve(process.cwd(), outputPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let fileContent = '';
    const dateRange = messages.length > 0 ? `${messages[0].time} ~ ${messages[messages.length - 1].time}` : '无记录';

    if (format === 'json') {
      fileContent = JSON.stringify({
        seller,
        cid,
        exported_at: new Date().toISOString(),
        total_messages: messages.length,
        date_range: dateRange,
        messages,
      }, null, 2);
    } else if (format === 'html') {
      const msgHtml = messages.map(m => `
        <div style="margin-bottom: 12px; display: flex; flex-direction: column; align-items: ${m.role === 'buyer' ? 'flex-end' : 'flex-start'};">
          <div style="font-size: 12px; color: #888; margin-bottom: 4px;">${m.sender} · ${m.time}</div>
          <div style="max-width: 70%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; background-color: ${m.role === 'buyer' ? '#007aff' : '#f0f0f0'}; color: ${m.role === 'buyer' ? '#fff' : '#111'};">
            ${m.mediaUrl ? `<img src="${m.mediaUrl}" style="max-width: 100%; border-radius: 8px; margin-bottom: 6px;" /><br/>` : ''}
            ${m.text ? m.text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>') : ''}
          </div>
        </div>
      `).join('\n');

      fileContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>淘宝聊天记录 - ${seller}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #fafafa; padding: 20px; max-width: 800px; margin: 0 auto; }
    .header { background: #fff; padding: 16px 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .chat-box { background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  </style>
</head>
<body>
  <div class="header">
    <h2 style="margin:0 0 8px 0;">店铺: ${seller}</h2>
    <div style="color: #666; font-size: 13px;">CID: ${cid} | 共 ${messages.length} 条记录 | 时间跨度: ${dateRange}</div>
  </div>
  <div class="chat-box">
    ${msgHtml}
  </div>
</body>
</html>`;
    } else {
      // Default: Markdown format
      const header = `# 淘宝卖家沟通记录: ${seller}\n\n- **会话 CID:** \`${cid}\`\n- **导出时间:** ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n- **消息总数:** ${messages.length}\n- **时间跨度:** ${dateRange}\n\n---\n\n## 对话流水记录\n\n`;
      
      const body = messages.map((m, idx) => {
        const roleBadge = m.role === 'buyer' ? '👤 **买家 (我)**' : '🏪 **卖家客服**';
        let mediaSnippet = '';
        if (m.mediaUrl) {
          mediaSnippet = `\n> ![](${m.mediaUrl})\n`;
        }
        return `### ${idx + 1}. ${roleBadge} · \`${m.sender}\` (${m.time})\n\n${m.text}${mediaSnippet}\n`;
      }).join('\n');

      fileContent = header + body;
    }

    fs.writeFileSync(resolvedPath, fileContent, 'utf-8');
    const stats = fs.statSync(resolvedPath);
    const sizeKb = (stats.size / 1024).toFixed(1) + ' KB';

    return {
      seller,
      total_exported: messages.length,
      output_file: resolvedPath,
      file_size: sizeKb,
      date_range: dateRange,
    };
  },
});
