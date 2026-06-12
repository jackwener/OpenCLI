/**
 * Xiaohongshu 点点 ask.
 *
 * Strategy note:
 * 点点 uses Xiaohongshu's signed in-page axios + longlink/HTTP fallback stack.
 * This adapter intentionally calls the site's own webpack conversation store
 * from an authenticated tab instead of replaying private signatures.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const XHS_WEB_HOST = 'www.xiaohongshu.com';
const ASK_COLUMNS = [
    'query',
    'answer',
    'source_count',
    'source_total_text',
    'sources_summary',
    'sources',
    'warning',
    'message_id',
    'conversation_id',
    'raw_sources',
    'source_error',
];

export function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

export function parseAskTimeout(raw) {
    const parsed = Number(raw ?? 90);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 180) {
        throw new ArgumentError(`--timeout must be an integer between 1 and 180, got ${JSON.stringify(raw)}`);
    }
    return parsed;
}

export function parseAskLimit(raw) {
    const parsed = Number(raw ?? 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
        throw new ArgumentError(`--source-limit must be an integer between 1 and 50, got ${JSON.stringify(raw)}`);
    }
    return parsed;
}

function cleanText(value) {
    return String(value ?? '')
        .replace(/<[^>]+>/g, '')
        .replace(/\u200b/g, '')
        .replace(/\r\n/g, '\n')
        .trim();
}

function compactSingleLine(value) {
    return cleanText(value).replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const text = compactSingleLine(value);
        if (text) return text;
    }
    return '';
}

function parseUrlMaybe(value) {
    if (!value) return null;
    try {
        return new URL(String(value));
    } catch {
        return null;
    }
}

function extractXsecToken(...values) {
    for (const value of values) {
        const url = parseUrlMaybe(value);
        const token = url?.searchParams.get('xsec_token') || url?.searchParams.get('xsecToken');
        if (token) return token;
    }
    return '';
}

function extractNoteId(source) {
    const directId = compactSingleLine(source?.id || source?.noteId || source?.note_id);
    if (/^[0-9a-f]{24}$/i.test(directId)) return directId;
    const candidates = [source?.textLink, source?.link, source?.url];
    for (const candidate of candidates) {
        const text = String(candidate || '');
        const match = text.match(/(?:\/item\/|\/(?:explore|search_result|note)\/)([0-9a-f]{24})(?=[?#/]|$)/i);
        if (match) return match[1];
    }
    return directId;
}

export function buildNoteUrl(noteId, xsecToken) {
    if (!noteId) return '';
    const url = new URL(`https://${XHS_WEB_HOST}/explore/${noteId}`);
    if (xsecToken) {
        url.searchParams.set('xsec_token', xsecToken);
        url.searchParams.set('xsec_source', '');
    }
    return url.toString();
}

function extractQuote(source) {
    const content = cleanText(source?.content);
    if (!content) return '';
    const origin = Array.isArray(source?.originLocation) ? source.originLocation : [];
    const start = Number(origin[0]);
    const length = Number(origin[1]);
    if (Number.isInteger(start) && start >= 0 && Number.isInteger(length) && length > 0) {
        return compactSingleLine(content.slice(start, start + length)).slice(0, 300);
    }
    return compactSingleLine(content).slice(0, 300);
}

export function normalizeAskSource(source, index) {
    const textLink = firstNonEmpty(source?.textLink, source?.link, source?.url);
    const noteId = extractNoteId(source);
    const xsecToken = extractXsecToken(source?.url, source?.textLink, source?.link);
    const normalized = {
        rank: index + 1,
        type: 'note',
        title: firstNonEmpty(source?.title, source?.displayTitle, source?.name),
        url: buildNoteUrl(noteId, xsecToken),
        note_id: noteId,
        xsec_token: xsecToken,
        author: firstNonEmpty(source?.nickName, source?.nickname, source?.author, source?.userName),
    };
    const quote = extractQuote(source);
    if (quote) normalized.quote = quote;
    if (textLink) normalized.deeplink = textLink;
    return normalized;
}

function buildSourcesSummary(sources) {
    return sources
        .slice(0, 5)
        .map((source) => `${source.rank}. ${source.title || source.note_id}${source.author ? ` - ${source.author}` : ''}`)
        .join('\n');
}

export function buildAskResult(raw) {
    const rawSources = Array.isArray(raw?.raw_sources) ? raw.raw_sources : [];
    const sources = rawSources
        .map((source, index) => normalizeAskSource(source, index))
        .filter((source) => source.note_id || source.title || source.url);
    const answer = cleanText(raw?.answer || raw?.base_info?.text || '');
    const sourceIssue = compactSingleLine(raw?.warning || raw?.source_error);
    const warning = sources.length === 0 && answer
        ? `Xiaohongshu 点点 returned an answer but no citation sources.${sourceIssue ? ` ${sourceIssue}` : ''}`
        : sourceIssue;
    return {
        query: compactSingleLine(raw?.query),
        answer,
        source_count: sources.length,
        source_total_text: compactSingleLine(raw?.source_total_text),
        sources_summary: buildSourcesSummary(sources),
        sources,
        warning,
        message_id: compactSingleLine(raw?.message_id),
        conversation_id: compactSingleLine(raw?.conversation_id),
    };
}

export function buildAskEvaluateJs(query, timeoutSeconds, sourceLimit) {
    const prompt = String(query);
    return `
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const timeoutMs = ${Number(timeoutSeconds)} * 1000;
        const sourceLimit = ${Number(sourceLimit)};
        const requestSourceSize = Math.max(sourceLimit, 10);
        const prompt = ${JSON.stringify(prompt)};
        const simplifyText = (value, max = 6000) => {
          const text = String(value || '');
          return text.length > max ? text.slice(0, max) : text;
        };
        const latestRound = (store, scenes, msgId) => {
          const rounds = typeof store.getSceneRounds === 'function'
            ? store.getSceneRounds(scenes.AiChat)
            : (Array.isArray(store.rounds) ? store.rounds : []);
          return [...rounds].reverse().find((round) => round?.aiMessage?.msgId === msgId)
            || [...rounds].reverse().find((round) => round?.userMessage?.text === prompt)
            || rounds[rounds.length - 1]
            || null;
        };
        const slimSource = (item) => ({
          id: item?.id || item?.noteId || item?.note_id || '',
          title: item?.title || item?.displayTitle || '',
          type: item?.type || '',
          noteType: item?.noteType || '',
          userId: item?.userId || '',
          nickName: item?.nickName || item?.nickname || '',
          content: simplifyText(item?.content || '', 2000),
          originLocation: item?.originLocation || null,
          textLink: item?.textLink || '',
          link: item?.link || item?.imageList?.[0]?.link || '',
          url: item?.url || '',
        });
        try {
          if (!window.webpackChunkxhs_pc_web) {
            return { ok: false, error: 'webpack_runtime_missing', page_url: location.href };
          }
          let webpackRequire;
          window.webpackChunkxhs_pc_web.push([[Date.now()], {}, (req) => { webpackRequire = req; }]);
          if (!webpackRequire) return { ok: false, error: 'webpack_require_unavailable', page_url: location.href };
          const mod = webpackRequire(6404);
          const useConversationStore = mod?.t;
          const scenes = mod?.G || { AiChat: 'aiChat' };
          if (typeof useConversationStore !== 'function') {
            return { ok: false, error: 'conversation_store_missing', page_url: location.href };
          }
          const store = useConversationStore();
          if (typeof store.sendMessage !== 'function' || typeof store.createConversation !== 'function') {
            return { ok: false, error: 'conversation_api_missing', page_url: location.href };
          }
          if (typeof store.switchScene === 'function') store.switchScene(scenes.AiChat);
          const conversationId = crypto.randomUUID();
          store.createConversation(conversationId, scenes.AiChat);
          const msgId = await store.sendMessage(conversationId, prompt, {
            skipImmediateUI: true,
            skipHistory: true,
            visible: false,
          });
          if (!msgId) {
            return { ok: false, error: 'send_message_failed', page_url: location.href };
          }

          const deadline = Date.now() + timeoutMs;
          let round = null;
          let finished = false;
          while (Date.now() < deadline) {
            await sleep(1000);
            round = latestRound(store, scenes, msgId);
            const answer = round?.aiMessage?.text || '';
            if (round?.aiMessage?.isFinished && answer) {
              finished = true;
              break;
            }
          }
          round = round || latestRound(store, scenes, msgId);
          const aiMessage = round?.aiMessage || {};
          const answer = aiMessage.text || (Array.isArray(aiMessage.dataFragments)
            ? aiMessage.dataFragments.map((fragment) => fragment?.text || '').join('')
            : '');
          if (!answer) {
            return { ok: false, error: 'answer_timeout', timeout_seconds: ${Number(timeoutSeconds)}, message_id: msgId, conversation_id: conversationId };
          }

          let detail = null;
          let sourceError = '';
          try {
            if (store.agent?.getResponseReferences) {
              for (let attempt = 0; attempt < 5; attempt++) {
              detail = await store.agent.getResponseReferences({
                query: prompt,
                message_id: msgId,
                page: 0,
                size: requestSourceSize,
                version: 0,
                result_version: 0,
                id: '',
              });
                if (Array.isArray(detail?.items) && detail.items.length > 0) break;
                await sleep(1000);
              }
            }
          } catch (err) {
            sourceError = String(err?.message || err || '');
          }

          const rawSources = Array.isArray(detail?.items) ? detail.items.slice(0, sourceLimit).map(slimSource) : [];
          return {
            ok: true,
            query: prompt,
            answer,
            source_total_text: detail?.baseInfo?.totalCnt || aiMessage?.querySource?.text || aiMessage?.querySource?.oneboxText || '',
            raw_sources: rawSources,
            source_error: sourceError || (finished ? '' : 'answer did not finish before timeout'),
            message_id: msgId,
            conversation_id: conversationId,
          };
        } catch (err) {
          return {
            ok: false,
            error: String(err?.message || err || 'unknown_error'),
            stack: String(err?.stack || '').slice(0, 1500),
            page_url: location.href,
          };
        }
      })()
    `;
}

function requirePrompt(query) {
    const prompt = String(query || '').trim();
    if (!prompt) throw new ArgumentError('query is required');
    return prompt;
}

function mapAskError(raw, timeoutSeconds) {
    const error = compactSingleLine(raw?.error);
    if (error === 'answer_timeout') {
        throw new TimeoutError('xiaohongshu ask', timeoutSeconds, '点点没有在超时时间内返回答案；可以重试或提高 --timeout。');
    }
    if (error === 'send_message_failed') {
        throw new AuthRequiredError(XHS_WEB_HOST, 'Xiaohongshu 点点 did not accept the query. Check login status for www.xiaohongshu.com.');
    }
    throw new CommandExecutionError(
        `xiaohongshu ask failed: ${error || 'unknown error'}`,
        raw?.page_url ? `Page URL: ${raw.page_url}` : undefined,
    );
}

export const command = cli({
    site: 'xiaohongshu',
    name: 'ask',
    access: 'write',
    description: 'Ask 小红书点点 and return the answer with citation sources.',
    domain: XHS_WEB_HOST,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Question for 点点' },
        { name: 'timeout', type: 'int', default: 90, help: 'Seconds to wait for the 点点 answer' },
        { name: 'source-limit', type: 'int', default: 10, help: 'Maximum citation sources to return' },
    ],
    columns: ASK_COLUMNS,
    func: async (page, kwargs) => {
        const query = requirePrompt(kwargs?.query);
        const timeout = parseAskTimeout(kwargs?.timeout);
        const sourceLimit = parseAskLimit(kwargs?.['source-limit']);
        const keyword = encodeURIComponent(query);
        await page.goto(`https://${XHS_WEB_HOST}/search_result?keyword=${keyword}&source=web_search_result_notes`);
        await page.wait?.(1);
        const raw = unwrapEvaluateResult(await page.evaluate(buildAskEvaluateJs(query, timeout, sourceLimit)));
        if (!raw || typeof raw !== 'object') {
            throw new CommandExecutionError('xiaohongshu ask returned a malformed page payload');
        }
        if (raw.ok === false) mapAskError(raw, timeout);
        return buildAskResult(raw);
    },
});
