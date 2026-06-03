import { ArgumentError, CommandExecutionError, EmptyResultError, selectorError } from '@jackwener/opencli/errors';

export const TRAE_CN_COMPOSER_SELECTOR = '.chat-input-v2-input-box-editable[data-lexical-editor="true"], .chat-input-v2-input-box-editable[contenteditable="true"]';
export const TRAE_CN_SEND_BUTTON_SELECTOR = '.chat-input-v2-send-button';
export const TRAE_CN_TURN_SELECTOR = 'section.chat-turn';
export const TRAE_CN_MODEL_TRIGGER_SELECTOR = 'button.icd-model-select-trigger';
export const TRAE_CN_MODEL_ITEM_SELECTOR = '.icube-model-select-portal-model-item';
export const TRAE_CN_NEW_TASK_SELECTOR = '[data-testid="ai-chat-create-new-session"], [class*="new-task-button"]';
export const TRAE_CN_APPROVAL_DEFAULT_KINDS = ['terminal', 'delete'];
export const TRAE_CN_HIGH_RISK_COMMAND_PATTERNS = [
  'rm',
  'delete',
  'unlink',
  'shred',
  'dd',
  'truncate',
  'kill',
  'chmod',
  'mv',
  'copy',
  'move',
  'Set-Content',
  'Out-File',
  'mkfs',
  'git force/delete/hard/filter/rebase operations',
  'destructive database commands',
];

export function normalizeTimeout(value, fallback = 60) {
  const timeout = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new ArgumentError('--timeout must be a positive integer (seconds)');
  }
  return timeout;
}

export function normalizeLimit(value, fallback = 20) {
  const limit = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ArgumentError('--limit must be an integer between 1 and 200');
  }
  return limit;
}

export function normalizeMaxChars(value, fallback = 6000) {
  const maxChars = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(maxChars) || maxChars < 0 || maxChars > 1_000_000) {
    throw new ArgumentError('--max-chars must be an integer between 0 and 1000000');
  }
  return maxChars;
}

export function normalizeDuration(value, fallback = 30) {
  const duration = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
    throw new ArgumentError('--duration must be an integer between 1 and 3600 seconds');
  }
  return duration;
}

export function normalizeInterval(value, fallback = 2) {
  const interval = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 300) {
    throw new ArgumentError('--interval must be an integer between 1 and 300 seconds');
  }
  return interval;
}

export function normalizeApprovalKinds(value, fallback = TRAE_CN_APPROVAL_DEFAULT_KINDS.join(',')) {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const expanded = [];
  for (const part of parts) {
    const item = String(part || '').trim().toLowerCase();
    if (!item) continue;
    if (item === 'all') {
      expanded.push('terminal', 'delete', 'keep');
      continue;
    }
    if (!['terminal', 'delete', 'keep'].includes(item)) {
      throw new ArgumentError('--approve-kinds must contain only terminal, delete, keep, or all');
    }
    expanded.push(item);
  }
  const unique = Array.from(new Set(expanded));
  if (unique.length === 0) {
    throw new ArgumentError('--approve-kinds must contain at least one approval kind');
  }
  return unique;
}

export function normalizeApprovalLimit(value, fallback = 1) {
  const limit = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new ArgumentError('--limit must be an integer between 1 and 20');
  }
  return limit;
}

export function ensurePrompt(text) {
  const prompt = typeof text === 'string' ? text : '';
  if (!prompt.trim()) {
    throw new ArgumentError('text must not be empty');
  }
  return prompt;
}

export function normalizeModelLabel(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9.]+/g, '');
}

export function listOpenModelItemsScript() {
  return `
    (function() {
      return Array.from(document.querySelectorAll('${TRAE_CN_MODEL_ITEM_SELECTOR}'))
        .map((el, index) => ({
          Index: index,
          Model: String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
        }))
        .filter(item => item.Model);
    })()
  `;
}

