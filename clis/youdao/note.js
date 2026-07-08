import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const ALLOWED_HOSTS = new Set([
  'share.note.youdao.com',
  'note.youdao.com',
  'share.note.youdao.cn',
  'note.youdao.cn',
]);

function unwrapEvaluateResult(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

function normalizeShareUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new ArgumentError('youdao note url cannot be empty', 'Pass a full public share URL from Youdao Notes.');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ArgumentError('Invalid Youdao Note URL', 'Example: https://share.note.youdao.com/ynoteshare/index.html?id=...&type=note');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ArgumentError('Youdao Note URL must use http or https');
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new ArgumentError('Youdao Note URL must be under note.youdao.com or note.youdao.cn');
  }
  if (!parsed.searchParams.get('id')) {
    throw new ArgumentError('Youdao Note URL must include an id query parameter');
  }
  const type = parsed.searchParams.get('type');
  if (type && type !== 'note') {
    throw new ArgumentError('youdao note only accepts shared note URLs', 'Shared notebooks are not implemented yet.');
  }
  return parsed.toString();
}

function formatYoudaoTimestamp(value) {
  if (value == null || value === '') return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return String(value);
  const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function buildExtractorJs() {
  const walkTextFn = `
    function walkText(node, out) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i += 1) walkText(node[i], out);
        return;
      }
      if (typeof node[8] === 'string') {
        var text = node[8].replace(/\\s+/g, ' ').trim();
        if (text) out.push(text);
      }
      var keys = Object.keys(node);
      for (var j = 0; j < keys.length; j += 1) {
        var value = node[keys[j]];
        if (value && typeof value === 'object') walkText(value, out);
      }
    }
  `;
  return `
    (function() {
      ${walkTextFn}
      function cleanText(value) {
        return String(value || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      }
      function pageText() {
        return cleanText((document.body && (document.body.innerText || document.body.textContent)) || '').slice(0, 1000);
      }
      function classifyBodyText(text) {
        if (/登录|登陆|请先登录|无权|权限|访问受限|验证码|安全验证|login|forbidden|permission/i.test(text)) return 'auth';
        if (/分享已取消|分享不存在|文件不存在|笔记不存在|页面不存在|已过期|不存在|not found|404/i.test(text)) return 'not_found';
        return '';
      }
      function findStoreState(value, depth, seen) {
        if (!value || typeof value !== 'object' || depth > 10) return null;
        if (seen.indexOf(value) !== -1) return null;
        seen.push(value);
        if (value.storeState && typeof value.storeState === 'object') return value.storeState;
        if (value.content && value.content.data && typeof value.content.data === 'object') return value;
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i += 1) {
          var found = findStoreState(value[keys[i]], depth + 1, seen);
          if (found) return found;
        }
        return null;
      }
      function findStoreFromFiber(fiber) {
        var cursor = fiber;
        var stack = [];
        while (cursor || stack.length) {
          if (!cursor) {
            cursor = stack.pop();
            continue;
          }
          var fromState = findStoreState(cursor.memoizedState, 0, []);
          if (fromState) return fromState;
          var fromProps = findStoreState(cursor.memoizedProps, 0, []);
          if (fromProps) return fromProps;
          if (cursor.sibling) stack.push(cursor.sibling);
          cursor = cursor.child;
        }
        return null;
      }
      var root = document.querySelector('#root');
      var body = pageText();
      var bodyKind = classifyBodyText(body);
      if (!root) {
        return [false, bodyKind || 'root_missing', body];
      }
      var reactKey = Object.keys(root).find(function(key) { return key.indexOf('__reactContainer$') === 0; });
      var fiber = (root._reactRootContainer && root._reactRootContainer._internalRoot && root._reactRootContainer._internalRoot.current)
        || (reactKey ? root[reactKey] : null);
      if (!fiber) {
        return [false, bodyKind || 'react_root_missing', body];
      }
      var store = findStoreFromFiber(fiber);
      if (!store) {
        return [false, bodyKind || 'store_missing', body];
      }
      var contentData = store.content && store.content.data;
      if (!contentData || typeof contentData !== 'object') {
        return [false, bodyKind || 'content_data_missing', body];
      }
      var title = cleanText(contentData.tl || document.querySelector('.file-name')?.textContent || document.title || '');
      var hasContentField = Object.prototype.hasOwnProperty.call(contentData, 'content');
      var rawContent = hasContentField ? String(contentData.content || '') : '';
      var content = '';
      if (rawContent) {
        try {
          var parsed = JSON.parse(rawContent);
          var parts = [];
          walkText(parsed, parts);
          content = cleanText(parts.join('\\n'));
        } catch (error) {
          content = cleanText(rawContent);
        }
      }
      var summary = '';
      var keywords = [];
      var ai = store.aiSummary;
      if (ai && ai.aiSummary) {
        try {
          var aiPayload = JSON.parse(ai.aiSummary);
          summary = cleanText(aiPayload.description || '');
          if (Array.isArray(aiPayload.keywords)) {
            for (var i = 0; i < aiPayload.keywords.length; i += 1) {
              var keyword = aiPayload.keywords[i];
              if (keyword && keyword.title) keywords.push(cleanText(((keyword.emoji || '') + ' ' + keyword.title).trim()));
            }
          }
        } catch {}
      }
      return [true, title, content, summary, keywords.join(' | '), contentData.ct || null, contentData.sz || null, hasContentField, rawContent.length, window.location.href];
    })()
  `;
}

function normalizeExtractionResult(payload, sourceUrl) {
  const data = unwrapEvaluateResult(payload);
  if (!Array.isArray(data)) {
    throw new CommandExecutionError('Youdao note extractor returned a malformed payload');
  }
  const ok = data[0] === true;
  if (!ok) {
    const reason = typeof data[1] === 'string' && data[1].trim() ? data[1].trim() : 'unknown_parser_failure';
    if (reason === 'auth') {
      throw new AuthRequiredError('note.youdao.com', 'Youdao shared note requires login or additional permission');
    }
    if (reason === 'not_found') {
      throw new EmptyResultError('youdao note', 'The shared note is missing, expired, cancelled, or inaccessible.');
    }
    throw new CommandExecutionError(`Youdao note parser failed: ${reason}`);
  }
  const title = String(data[1] ?? '');
  const content = String(data[2] ?? '');
  const summary = String(data[3] ?? '');
  const keywords = String(data[4] ?? '');
  const createTime = data[5];
  const fileSize = data[6];
  const hasContentField = data[7] === true;
  const rawContentLength = Number(data[8] ?? 0);
  const finalUrl = String(data[9] || sourceUrl);
  if (!title) {
    throw new CommandExecutionError('Youdao note parser did not extract a title');
  }
  if (!hasContentField) {
    throw new CommandExecutionError('Youdao note parser did not find full note content in the page store');
  }
  if (rawContentLength > 0 && !content) {
    throw new CommandExecutionError('Youdao note parser found note content but extracted no readable text');
  }
  const row = {};
  row.title = title;
  row.content = content;
  row.summary = summary;
  row.keywords = keywords;
  row.created_at = formatYoudaoTimestamp(createTime);
  row.file_size = fileSize == null ? '' : String(fileSize);
  row.url = finalUrl;
  return row;
}

var command = cli({
  site: 'youdao',
  name: 'note',
  access: 'read',
  description: 'Read a public shared Youdao Note',
  domain: 'share.note.youdao.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'url', positional: true, required: true, help: 'Full share URL of the Youdao Note' },
  ],
  columns: ['title', 'content', 'summary', 'keywords', 'created_at', 'file_size', 'url'],
  func: async function(page, kwargs) {
    const url = normalizeShareUrl(kwargs.url);
    try {
      await page.goto(url);
    } catch (error) {
      throw new CommandExecutionError(`Failed to open Youdao Note URL: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await page.wait({ selector: '#root, .file-name, body', timeout: 10 });
    } catch {
      await page.wait(3).catch(function() {});
    }
    await page.wait(2).catch(function() {});
    let payload;
    try {
      payload = await page.evaluate(buildExtractorJs());
    } catch (error) {
      throw new CommandExecutionError(`Youdao note extractor failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [normalizeExtractionResult(payload, url)];
  },
});

export var __test__ = {
  buildExtractorJs: buildExtractorJs,
  command: command,
  formatYoudaoTimestamp: formatYoudaoTimestamp,
  normalizeExtractionResult: normalizeExtractionResult,
  normalizeShareUrl: normalizeShareUrl,
};
