import { cli, Strategy } from '@jackwener/opencli/registry';
import { htmlToMarkdown } from '@jackwener/opencli/utils';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
    YUANBAO_DOMAIN,
    IS_VISIBLE_JS,
    authRequired,
    isOnYuanbao,
    ensureYuanbaoPage,
    hasLoginGate,
    normalizeBooleanFlag,
    sendYuanbaoMessage,
} from './shared.js';
const YUANBAO_RESPONSE_POLL_INTERVAL_SECONDS = 2;
const YUANBAO_MIN_WAIT_MS = 8_000;
const YUANBAO_STABLE_POLLS_REQUIRED = 3;
function sendFailure(reason, detail) {
    const suffix = detail ? ` Detail: ${detail}` : '';
    return new CommandExecutionError(`${reason || 'Unknown Yuanbao send failure.'}${suffix}`, 'Make sure the Yuanbao chat composer is visible and ready before retrying.');
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
export function convertYuanbaoHtmlToMarkdown(value) {
    return htmlToMarkdown(value, (td) => {
        td.addRule('table', {
            filter: 'table',
            replacement: (content) => `\n\n${content}\n\n`,
        });
        td.addRule('tableSection', {
            filter: ['thead', 'tbody', 'tfoot'],
            replacement: (content) => content,
        });
        td.addRule('tableRow', {
            filter: 'tr',
            replacement: (content, node) => {
                const element = node;
                const cells = Array.from(element.children);
                const isHeaderRow = element.parentElement?.tagName === 'THEAD'
                    || (cells.length > 0 && cells.every((cell) => cell.tagName === 'TH'));
                const row = `${content}\n`;
                if (!isHeaderRow)
                    return row;
                const separator = `| ${cells.map(() => '---').join(' | ')} |\n`;
                return `${row}${separator}`;
            },
        });
        td.addRule('tableCell', {
            filter: ['th', 'td'],
            replacement: (content, node) => {
                const element = node;
                const index = element.parentElement ? Array.from(element.parentElement.children).indexOf(element) : 0;
                const prefix = index === 0 ? '| ' : ' ';
                return `${prefix}${content.trim()} |`;
            },
        });
    });
}
export function sanitizeYuanbaoResponseText(value, promptText) {
    let sanitized = value
        .replace(/内容由AI生成，仅供参考/gi, '')
        .replace(/重新回答/gi, '')
        .trim();
    if (/^(正在搜索资料|搜索资料中|正在思考|思考中)[.。…]*$/u.test(sanitized)) {
        return '';
    }
    const prompt = promptText.trim();
    if (!prompt)
        return sanitized;
    if (sanitized === prompt)
        return '';
    for (const separator of ['\n\n', '\n', '\r\n\r\n', '\r\n', ' ']) {
        const prefix = `${prompt}${separator}`;
        if (sanitized.startsWith(prefix)) {
            sanitized = sanitized.slice(prefix.length).trim();
            break;
        }
    }
    return sanitized;
}
export function collectYuanbaoTranscriptAdditions(beforeLines, currentLines, promptText) {
    const beforeSet = new Set(beforeLines);
    const additions = currentLines
        .filter((line) => !beforeSet.has(line))
        .map((line) => sanitizeYuanbaoResponseText(line, promptText))
        .filter((line) => line && line !== promptText);
    return additions.join('\n').trim();
}
export function pickLatestYuanbaoAssistantCandidate(messages, baselineCount, promptText) {
    const freshMessages = messages
        .slice(Math.max(0, baselineCount))
        .map((message) => sanitizeYuanbaoResponseText(message, promptText))
        .filter(Boolean);
    for (let i = freshMessages.length - 1; i >= 0; i -= 1) {
        if (freshMessages[i] !== promptText.trim())
            return freshMessages[i];
    }
    return '';
}
export function updateStableState(previousText, stableCount, nextText) {
    if (!nextText)
        return { previousText: '', stableCount: 0 };
    if (nextText === previousText)
        return { previousText, stableCount: stableCount + 1 };
    return { previousText: nextText, stableCount: 0 };
}
function getTranscriptLinesScript() {
    return `
    (() => {
      const clean = (value) => (value || '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();

      const root = (
        document.querySelector('.agent-dialogue__content--common')
        || document.querySelector('.agent-dialogue__content')
        || document.querySelector('.agent-dialogue')
        || document.body
      ).cloneNode(true);

      const removableSelectors = [
        '.agent-dialogue__content--common__input',
        '.agent-dialogue__tool',
        '.agent-dialogue__content-copyright',
        '.index_chatLandingBox__G7hAT',
        '.index_chatLandingBoxMobile__J8i8v',
        '.index_chatLandingHintList__M69Lr',
        '.yb-nav',
        '.agent-dialogue__content--common__input .ql-toolbar',
        '.agent-dialogue__content--common__input .ql-container',
        '.agent-dialogue__content--common__input .ql-editor',
        '[role="dialog"]',
        'iframe',
        'button',
        'script',
        'style',
        'noscript',
      ];

      for (const selector of removableSelectors) {
        root.querySelectorAll(selector).forEach((node) => node.remove());
      }

      const stopLines = new Set([
        '元宝',
        'DeepSeek',
        '深度思考',
        '联网搜索',
        '工具',
        '登录',
        '安装电脑版',
        '内容由AI生成，仅供参考',
        '有问题，尽管问，shift+enter换行',
        '立即创建团队',
        '微信',
        '手机',
        'QQ',
        '微信扫码登录',
        '扫码默认已阅读并同意',
        '用户服务协议',
        '隐私协议',
      ]);

      const noisyPatterns = [
        /^支持文件格式[:：]/,
        /^文件拖动到此处即可上传/,
        /^下载元宝电脑版/,
      ];

      return clean(root.innerText || root.textContent || '')
        .split('\\n')
        .map((line) => clean(line))
        .filter((line) => line
          && line.length <= 4000
          && !stopLines.has(line)
          && !noisyPatterns.some((pattern) => pattern.test(line)));
    })()
  `;
}
async function getYuanbaoTranscriptLines(page) {
    const result = await page.evaluate(getTranscriptLinesScript());
    return Array.isArray(result) ? result.map(normalizeText).filter(Boolean) : [];
}
async function getYuanbaoAssistantMessages(page) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}

    const roots = Array.from(document.querySelectorAll('.agent-chat__list__item--ai'))
      .filter((node) => isVisible(node));

    return roots.map((root) => {
      const doneContent = root.querySelector('.hyc-content-md-done');
      const markdownContent = doneContent || root.querySelector('.hyc-content-md');
      const speechContent = root.querySelector('.agent-chat__speech-text');
      const bubbleContent = root.querySelector('.agent-chat__bubble__content');
      const content = markdownContent || speechContent || bubbleContent;

      if (content instanceof HTMLElement) {
        return content.innerHTML || content.textContent || '';
      }

      return root instanceof HTMLElement ? (root.innerHTML || root.textContent || '') : '';
    }).filter(Boolean);
  })()`);
    return Array.isArray(result)
        ? result
            .map((value) => convertYuanbaoHtmlToMarkdown(typeof value === 'string' ? value : ''))
            .map(normalizeText)
            .filter(Boolean)
        : [];
}
async function getYuanbaoInternetSearchState(page) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}

    const button = Array.from(document.querySelectorAll('[dt-button-id="internet_search"]'))
      .find((node) => isVisible(node));

    if (!(button instanceof HTMLElement)) return { found: false, enabled: false };

    const attr = button.getAttribute('dt-internet-search') || '';
    const className = button.className || '';
    return {
      found: true,
      enabled: attr === 'openInternetSearch' || className.includes('index_v2_active__'),
    };
  })()`);
    return result;
}
async function setYuanbaoInternetSearch(page, enabled) {
    const current = await getYuanbaoInternetSearchState(page);
    if (!current.found || current.enabled === enabled)
        return;
    await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}

    const button = Array.from(document.querySelectorAll('[dt-button-id="internet_search"]'))
      .find((node) => isVisible(node));

    if (button instanceof HTMLElement) button.click();
  })()`);
    await page.wait(0.5);
}
async function getYuanbaoDeepThinkState(page) {
    const result = await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}

    const button = Array.from(document.querySelectorAll('[dt-button-id="deep_think"]'))
      .find((node) => isVisible(node));

    if (!(button instanceof HTMLElement)) return { found: false, enabled: false };

    const className = button.className || '';
    return {
      found: true,
      enabled: className.includes('ThinkSelector_selected__'),
    };
  })()`);
    return result;
}
async function setYuanbaoDeepThink(page, enabled) {
    const current = await getYuanbaoDeepThinkState(page);
    if (!current.found || current.enabled === enabled)
        return;
    await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}

    const button = Array.from(document.querySelectorAll('[dt-button-id="deep_think"]'))
      .find((node) => isVisible(node));

    if (button instanceof HTMLElement) button.click();
  })()`);
    await page.wait(0.5);
}
async function waitForYuanbaoResponse(page, baselineAssistantCount, beforeLines, prompt, timeoutSeconds) {
    const startTime = Date.now();
    let previousText = '';
    let stableCount = 0;
    let latestCandidate = '';
    while (Date.now() - startTime < timeoutSeconds * 1000) {
        await page.wait(YUANBAO_RESPONSE_POLL_INTERVAL_SECONDS);
        if (await hasLoginGate(page))
            return 'blocked';
        const assistantMessages = await getYuanbaoAssistantMessages(page);
        const assistantCandidate = pickLatestYuanbaoAssistantCandidate(assistantMessages, baselineAssistantCount, prompt);
        const candidate = assistantCandidate || collectYuanbaoTranscriptAdditions(beforeLines, await getYuanbaoTranscriptLines(page), prompt);
        if (!candidate)
            continue;
        latestCandidate = candidate;
        const nextState = updateStableState(previousText, stableCount, candidate);
        previousText = nextState.previousText;
        stableCount = nextState.stableCount;
        const waitedLongEnough = Date.now() - startTime >= YUANBAO_MIN_WAIT_MS;
        if (waitedLongEnough && stableCount >= YUANBAO_STABLE_POLLS_REQUIRED)
            return candidate;
    }
    return latestCandidate || null;
}
export const askCommand = cli({
    site: 'yuanbao',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to Yuanbao web chat and wait for the assistant response',
    domain: YUANBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', required: true, positional: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', required: false, help: 'Max seconds to wait (default: 60)', default: 60 },
        { name: 'search', type: 'boolean', required: false, help: 'Enable Yuanbao internet search (default: true)', default: true },
        { name: 'think', type: 'boolean', required: false, help: 'Enable Yuanbao deep thinking (default: false)', default: false },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeout = kwargs.timeout;
        if (!Number.isInteger(timeout) || timeout < 1) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }
        const useSearch = normalizeBooleanFlag(kwargs.search, true);
        const useThink = normalizeBooleanFlag(kwargs.think, false);
        await ensureYuanbaoPage(page);
        if (await hasLoginGate(page)) {
            throw authRequired('Yuanbao opened a login gate before sending the prompt.');
        }
        await setYuanbaoInternetSearch(page, useSearch);
        await setYuanbaoDeepThink(page, useThink);
        const beforeAssistantMessages = await getYuanbaoAssistantMessages(page);
        const beforeLines = await getYuanbaoTranscriptLines(page);
        const sendResult = await sendYuanbaoMessage(page, prompt);
        if (!sendResult?.ok) {
            if (await hasLoginGate(page)) {
                throw authRequired('Yuanbao opened a login gate instead of accepting the prompt.');
            }
            throw sendFailure(sendResult?.reason, sendResult?.detail);
        }
        const response = await waitForYuanbaoResponse(page, beforeAssistantMessages.length, beforeLines, prompt, timeout);
        if (response === 'blocked') {
            throw authRequired('Yuanbao opened a login gate instead of returning a chat response.');
        }
        if (!response) {
            throw new TimeoutError('yuanbao ask', timeout, 'No Yuanbao response was observed before the timeout. Retry with --timeout, and verify the current browser session is still interactive.');
        }
        return [
            { Role: 'User', Text: prompt },
            { Role: 'Assistant', Text: response },
        ];
    },
});
export const __test__ = {
    collectYuanbaoTranscriptAdditions,
    convertYuanbaoHtmlToMarkdown,
    isOnYuanbao,
    normalizeBooleanFlag,
    pickLatestYuanbaoAssistantCandidate,
    sanitizeYuanbaoResponseText,
    updateStableState,
};