export function inspectTraeShellScript() {
  return `
    (function() {
      const textOf = (el) => String(el?.innerText || el?.textContent || '').trim();
      const model = textOf(document.querySelector('.chat-input-v2-editor-part-lower__left'))
        || textOf(document.querySelector('.chat-input-v2-editor-part-lower-content'))
        || '';
      const agent = textOf(document.querySelector('.chat-input-selected-agent-name'))
        || textOf(document.querySelector('.chat-input-selected-agent-title'))
        || '';
      const title = document.title || '';
      const workspaceMatch = title.match(/—\\s*(.+)$/);
      return {
        title,
        url: location.href,
        workspace: workspaceMatch ? workspaceMatch[1].trim() : '',
        model,
        agent,
        turns: document.querySelectorAll('${TRAE_CN_TURN_SELECTOR}').length,
        composerReady: !!document.querySelector('${TRAE_CN_COMPOSER_SELECTOR}'),
      };
    })()
  `;
}

export function clickNewTaskScript() {
  return `
    (function() {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const isDisabled = (el) => el.getAttribute('aria-disabled') === 'true' || el.disabled === true;
      const candidates = Array.from(document.querySelectorAll('${TRAE_CN_NEW_TASK_SELECTOR}'))
        .filter(el => isVisible(el) && !isDisabled(el));
      const textCandidates = Array.from(document.querySelectorAll('button, a, [role="button"], div'))
        .filter(el => isVisible(el) && !isDisabled(el))
        .filter(el => /(^|\\s)新任务(\\s|$)/.test(String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()));
      const target = candidates[0] || textCandidates[0] || null;
      if (!target) {
        return { ok: false, reason: 'new_task_button_not_found' };
      }
      target.click();
      return {
        ok: true,
        method: candidates[0] ? 'data-testid-or-class' : 'text',
        label: String(target.getAttribute('aria-label') || target.innerText || target.textContent || '').replace(/\\s+/g, ' ').trim()
      };
    })()
  `;
}

export function currentTaskStateScript() {
  return `
    (function() {
      const textOf = (el) => String(el?.innerText || el?.textContent || '').trim();
      const model = textOf(document.querySelector('.chat-input-v2-editor-part-lower__left'))
        || textOf(document.querySelector('.chat-input-v2-editor-part-lower-content'))
        || '';
      const agent = textOf(document.querySelector('.chat-input-selected-agent-name'))
        || textOf(document.querySelector('.chat-input-selected-agent-title'))
        || '';
      const title = document.title || '';
      const workspaceMatch = title.match(/—\\s*(.+)$/);
      return {
        workspace: workspaceMatch ? workspaceMatch[1].trim() : '',
        model,
        agent,
        turns: document.querySelectorAll('${TRAE_CN_TURN_SELECTOR}').length,
        composerReady: !!document.querySelector('${TRAE_CN_COMPOSER_SELECTOR}'),
      };
    })()
  `;
}

export function isLikelyBlockingActivity(activity) {
  if (!activity || typeof activity !== 'object') return false;
  if (activity.ApprovalPending === 'yes') return true;
  const text = `${activity.LatestText || ''}\n${activity.Thinking || ''}`;
  return activity.Status === 'running' && /(等待操作|正在等待|命令运行中|检测到高风险|高风险命令|运行风险命令|请在运行前检查|仍要运行|自动运行\s+跳过\s+运行|手动运行\s+取消|\$\s*(rm|mv|chmod|dd|truncate|kill)\b)/i.test(text);
}

export function isActivityComplete(activity) {
  return activity && activity.Status === 'completed';
}

