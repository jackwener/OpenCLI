import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const API_BASE = 'https://api2.mubu.com/v3/api';
const MUBU_DOMAIN = 'mubu.com';
const AUTH_HINT = 'Mubu requires a logged-in browser session at mubu.com';

function isAuthFailure(code, message) {
  if (code === 401 || code === 403) return true;
  if (!message) return false;
  return /not logged in|login required|unauthorized|未登录|请先登录|需要登录|login expired/i.test(message);
}

/**
 * 在浏览器页面上下文里用 XHR 发 POST 请求（参考 zsxq 适配器模式）。
 * mubu app 自身也是这个机制：从 localStorage 读 Jwt-Token，通过同名 header 发到 api2.mubu.com。
 * 不经过 Node.js 进程发网络请求，避免 CORS 问题和 extension fetch 拦截。
 */
export async function mubuPost(page, path, body) {
  const url = `${API_BASE}${path}`;

  const result = await page.evaluate(`
    (async () => {
      const token = localStorage.getItem('Jwt-Token');
      if (!token) return { ok: false, status: 0, data: null, error: 'no token' };
      return await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', ${JSON.stringify(url)}, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Jwt-Token', token);
        xhr.onload = () => {
          let data = null;
          try { data = JSON.parse(xhr.responseText); } catch {}
          resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
        };
        xhr.onerror = () => resolve({ ok: false, status: 0, data: null, error: 'network error' });
        xhr.send(${JSON.stringify(JSON.stringify(body))});
      });
    })()
  `);

  if (!result || result.error === 'no token') {
    throw new AuthRequiredError(MUBU_DOMAIN, AUTH_HINT);
  }
  if (!result.ok || !result.data) {
    throw new CommandExecutionError(`mubu: ${path}: HTTP ${result.status} ${result.error ?? ''}`);
  }

  const { data } = result;
  if (data.code !== 0) {
    if (isAuthFailure(data.code, data.message)) {
      throw new AuthRequiredError(MUBU_DOMAIN, AUTH_HINT);
    }
    throw new CommandExecutionError(`mubu: ${path}: code=${data.code} ${data.message ?? ''}`);
  }

  return data.data;
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeHtmlEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => NAMED_ENTITIES[n]);
}

/** 解析幕布 HTML 表格为行列二维数组（保留内部 HTML） */
function parseTableRows(tableHtml) {
  const rows = [];
  const rowMatches = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rowMatches) {
    const cells = [];
    const cellMatches = row.match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/gi) ?? [];
    for (const cell of cellMatches) {
      // 只剥离最外层的 <td> 或 <th>，保留内部的加粗、链接和 <br>
      let innerHtml = cell.replace(/^<(?:td|th)[^>]*>|<\/(?:td|th)>$/gi, '');
      cells.push(innerHtml.trim());
    }
    rows.push(cells);
  }
  return rows;
}

/** 将幕布 HTML text 转为纯文本 */
export function htmlToText(html) {
  let text = html;
  // 表格 → 纯文本（tab 分隔）；用 </table>\s*</div> 作结束锚，跳过 th/td 内部嵌套 div
  text = text.replace(/<div class="table-container">[\s\S]*?<\/table>\s*<\/div>/g, (m) => {
    return parseTableRows(m).map((r) => r.map(c => {
      // 纯文本环境：<br> 换空格，清空所有标签
      let plainCell = c.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
      return decodeHtmlEntities(plainCell).trim();
    }).join('\t')).join('\n');
  });
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeHtmlEntities(text).trim();
}

/** 将幕布 HTML 表格转为 Markdown 表格 */
function tableToMarkdown(tableHtml) {
  const rows = parseTableRows(tableHtml);
  if (rows.length === 0) return '';
  
  const processRow = (row) => row.map(cellHtml => {
    // 把表格内的 <br> 换成占位符，防止稍后被全局替换为 \n 导致表格断裂
    return cellHtml.replace(/<br\s*\/?>/gi, '[[BR]]');
  }).join(' | ');

  const lines = [`| ${processRow(rows[0])} |`, `| ${rows[0].map(() => '---').join(' | ')} |`];
  for (let i = 1; i < rows.length; i++) {
    lines.push(`| ${processRow(rows[i])} |`);
  }
  return lines.join('\n');
}

