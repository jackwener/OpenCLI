import { describe, expect, it, vi } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
    buildAskResult,
    buildAskEvaluateJs,
    buildNoteUrl,
    normalizeAskSource,
    parseAskLimit,
    parseAskTimeout,
} from './ask.js';
import './ask.js';

function createPageMock(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('xiaohongshu ask', () => {
    it('registers as a browser-backed write command with clean audit columns', () => {
        const cmd = getRegistry().get('xiaohongshu/ask');
        expect(cmd).toMatchObject({
            site: 'xiaohongshu',
            name: 'ask',
            access: 'write',
            strategy: Strategy.COOKIE,
            browser: true,
            navigateBefore: false,
        });
        expect(cmd.columns).toEqual([
            'query',
            'answer',
            'source_count',
            'source_total_text',
            'sources_summary',
            'sources',
            'warning',
            'message_id',
            'conversation_id',
        ]);
    });

    it('rejects invalid timeout and source-limit values', () => {
        expect(() => parseAskTimeout(0)).toThrow('--timeout');
        expect(() => parseAskTimeout(181)).toThrow('--timeout');
        expect(() => parseAskTimeout('1e2')).toThrow('--timeout');
        expect(() => parseAskTimeout(' 30 ')).toThrow('--timeout');
        expect(() => parseAskLimit(0)).toThrow('--source-limit');
        expect(() => parseAskLimit(51)).toThrow('--source-limit');
        expect(() => parseAskLimit('1e1')).toThrow('--source-limit');
        expect(() => parseAskLimit(' 10 ')).toThrow('--source-limit');
    });

    it('normalizes note sources while keeping xsec_token separate from terminal summary', () => {
        const source = normalizeAskSource({
            id: '69d6fc08000000001f007646',
            title: '新手露营有哪些建议？',
            nickName: '郑小喜',
            type: 'note',
            noteType: 'normal',
            textLink: 'xhsdiscover://item/69d6fc08000000001f007646?xsec_token=tok%20123',
            content: '第一次露营踩了不少坑，整理了这份清单，新手可以直接参考。',
            originLocation: [0, 10],
        }, 0);

        expect(source).toEqual({
            rank: 1,
            type: 'note',
            title: '新手露营有哪些建议？',
            url: 'https://www.xiaohongshu.com/explore/69d6fc08000000001f007646?xsec_token=tok+123&xsec_source=',
            note_id: '69d6fc08000000001f007646',
            xsec_token: 'tok 123',
            author: '郑小喜',
            note_type: 'normal',
            quote: '第一次露营踩了不少坑',
            deeplink: 'xhsdiscover://item/69d6fc08000000001f007646?xsec_token=tok%20123',
        });
    });

    it('forwards 点点 engagement metadata (like_count, user_id, published_at, note_type)', () => {
        const source = normalizeAskSource({
            id: '69d6fc08000000001f007646',
            title: '国产猫粮怎么选',
            nickName: '杨Sir宠物圈',
            noteType: 'video',
            userId: '589a982f3460',
            time: '04-22',
            like: 132,
            textLink: 'xhsdiscover://item/69d6fc08000000001f007646',
        }, 0);

        expect(source).toMatchObject({
            note_id: '69d6fc08000000001f007646',
            note_type: 'video',
            like_count: 132,
            user_id: '589a982f3460',
            published_at: '04-22',
        });
    });

    it('parses 万 / 亿 like strings into integers and drops empty engagement', () => {
        expect(normalizeAskSource({ id: '69d6fc08000000001f007646', like: '1.2万' }, 0).like_count).toBe(12000);
        expect(normalizeAskSource({ id: '69d6fc08000000001f007646', like: '1,234+' }, 0).like_count).toBe(1234);
        expect(normalizeAskSource({ id: '69d6fc08000000001f007646', like: '' }, 0)).not.toHaveProperty('like_count');
        expect(normalizeAskSource({ id: '69d6fc08000000001f007646' }, 0)).not.toHaveProperty('user_id');
    });

    it('does not coerce malformed like counts into source metadata', () => {
        const malformedLikes = ['1e2', '0x10', '-1', '1.5', '1..2万', '1,23'];
        for (const like of malformedLikes) {
            expect(normalizeAskSource({ id: '69d6fc08000000001f007646', like }, 0)).not.toHaveProperty('like_count');
        }
        expect(normalizeAskSource({ id: '69d6fc08000000001f007646', like: -1 }, 0)).not.toHaveProperty('like_count');
        expect(normalizeAskSource({ id: '69d6fc08000000001f007646', like: 1.5 }, 0)).not.toHaveProperty('like_count');
    });

    it('builds a bare note URL when 点点 source data has no xsec token', () => {
        expect(buildNoteUrl('69d6fc08000000001f007646', '')).toBe(
            'https://www.xiaohongshu.com/explore/69d6fc08000000001f007646',
        );
    });

    it('does not project untrusted citation links into source URLs or deeplinks', () => {
        const source = normalizeAskSource({
            id: 'not-a-note-id',
            title: '来源标题',
            textLink: 'https://evil.example/explore/69d6fc08000000001f007646?xsec_token=leak',
            url: 'javascript:alert(1)',
        }, 0);

        expect(source).toMatchObject({
            note_id: '',
            url: '',
            xsec_token: '',
            title: '来源标题',
        });
        expect(source).not.toHaveProperty('deeplink');
    });

    it('uses direct note identity while ignoring untrusted token links', () => {
        const source = normalizeAskSource({
            id: '69d6fc08000000001f007646',
            title: '来源标题',
            textLink: 'https://evil.example/explore/69d6fc08000000001f007646?xsec_token=leak',
        }, 0);

        expect(source).toMatchObject({
            note_id: '69d6fc08000000001f007646',
            url: 'https://www.xiaohongshu.com/explore/69d6fc08000000001f007646',
            xsec_token: '',
        });
        expect(source).not.toHaveProperty('deeplink');
    });

    it('keeps answer output successful when no citation sources are returned', () => {
        const result = buildAskResult({
            query: '上海露营需要注意什么？',
            answer: '注意天气和营地规则。',
            sources: [],
            source_total_text: '',
            message_id: 'mid',
            conversation_id: 'cid',
        });

        expect(result).toMatchObject({
            answer: '注意天气和营地规则。',
            source_count: 0,
            sources: [],
            warning: expect.stringContaining('no citation sources'),
        });
    });


    it('runs the page evaluate path and normalizes returned sources', async () => {
        const cmd = getRegistry().get('xiaohongshu/ask');
        const page = createPageMock({
            ok: true,
            query: '上海露营需要注意什么？',
            answer: '答案正文',
            source_total_text: 'ai总结54篇笔记生成',
            sources: [
                {
                    id: '69d6fc08000000001f007646',
                    title: '来源标题',
                    nickName: '作者A',
                    content: '引用片段来自笔记正文',
                    originLocation: [0, 4],
                    textLink: 'xhsdiscover://item/69d6fc08000000001f007646',
                },
            ],
            message_id: '7650435070293180448$prod',
            conversation_id: 'conversation-id',
        });

        const result = await cmd.func(page, { query: '上海露营需要注意什么？', timeout: 30, 'source-limit': 10 });

        // 点点's own page, never search_result?keyword=... — that URL costs a real
        // note search on load and is the pattern #1224 tied to security verification.
        expect(page.goto).toHaveBeenCalledWith('https://www.xiaohongshu.com/ai_chat');
        expect(page.goto).not.toHaveBeenCalledWith(expect.stringContaining('search_result'));
        expect(page.evaluate.mock.calls[0][0]).toContain('window.webpackChunkxhs_pc_web');
        expect(result).toMatchObject({
            answer: '答案正文',
            source_count: 1,
            source_total_text: 'ai总结54篇笔记生成',
            sources_summary: '1. 来源标题 - 作者A',
            sources: [
                {
                    rank: 1,
                    title: '来源标题',
                    author: '作者A',
                    note_id: '69d6fc08000000001f007646',
                    xsec_token: '',
                },
            ],
            message_id: '7650435070293180448$prod',
            conversation_id: 'conversation-id',
        });
        expect(result).not.toHaveProperty('raw_sources');
        expect(result).not.toHaveProperty('source_error');
    });

    it('fails closed when the page returns ok without answer identity', async () => {
        const cmd = getRegistry().get('xiaohongshu/ask');
        const page = createPageMock({
            ok: true,
            query: '上海露营需要注意什么？',
            answer: '',
            sources: [],
            message_id: '',
            conversation_id: 'conversation-id',
        });

        await expect(cmd.func(page, { query: '上海露营需要注意什么？', timeout: 30, 'source-limit': 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps unfinished answer polling to timeout instead of partial success', async () => {
        const cmd = getRegistry().get('xiaohongshu/ask');
        const page = createPageMock({
            ok: false,
            error: 'answer_timeout',
            timeout_seconds: 1,
            message_id: 'mid',
            conversation_id: 'cid',
        });

        await expect(cmd.func(page, { query: '上海露营需要注意什么？', timeout: 1, 'source-limit': 10 }))
            .rejects.toBeInstanceOf(TimeoutError);

        const script = buildAskEvaluateJs('上海露营需要注意什么？', 1, 10);
        expect(script).toContain('if (!finished || !answer)');
        expect(script).not.toContain('answer did not finish before timeout');
    });

    it('resets the 点点 scene and only accepts the sent message id on retry', () => {
        const script = buildAskEvaluateJs('上海露营需要注意什么？', 30, 10);
        const resetIndex = script.indexOf('clearConversation');
        const sendIndex = script.indexOf('store.sendMessage(conversationId');
        expect(resetIndex).toBeGreaterThan(0);
        expect(sendIndex).toBeGreaterThan(0);
        expect(resetIndex).toBeLessThan(sendIndex);
        expect(script).toContain('await Promise.resolve(store.clearConversation(scenes.AiChat))');
        expect(script).not.toContain('userMessage?.text === prompt');
        expect(script).not.toContain('rounds[rounds.length - 1]');
    });
});

// Executes the generated page script against a fake webpack runtime, so the module
// lookup is exercised for real rather than asserted as a substring. The point is the
// module id: Xiaohongshu renumbers chunks on redeploys (6404 -> 32914 broke every ask),
// so the lookup has to survive an id nobody has seen before.
async function runAskScriptAgainstFakeRuntime({ moduleId, answer = '答案正文' }) {
    const msgId = 'msg-1';
    const store = {
        switchScene: () => {},
        clearConversation: () => {},
        createConversation: () => {},
        sendMessage: async () => msgId,
        getSceneRounds: () => [{ aiMessage: { msgId, isFinished: true, text: answer } }],
        agent: {
            getResponseReferences: async () => ({
                baseInfo: { totalCnt: 'ai总结7篇笔记生成' },
                items: [{ id: '69d6fc08000000001f007646', title: '来源标题', nickName: '作者A' }],
            }),
        },
    };
    // toString() of this factory carries the fingerprint the scan looks for.
    const conversationFactory = () => ({ marker: 'createConversation sendMessage' });
    const decoyFactory = () => ({ marker: 'unrelated module' });
    // moduleId === null models a build where the store is simply not present at all.
    const exportsById = moduleId === null
        ? {}
        : { [moduleId]: { t: () => store, G: { AiChat: 'aiChat', Onebox: 'onebox' } } };
    const webpackRequire = (id) => {
        if (!(id in exportsById)) throw new TypeError("Cannot read properties of undefined (reading 'call')");
        return exportsById[id];
    };
    webpackRequire.m = moduleId === null
        ? { 4242: decoyFactory }
        : { 4242: decoyFactory, [moduleId]: conversationFactory };

    const priorWindow = globalThis.window;
    const priorLocation = globalThis.location;
    globalThis.window = {
        webpackChunkxhs_pc_web: { push: ([, , cb]) => cb(webpackRequire) },
    };
    globalThis.location = { href: 'https://www.xiaohongshu.com/ai_chat' };
    try {
        return await (0, eval)(buildAskEvaluateJs('测试问题', 5, 5));
    } finally {
        globalThis.window = priorWindow;
        globalThis.location = priorLocation;
    }
}

describe('xiaohongshu ask conversation-store lookup', () => {
    it('uses the known module id when the build still has it', async () => {
        const result = await runAskScriptAgainstFakeRuntime({ moduleId: 32914 });
        expect(result).toMatchObject({ ok: true, answer: '答案正文' });
        expect(result.sources).toHaveLength(1);
    });

    it('still finds the store after Xiaohongshu renumbers the chunk', async () => {
        // An id in neither the known list nor any previous build.
        const result = await runAskScriptAgainstFakeRuntime({ moduleId: 778899 });
        expect(result).toMatchObject({ ok: true, answer: '答案正文' });
    });

    it('reports conversation_store_missing when no module matches, instead of throwing', async () => {
        const result = await runAskScriptAgainstFakeRuntime({ moduleId: null });
        expect(result).toMatchObject({ ok: false, error: 'conversation_store_missing' });
    });
});