function approvalPromptRowsExpression(kinds = TRAE_CN_APPROVAL_DEFAULT_KINDS, options = {}) {
  const click = Boolean(options.click);
  const limit = options.limit === undefined ? 1 : Number(options.limit);
  const maxChars = options.maxChars === undefined ? 600 : Number(options.maxChars);
  const markCandidates = Boolean(options.markCandidates);
  return `
    (function(kinds, click, limit, maxChars, markCandidates) {
      const normalize = (text) => String(text || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
      const trim = (text) => {
        const full = normalize(text);
        if (maxChars > 0 && full.length > maxChars) {
          return full.slice(0, maxChars) + '...[truncated, ' + (full.length - maxChars) + ' chars omitted]';
        }
        return full;
      };
      const wanted = new Set(Array.isArray(kinds) ? kinds : ['terminal', 'delete']);
      if (wanted.has('all')) {
        wanted.add('terminal');
        wanted.add('delete');
        wanted.add('keep');
        wanted.delete('all');
      }
      const isJsdom = /jsdom/i.test(String(navigator.userAgent || ''));
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        const rect = el.getBoundingClientRect();
        return isJsdom || rect.width > 0 || rect.height > 0 || el.getClientRects().length > 0;
      };
      const isDisabled = (el) => el.disabled === true
        || el.getAttribute('aria-disabled') === 'true'
        || el.classList.contains('disabled')
        || /disabled/i.test(String(el.getAttribute('class') || ''));
      const labelOf = (el) => normalize(
        el.getAttribute('aria-label')
          || el.getAttribute('title')
          || el.innerText
          || el.textContent
          || ''
      );
      const rootSelectors = [
        '[role="dialog"]',
        'dialog',
        '[aria-modal="true"]',
        '[class*="modal"]',
        '[class*="Modal"]',
        '[class*="popover"]',
        '[class*="Popover"]',
        '[class*="popup"]',
        '[class*="Popup"]',
        '[class*="permission"]',
        '[class*="Permission"]',
        '[class*="confirm"]',
        '[class*="Confirm"]',
        '[class*="terminal"]',
        '[class*="Terminal"]',
        '[class*="tool"]',
        '[class*="Tool"]',
        '.ai-agent-task',
        '.task-artifact-container',
        'section.chat-turn'
      ].join(',');
      const rootOf = (el) => {
        const ancestors = [];
        let node = el.parentElement;
        for (let depth = 0; node && depth < 8; depth += 1) {
          ancestors.push(node);
          const text = normalize(node.innerText || node.textContent);
          if (!/^(BODY|HTML)$/i.test(node.tagName || '') && /(确认删除|删除后文件无法恢复|是否仍要删除|检测到高风险|是否.*运行|删除\\s*:)/i.test(text)) {
            return node;
          }
          node = node.parentElement;
        }
        const direct = el.closest(rootSelectors);
        if (direct) return direct;
        for (const ancestor of ancestors) {
          if (normalize(ancestor.innerText || ancestor.textContent).length > 0) return ancestor;
        }
        return el;
      };
      const priorityOf = (kind, label, context, button) => {
        const cls = String(button.className || '');
        if (kind === 'delete' && /(确认删除|删除后文件无法恢复|是否仍要删除)/i.test(context)) return 100;
        if (kind === 'terminal' && /(运行风险命令|不可挽回|仍要执行|确认是否仍要执行)/i.test(context) && /(仍要运行|运行|确认|同意|允许)/i.test(label)) return 110;
        if (kind === 'terminal' && /(确认|检测到高风险|是否.*运行)/i.test(context) && /运行|确认|同意|允许/i.test(label)) return 80;
        if (kind === 'delete' && /icd-delete-files-command-card/i.test(cls + ' ' + context)) return 60;
        if (kind === 'keep') return 10;
        return 20;
      };
      const selectorOf = (el) => {
        const testid = el.getAttribute('data-testid');
        if (testid) return '[data-testid="' + testid.replace(/"/g, '\\\\"') + '"]';
        if (el.id) return '#' + el.id;
        const cls = Array.from(el.classList || []).slice(0, 2).join('.');
        return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
      };
      const classify = (label, context) => {
        const negativeLabel = /(取消|拒绝|不同意|不允许|不运行|不删除|跳过|稍后|否|cancel|deny|reject|no|never|skip)/i.test(label);
        const runModeLabel = /(自动运行|白名单|沙箱|sandbox|allowlist|模式|mode)/i.test(label);
        const keepLabel = /(保留|保留文档|保留文件|keep|retain)/i.test(label);
        const terminalContext = /(终端|命令|shell|terminal|command|执行|运行)/i.test(context);
        const terminalPromptLike = /(是否|确认|确定|同意|允许|检测到高风险|高风险命令|运行风险命令|严重后果|不可挽回|仍要执行|请在运行前检查|要.*运行|运行.*吗|执行.*吗|\\?|？|confirm|approve|allow|are you sure|do you want|run.*command|execute.*command)/i.test(context);
        const terminalLabel = /(同意|允许|运行|执行|继续|确认|确定|approve|allow|run|execute|continue|confirm|ok|yes)/i.test(label);
        if (wanted.has('terminal') && terminalContext && terminalPromptLike && terminalLabel && !negativeLabel && !runModeLabel && !keepLabel) {
          return 'terminal';
        }
        const deleteContext = /(删除|移除|废纸篓|delete|remove|trash)/i.test(context);
        const deletePromptLike = /(是否|确认|确定|同意|允许|保留|要.*删除|删除.*吗|\\?|？|confirm|approve|allow|are you sure|do you want|keep|retain)/i.test(context);
        const deleteLabel = /(删除|移除|确认|确定|同意|允许|继续|delete|remove|confirm|approve|allow|continue|ok|yes)/i.test(label);
        if (wanted.has('delete') && deleteContext && deletePromptLike && deleteLabel && !negativeLabel && !keepLabel) {
          return 'delete';
        }
        if (wanted.has('keep') && deleteContext && deletePromptLike && keepLabel && !negativeLabel) {
          return 'keep';
        }
        return '';
      };

      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((button) => isVisible(button) && !isDisabled(button));
      const candidates = [];
      const seen = new Set();
      for (const button of buttons) {
        const label = labelOf(button);
        if (!label) continue;
        const root = rootOf(button);
        const context = normalize(root.innerText || root.textContent);
        const kind = classify(label, context);
        if (!kind) continue;
        const key = kind + '|' + label + '|' + context.slice(0, 200);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          button,
          kind,
          label,
          context,
          selector: selectorOf(button),
          priority: priorityOf(kind, label, context, button),
        });
      }
      candidates.sort((a, b) => b.priority - a.priority);
      const rows = [];
      let clicked = 0;
      for (const candidate of candidates) {
        const shouldClick = click && clicked < limit;
        let selector = candidate.selector;
        if (markCandidates) {
          const marker = 'opencli-approval-' + rows.length + '-' + Math.random().toString(36).slice(2);
          candidate.button.setAttribute('data-opencli-approval-id', marker);
          selector = '[data-opencli-approval-id="' + marker + '"]';
        }
        const row = {
          Status: shouldClick ? 'Approved' : 'Detected',
          Kind: candidate.kind,
          Button: candidate.label,
          Prompt: trim(candidate.context),
          Selector: selector,
          Action: shouldClick ? 'clicked' : 'detected',
        };
        rows.push(row);
        if (shouldClick) {
          candidate.button.click();
          clicked += 1;
        }
      }
      return rows;
    })(${JSON.stringify(kinds)}, ${JSON.stringify(click)}, ${JSON.stringify(limit)}, ${JSON.stringify(maxChars)}, ${JSON.stringify(markCandidates)})
  `;
}