/** 将幕布 HTML text 转为 Markdown inline 标记 */
export function htmlToMarkdown(html) {
  let md = html;
  
  // 1. 表格 → Markdown 表格
  md = md.replace(/<div class="table-container">[\s\S]*?<\/table>\s*<\/div>/g, (m) => tableToMarkdown(m));
  
  // 2. <br> → 换行
  md = md.replace(/<br\s*\/?>/gi, '\n');
  
  // 3. 统一处理样式标签，支持多 class 组合
  md = md.replace(/<span class="([^"]+)"[^>]*>([\s\S]*?)<\/span>/gi, (match, classes, inner) => {
    // 允许正常处理超链接内部的 bold 和 italic 样式
    if (classes.includes('node-mention')) {
      return match;
    }
    let res = inner;
    if (/\bbold\b/.test(classes)) res = `**${res}**`;
    if (/\bitalic\b/.test(classes)) res = `*${res}*`;
    if (/\bstrikethrough\b/.test(classes)) res = `~~${res}~~`;
    if (/\bunderline\b/.test(classes)) res = `\uFFFEU_OPEN\uFFFE${res}\uFFFEU_CLOSE\uFFFE`;
    return res;
  });

  // 4. node-mention（主题链接 → Markdown 链接，支持组合 class 并继承自身样式）
  md = md.replace(
    /<span([^>]*\bclass="[^"]*\bnode-mention\b[^"]*"[^>]*)>([\s\S]*?)<\/span>/gi,
    (match, attrs, inner) => {
      const docMatch = attrs.match(/\bdata-doc="([^"]+)"/i);
      const docId = docMatch ? docMatch[1] : '';
      if (!docId) return match;
      
      const classMatch = attrs.match(/\bclass="([^"]+)"/i);
      const classes = classMatch ? classMatch[1] : '';
      
      let res = inner.replace(/<[^>]+>/g, '').trim();
      
      // 继承标签自身的样式
      if (/\bbold\b/.test(classes)) res = `**${res}**`;
      if (/\bitalic\b/.test(classes)) res = `*${res}*`;
      if (/\bstrikethrough\b/.test(classes)) res = `~~${res}~~`;
      if (/\bunderline\b/.test(classes)) res = `\uFFFEU_OPEN\uFFFE${res}\uFFFEU_CLOSE\uFFFE`;
      
      return `[${res}](https://mubu.com/app/edit/${docId})`;
    }
  );
  
  // 5. links （外部链接 → Markdown 链接，继承 a 标签自身样式）
  md = md.replace(/<a([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, inner) => {
    const hrefMatch = attrs.match(/\bhref="([^"]+)"/i);
    if (!hrefMatch) return match;
    const href = hrefMatch[1];
    
    const classMatch = attrs.match(/\bclass="([^"]+)"/i);
    const classes = classMatch ? classMatch[1] : '';
    
    let res = inner;
    
    // 继承 a 标签自身的样式
    if (/\bbold\b/.test(classes)) res = `**${res}**`;
    if (/\bitalic\b/.test(classes)) res = `*${res}*`;
    if (/\bstrikethrough\b/.test(classes)) res = `~~${res}~~`;
    if (/\bunderline\b/.test(classes)) res = `\uFFFEU_OPEN\uFFFE${res}\uFFFEU_CLOSE\uFFFE`;
    
    return `[${res}](${href})`;
  });
  
  // 6. 普通 span
  md = md.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1');
  
  // 7. 清理其余标签
  md = md.replace(/<[^>]+>/g, '');
  
  // 8. HTML 实体解码
  md = decodeHtmlEntities(md);
  
  // 9. 还原 underline 占位符
  md = md.replace(/\uFFFEU_OPEN\uFFFE/g, '<u>').replace(/\uFFFEU_CLOSE\uFFFE/g, '</u>');
  
  // 10. 还原表格内的换行符
  md = md.replace(/\[\[BR\]\]/g, '<br>');

  return md.trim();
}

const IMAGE_BASE = 'https://api2.mubu.com/v3';

function imageUrl(uri) {
  return uri.startsWith('http') ? uri : `${IMAGE_BASE}/${uri}`;
}

function taskPrefix(node) {
  if (!node.taskStatus) return '';
  return node.taskStatus === 2 ? '[x] ' : '[ ] ';
}

function taskMeta(node) {
  const parts = [];
  if (node.deadline) {
    const ts = formatDate(node.deadline * 1000);
    parts.push(`📅 ${node.deadlineType === 'date' ? ts.slice(0, 10) : ts}`);
  }
  if (node.remindAt) parts.push(`⏰ ${formatDate(node.remindAt * 1000)}`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

/** 递归将节点树渲染为缩进纯文本 */
export function nodesToText(nodes, depth = 0) {
  const lines = [];
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const emoji = node.emoji ? node.emoji + ' ' : '';
    const text = htmlToText(node.text);
    const prefix = taskPrefix(node);
    const meta = taskMeta(node);
    if (text || emoji || prefix) {
      if (text.includes('\n')) {
        const [first, ...rest] = text.split('\n');
        lines.push(indent + prefix + emoji + first);
        for (const line of rest) lines.push(indent + '  ' + line);
        if (meta) lines.push(indent + '  ' + meta.trim());
      } else {
        lines.push(indent + prefix + emoji + text + meta);
      }
    }
    if (node.note) {
      const noteText = htmlToText(node.note);
      for (const line of noteText.split('\n')) lines.push(indent + '  ' + line);
    }
    if (node.images?.length) {
      for (const img of node.images) {
        lines.push(indent + `[图片: ${imageUrl(img.uri)}]`);
      }
    }
    if (node.children?.length) {
      lines.push(nodesToText(node.children, depth + 1));
    }
  }
  return lines.filter(Boolean).join('\n');
}

/** 递归将节点树渲染为 Markdown（大纲 = 缩进列表，不映射为标题） */
export function nodesToMarkdown(nodes, depth = 0) {
  const lines = [];
  for (const node of nodes) {
    const text = htmlToMarkdown(node.text);
    if (!text && !node.images?.length && !node.note && !node.emoji) continue;

    const indent = '  '.repeat(depth);
    const emoji = node.emoji ? node.emoji + ' ' : '';
    const prefix = taskPrefix(node);
    const meta = taskMeta(node);
    if (text || emoji || prefix) {
      if (text.includes('\n')) {
        const [first, ...rest] = text.split('\n');
        lines.push(indent + '- ' + prefix + emoji + first);
        const continuation = indent + '  ';
        for (const line of rest) lines.push(continuation + line);
        if (meta) lines.push(continuation + meta.trim());
      } else {
        lines.push(indent + '- ' + prefix + emoji + text + meta);
      }
    }
    if (node.note) {
      const noteLines = htmlToMarkdown(node.note).split('\n');
      for (const line of noteLines) lines.push(indent + '  > ' + line);
    }
    if (node.images?.length) {
      for (const img of node.images) {
        lines.push(indent + `  ![image](${imageUrl(img.uri)})`);
      }
    }

    if (node.children?.length) {
      lines.push(nodesToMarkdown(node.children, depth + 1));
    }
  }
  return lines.filter(Boolean).join('\n');
}