export function approvalPromptsScript(kinds = TRAE_CN_APPROVAL_DEFAULT_KINDS, options = {}) {
  return approvalPromptRowsExpression(kinds, options);
}

export async function approveTraePrompts(page, kinds = TRAE_CN_APPROVAL_DEFAULT_KINDS, options = {}) {
  const shouldClick = options.click !== false;
  const limit = options.limit === undefined ? 1 : options.limit;
  const maxChars = options.maxChars === undefined ? 600 : options.maxChars;
  const canNativeClick = shouldClick && typeof page.click === 'function';
  const rows = await page.evaluate(approvalPromptsScript(kinds, {
    click: shouldClick && !canNativeClick,
    limit,
    maxChars,
    markCandidates: canNativeClick,
  }));
  const detected = Array.isArray(rows) ? rows : [];
  if (!canNativeClick || detected.length === 0) return detected;

  const clickedRows = [];
  let clicked = 0;
  for (const row of detected) {
    if (clicked < limit) {
      try {
        await page.click(row.Selector);
        clickedRows.push({ ...row, Status: 'Approved', Action: 'clicked' });
        clicked += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        clickedRows.push({ ...row, Status: 'Detected', Action: `click-failed: ${message}` });
      }
    } else {
      clickedRows.push(row);
    }
  }
  return clickedRows;
}

export function readMessagesScript(limit = 20, maxChars = 0) {
  return `
    (function() {
      const normalize = (text) => String(text || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      const truncate = (text) => {
        const full = normalize(text);
        const max = ${JSON.stringify(maxChars)};
        if (max > 0 && full.length > max) {
          return {
            text: full.slice(0, max) + '\\n...[truncated, ' + (full.length - max) + ' chars omitted]',
            chars: full.length,
            truncated: 'yes'
          };
        }
        return { text: full, chars: full.length, truncated: 'no' };
      };
      const cleanClone = (node) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll([
          '.chat-turn-heading',
          '.icube-references-container',
          '.assistant-action-bar',
          '.latest-assistant-bar',
          '.actions-group',
          '.floating-actions',
          'button',
          'svg',
          'style',
          'script'
        ].join(',')).forEach(el => el.remove());
        return clone;
      };
      const textForTurn = (turn, role) => {
        if (role === 'user') {
          const lines = Array.from(turn.querySelectorAll('.user-chat-line'))
            .map(line => normalize(line.innerText || line.textContent))
            .filter(Boolean);
          if (lines.length > 0) return lines.join('\\n');
        }
        const markdown = Array.from(turn.querySelectorAll('.chat-markdown, .thinking-markdown, .ai-agent-task-section-main, .task-artifact-container'))
          .map(el => normalize(el.innerText || el.textContent))
          .filter(Boolean);
        if (markdown.length > 0) return markdown.join('\\n\\n');
        return normalize(cleanClone(turn).innerText || cleanClone(turn).textContent);
      };
      const turns = Array.from(document.querySelectorAll('${TRAE_CN_TURN_SELECTOR}'));
      return turns.map((turn, index) => {
        const rawRole = turn.getAttribute('data-role') || (turn.classList.contains('user') ? 'user' : turn.classList.contains('assistant') ? 'assistant' : 'unknown');
        const role = rawRole === 'user' ? 'User' : rawRole === 'assistant' ? 'Assistant' : 'Unknown';
        const text = truncate(textForTurn(turn, rawRole));
        return {
          Role: role,
          Text: text.text,
          TextChars: text.chars,
          Truncated: text.truncated,
          TurnIndex: turn.getAttribute('data-turn-index') || String(index),
          MessageId: turn.getAttribute('data-message-id') || ''
        };
      }).filter(item => item.Text).slice(-${JSON.stringify(limit)});
    })()
  `;
}

export function countTurnsScript() {
  return `document.querySelectorAll('${TRAE_CN_TURN_SELECTOR}').length`;
}

export function submittedPromptScript(beforeCount, text) {
  return `
    (function(beforeCount, text) {
      const normalize = (value) => String(value || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
      const prompt = normalize(text);
      const turns = Array.from(document.querySelectorAll('${TRAE_CN_TURN_SELECTOR}')).slice(Number(beforeCount) || 0);
      return turns.some((turn) => {
        const role = String(turn.getAttribute('data-role') || '').toLowerCase();
        const isUser = role === 'user' || turn.classList.contains('user');
        return isUser && normalize(turn.innerText || turn.textContent).includes(prompt);
      });
    })(${JSON.stringify(beforeCount)}, ${JSON.stringify(text)})
  `;
}

export function latestAssistantScript(maxChars = 0) {
  return `
    (function() {
      const rows = ${readMessagesScript(200, maxChars)};
      return rows.reverse().find(row => row.Role === 'Assistant') || null;
    })()
  `;
}

export function activityScript(maxChars = 1200) {
  return `
    (function() {
      const normalize = (text) => String(text || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      const trim = (text) => {
        const full = normalize(text);
        const max = ${JSON.stringify(maxChars)};
        if (max > 0 && full.length > max) return full.slice(0, max) + '\\n...[truncated, ' + (full.length - max) + ' chars omitted]';
        return full;
      };
      const textOf = (node) => normalize(node?.innerText || node?.textContent || '');
      const classOf = (node) => String(node?.className || '');
      const title = document.title || '';
      const workspaceMatch = title.match(/—\\s*(.+)$/);
      const model = textOf(document.querySelector('.chat-input-v2-editor-part-lower__left'))
        || textOf(document.querySelector('.chat-input-v2-editor-part-lower-content'))
        || '';
      const agent = textOf(document.querySelector('.chat-input-selected-agent-name'))
        || textOf(document.querySelector('.chat-input-selected-agent-title'))
        || '';
      const turns = Array.from(document.querySelectorAll('${TRAE_CN_TURN_SELECTOR}'));
      const lastTurn = turns[turns.length - 1] || null;
      const latestAssistant = turns.slice().reverse().find(turn => (turn.getAttribute('data-role') || '').toLowerCase() === 'assistant' || turn.classList.contains('assistant')) || null;
      const latestUser = turns.slice().reverse().find(turn => (turn.getAttribute('data-role') || '').toLowerCase() === 'user' || turn.classList.contains('user')) || null;
      const latestAssistantIndex = latestAssistant ? turns.indexOf(latestAssistant) : -1;
      const latestUserIndex = latestUser ? turns.indexOf(latestUser) : -1;
      const scoped = latestAssistant || lastTurn || document.body;
      const scopedText = textOf(scoped);
      const latestRole = lastTurn ? ((lastTurn.getAttribute('data-role') || '').toLowerCase() || (lastTurn.classList.contains('assistant') ? 'assistant' : lastTurn.classList.contains('user') ? 'user' : 'unknown')) : 'none';

      const taskCards = Array.from(scoped.querySelectorAll('.icd-tasks-list-card-container'));
      const taskScope = taskCards[taskCards.length - 1] || scoped;
      const taskItems = Array.from(taskScope.querySelectorAll('.icd-tasks-list-item-container')).map((item, index) => {
        const icon = item.querySelector('[class*="icd-tasks-list-item-icon"]');
        const content = item.querySelector('[class*="icd-tasks-list-item-content"]') || item;
        const cls = [classOf(icon), classOf(content), classOf(item)].join(' ');
        const state = /in_progress|active/.test(cls) ? 'running' : /completed|done|success/.test(cls) ? 'completed' : /pending/.test(cls) ? 'pending' : 'unknown';
        return {
          index: index + 1,
          state,
          text: trim(textOf(content))
        };
      }).filter(item => item.text);

      const completed = taskItems.filter(item => item.state === 'completed').length;
      const runningItems = taskItems.filter(item => item.state === 'running');
      const pending = taskItems.filter(item => item.state === 'pending').length;
      const activeStep = runningItems[0]?.text || taskItems.find(item => item.state === 'pending')?.text || '';
      const progressText = Array.from(taskScope.querySelectorAll('.icd-tasks-list-card-header-text, .icd-tasks-list-card-header'))
        .map(el => textOf(el))
        .find(Boolean) || '';
      const progressMatch = progressText.match(/(\\d+\\s*\\/\\s*\\d+)\\s*(?:已完成|completed)/i)
        || progressText.match(/(?:进度|progress)[^\\d]{0,12}(\\d+\\s*%)/i)
        || (taskCards.length ? scopedText.match(/(\\d+\\s*\\/\\s*\\d+)\\s*(?:已完成|completed)/i) : null);
      const progress = progressMatch ? progressMatch[1].replace(/\\s+/g, '') : (taskItems.length ? completed + '/' + taskItems.length : '');
      const hasRunningClass = taskScope.querySelector('.in_progress, [class*="in_progress"], [class*="loading"], [class*="spinner"]') !== null;
      const statusBarText = textOf(scoped.querySelector('.latest-assistant-bar .status, .latest-assistant-bar'));
      const hasExplicitCompletionMarker = /任务完成|已完成|completed|done/i.test(statusBarText);
      const hasPlainCompletionMarker = /任务完成|completed|done/i.test(scopedText);
      const allTasksCompleted = taskItems.length > 0 && taskItems.every(item => item.state === 'completed');
      const progressParts = String(progress || '').match(/^(\\d+)\\/(\\d+)$/);
      const progressCompleted = progressParts ? Number(progressParts[1]) > 0 && Number(progressParts[1]) === Number(progressParts[2]) : false;
      let status = 'idle';
      if (latestUserIndex > latestAssistantIndex) status = 'waiting';
      else if (latestAssistantIndex >= 0 && latestAssistantIndex >= latestUserIndex) {
        status = (hasExplicitCompletionMarker || allTasksCompleted || progressCompleted || (!taskItems.length && hasPlainCompletionMarker))
          ? 'completed'
          : 'running';
      }

      const thinking = Array.from(scoped.querySelectorAll('.thinking-markdown, .ai-deep-thinking-state-bar, .ai-agent-task'))
        .map(el => trim(textOf(el)))
        .filter(Boolean)
        .slice(-5)
        .join('\\n---\\n');
      const approvals = ${approvalPromptRowsExpression(['terminal', 'delete', 'keep'], { click: false, limit: 1, maxChars: 300 })};

      return {
        Status: status,
        Workspace: workspaceMatch ? workspaceMatch[1].trim() : '',
        Model: model,
        Agent: agent,
        LatestRole: latestRole ? latestRole[0].toUpperCase() + latestRole.slice(1) : '',
        TurnIndex: latestAssistant?.getAttribute('data-turn-index') || lastTurn?.getAttribute('data-turn-index') || '',
        MessageId: latestAssistant?.getAttribute('data-message-id') || lastTurn?.getAttribute('data-message-id') || '',
        Progress: progress,
        ActiveStep: activeStep,
        CompletedSteps: completed,
        PendingSteps: pending,
        TotalSteps: taskItems.length,
        TaskSummary: taskItems.map(item => item.index + ':' + item.state + ':' + item.text).join('\\n'),
        Thinking: thinking,
        ApprovalPending: approvals.length ? 'yes' : 'no',
        ApprovalKind: approvals[0]?.Kind || '',
        ApprovalButton: approvals[0]?.Button || '',
        ApprovalPrompt: approvals[0]?.Prompt || '',
        LatestText: trim(scopedText),
        TextChars: scopedText.length,
        UpdatedAt: new Date().toISOString()
      };
    })()
  `;
}

export function injectPromptScript(text) {
  return `
    (function(text) {
      const editor = document.querySelector('${TRAE_CN_COMPOSER_SELECTOR}');
      if (!editor) return { ok: false, reason: 'composer_not_found' };
      editor.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand('delete', false);
      document.execCommand('insertText', false, text);
      return { ok: true };
    })(${JSON.stringify(text)})
  `;
}

export function submitPromptScript() {
  return `
    (function() {
      const button = document.querySelector('${TRAE_CN_SEND_BUTTON_SELECTOR}');
      if (button && !button.disabled && !button.classList.contains('disabled')) {
        button.click();
        return { ok: true, mode: 'button' };
      }
      const editor = document.querySelector('${TRAE_CN_COMPOSER_SELECTOR}');
      if (!editor) return { ok: false, reason: 'composer_not_found' };
      return { ok: false, reason: 'send_button_disabled' };
    })()
  `;
}

export function responseAfterScript(beforeCount, maxChars = 0) {
  return `
    (function() {
      const turns = Array.from(document.querySelectorAll('${TRAE_CN_TURN_SELECTOR}'));
      const after = turns.slice(${JSON.stringify(beforeCount)});
      const assistant = after.reverse().find(turn => (turn.getAttribute('data-role') || '').toLowerCase() === 'assistant' || turn.classList.contains('assistant'));
      if (!assistant) return null;
      const read = ${readMessagesScript(1, maxChars)};
      const rows = read;
      const last = rows[rows.length - 1];
      return last && last.Role === 'Assistant' ? last : null;
    })()
  `;
}

export async function readTraeMessages(page, limit = 20, maxChars = 0) {
  const messages = await page.evaluate(readMessagesScript(limit, maxChars));
  if (!messages || messages.length === 0) {
    throw new EmptyResultError('trae-cn read', 'No conversation history found in Trae CN.');
  }
  return messages;
}

export async function sendTraePrompt(page, text) {
  const prompt = ensurePrompt(text);
  const beforeCount = await page.evaluate(countTurnsScript());
  const injected = await page.evaluate(injectPromptScript(prompt));
  if (!injected?.ok) throw selectorError('Trae CN chat input');
  await page.wait(0.3);
  const submitted = await page.evaluate(submitPromptScript());
  let mode = submitted?.mode || 'unknown';
  if (!submitted?.ok) {
    if (submitted?.reason === 'send_button_disabled' && typeof page.pressKey === 'function') {
      await page.pressKey('Enter');
      await page.wait(0.8);
      mode = 'keyboard';
    } else {
      throw selectorError('Trae CN send button');
    }
  } else {
    await page.wait(0.8);
  }
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (await page.evaluate(submittedPromptScript(beforeCount, prompt))) {
      return { prompt, mode };
    }
    await page.wait(0.2);
  }
  throw new CommandExecutionError(
    'Trae CN prompt submission was not verified',
    'The prompt was injected and submit was triggered, but no new user turn containing that prompt appeared.',
  );
}

export async function selectTraeModel(page, name) {
  const wanted = ensurePrompt(name);
  const wantedKey = normalizeModelLabel(wanted);
  let models = await page.evaluate(listOpenModelItemsScript());
  if (!models || models.length === 0) {
    await page.click(TRAE_CN_MODEL_TRIGGER_SELECTOR);
    await page.wait(0.8);
    models = await page.evaluate(listOpenModelItemsScript());
  }
  const exactMatch = models.find((item) => normalizeModelLabel(item.Model) === wantedKey);
  const containsMatches = exactMatch
    ? []
    : models.filter((item) => normalizeModelLabel(item.Model).includes(wantedKey));
  if (!exactMatch && containsMatches.length > 1) {
    throw new ArgumentError(
      `Model "${wanted}" is ambiguous in Trae CN model menu: ${containsMatches.map(item => item.Model).join(', ')}`,
    );
  }
  const match = exactMatch || containsMatches[0];
  if (!match) {
    throw new ArgumentError(`Model "${wanted}" not found in Trae CN model menu`);
  }
  await page.click(TRAE_CN_MODEL_ITEM_SELECTOR, { nth: match.Index });
  await page.wait(0.8);
  const info = await page.evaluate(inspectTraeShellScript());
  const selectedLabel = info.model || '';
  const selectedKey = normalizeModelLabel(selectedLabel);
  const matchKey = normalizeModelLabel(match.Model);
  if (!selectedKey || (selectedKey !== matchKey && selectedKey !== wantedKey)) {
    throw new CommandExecutionError(
      `Trae CN model switch did not verify the requested model: requested "${wanted}", current "${selectedLabel || 'unknown'}"`,
      'Open the Trae CN model menu and verify the requested model is selectable, then retry.',
    );
  }
  return {
    requested: wanted,
    selected: selectedLabel,
    workspace: info.workspace || '',
    agent: info.agent || '',
  };
}
