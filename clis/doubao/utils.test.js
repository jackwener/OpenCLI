import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    __test__,
    collectDoubaoTranscriptAdditions,
    mergeTranscriptSnapshots,
    parseDoubaoConversationId,
    sendDoubaoMessage,
    waitForDoubaoResponse,
} from './utils.js';

function createPageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
        getCookies: vi.fn().mockResolvedValue([]),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({}),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(''),
        nativeType: vi.fn().mockResolvedValue(undefined),
        nativeKeyPress: vi.fn().mockResolvedValue(undefined),
    };
}

describe('parseDoubaoConversationId', () => {
    it('extracts the numeric id from a full conversation URL', () => {
        expect(parseDoubaoConversationId('https://www.doubao.com/chat/1234567890123')).toBe('1234567890123');
    });
    it('keeps a raw id unchanged', () => {
        expect(parseDoubaoConversationId('1234567890123')).toBe('1234567890123');
    });
});
describe('doubao send strategy', () => {
    it('prefers native CDP text insertion and button submission when a send button is available', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const nativeType = vi.mocked(page.nativeType);
        const nativeKeyPress = vi.mocked(page.nativeKeyPress);
        evaluate
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true, text: '你好' })
            .mockResolvedValueOnce({ hasText: true, text: '你好' })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ detected: false });
        const result = await sendDoubaoMessage(page, '你好');
        expect(nativeType).toHaveBeenCalledWith('你好');
        expect(nativeKeyPress).not.toHaveBeenCalled();
        expect(result).toBe('button');
    });
    it('falls back to DOM insertion when native insertion does not update the composer', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const nativeType = vi.mocked(page.nativeType);
        evaluate
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: false, text: '' })
            .mockResolvedValueOnce({ hasText: false, text: '' })
            .mockResolvedValueOnce({ hasText: true, text: '你好' })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ detected: false });
        const result = await sendDoubaoMessage(page, '你好');
        expect(nativeType).toHaveBeenCalledWith('你好');
        expect(evaluate).toHaveBeenCalledTimes(7);
        expect(result).toBe('button');
    });
    it('falls back to DOM insertion when native insertion text does not match the requested prompt', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true, text: '你' })
            .mockResolvedValueOnce({ hasText: true, text: '你好' })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ detected: false });
        const result = await sendDoubaoMessage(page, '你好');
        expect(result).toBe('button');
    });
    it('falls back to native Enter when no clickable submit button is found', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const nativeKeyPress = vi.mocked(page.nativeKeyPress);
        evaluate
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true, text: '你好' })
            .mockResolvedValueOnce({ hasText: true, text: '你好' })
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce({ detected: false });
        const result = await sendDoubaoMessage(page, '你好');
        expect(nativeKeyPress).toHaveBeenCalledWith('Enter');
        expect(result).toBe('enter');
    });
    it('does not throw verification errors just because the prompt mentions verification terms', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true, text: '请解释 CAPTCHA verification 是什么' })
            .mockResolvedValueOnce({ hasText: true, text: '请解释 CAPTCHA verification 是什么' })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ detected: false, reason: '' });
        await expect(sendDoubaoMessage(page, '请解释 CAPTCHA verification 是什么')).resolves.toBe('button');
    });
    it('does not throw verification errors for ordinary chinese prompts mentioning security terms', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true, text: '请解释人机验证和完成安全验证的区别' })
            .mockResolvedValueOnce({ hasText: true, text: '请解释人机验证和完成安全验证的区别' })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ detected: false, reason: '' });
        await expect(sendDoubaoMessage(page, '请解释人机验证和完成安全验证的区别')).resolves.toBe('button');
    });
    it('throws a command error when Doubao shows a verification challenge after submit', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ hasText: true, text: '你好' })
            .mockResolvedValueOnce({ hasText: true, text: '你好' })
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce({ detected: true, reason: '请完成安全验证' });
        await expect(sendDoubaoMessage(page, '你好')).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
describe('collectDoubaoTranscriptAdditions', () => {
    it('ignores landing-page capability chips that are not assistant content', () => {
        const before = ['older'];
        const current = [
            'older',
            '测试一下，只回复OK快速视频生成深入研究图像生成帮我写作音乐生成更多',
            '测试一下，只回复OK',
        ];
        expect(collectDoubaoTranscriptAdditions(before, current, '测试一下，只回复OK')).toBe('');
    });
    it('filters prompt-contaminated chip lines for arbitrary prompts', () => {
        const before = ['older'];
        const current = [
            'older',
            '你好快速视频生成深入研究图像生成帮我写作音乐生成更多',
        ];
        expect(collectDoubaoTranscriptAdditions(before, current, '你好')).toBe('');
    });
    it('filters whitespace-normalized multiline prompt echoes and prompt-plus-chip artifacts', () => {
        const before = ['older'];
        const prompt = '第一行\n第二行';
        expect(collectDoubaoTranscriptAdditions(before, ['older', '第一行 第二行'], prompt)).toBe('');
        expect(collectDoubaoTranscriptAdditions(before, ['older', '第一行 第二行快速视频生成深入研究图像生成帮我写作音乐生成更多'], prompt)).toBe('');
    });
    it('keeps legitimate replies that discuss Doubao features', () => {
        const before = ['older'];
        const current = [
            'older',
            '图像生成和音乐生成目前都支持，但适用场景不同。',
        ];
        expect(collectDoubaoTranscriptAdditions(before, current, 'irrelevant prompt')).toBe('图像生成和音乐生成目前都支持，但适用场景不同。');
    });
    it('keeps an exact chip string when it is the assistant reply rather than prompt contamination', () => {
        const before = ['older'];
        const current = [
            'older',
            '快速视频生成深入研究图像生成帮我写作音乐生成更多',
        ];
        expect(collectDoubaoTranscriptAdditions(before, current, '测试一下，只回复OK')).toBe('快速视频生成深入研究图像生成帮我写作音乐生成更多');
    });
    it('filters combined sidebar chrome that appears as a new transcript line', () => {
        const before = ['older'];
        const current = [
            'older',
            'AI 创作云盘更多历史对话',
        ];
        expect(collectDoubaoTranscriptAdditions(before, current, '测试一下，只回复OK')).toBe('');
    });
    it('filters transcript lines that only differ because the prompt was appended to existing page chrome', () => {
        const before = [
            '有什么我能帮你的吗？资讯：韩国三大运营商允许超流量用基本数据服务快速视频生成深入研究图像生成帮我写作音乐生成更多',
        ];
        const current = [
            '有什么我能帮你的吗？资讯：韩国三大运营商允许超流量用基本数据服务快速视频生成深入研究图像生成帮我写作音乐生成更多测试一下，只回复OK',
        ];
        expect(collectDoubaoTranscriptAdditions(before, current, '测试一下，只回复OK', (value) => value.replace('测试一下，只回复OK', '').trim())).toBe('');
    });
    it('treats only the exact landing-page chip string as UI noise', () => {
        expect(__test__.clickSendButtonScript()).not.toContain('document,');
        expect(__test__.clickSendButtonScript()).toContain('bestScore >= 200');
        expect(__test__.clickSendButtonScript()).not.toContain("|| !!button.closest('.chat-input-button')");
        expect(__test__.clickSendButtonScript()).toContain("button.getAttribute('type') === 'submit') score += 1200");
        expect(__test__.composerStateScript()).toContain("(composer.innerText || '').trim() || (composer.textContent || '').trim()");
        expect(__test__.detectDoubaoVerificationScript()).not.toContain('document.body?.innerText');
        expect(__test__.detectDoubaoVerificationScript()).not.toContain('[class*=\"verify\"]');
        expect(__test__.detectDoubaoVerificationScript()).not.toContain('[class*=\"captcha\"]');
        expect(__test__.detectDoubaoVerificationScript()).not.toContain('document.body?.children');
    });
});
describe('waitForDoubaoResponse', () => {
    it('allows transcript fallback on local chat urls when new transcript lines appear', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        const wait = vi.mocked(page.wait);
        evaluate
            .mockResolvedValueOnce({ detected: false })
            .mockResolvedValueOnce('https://www.doubao.com/chat/local_123')
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce('https://www.doubao.com/chat/local_123')
            .mockResolvedValueOnce(['older', '真正的回答']);
        const result = await waitForDoubaoResponse(page, ['older'], [], '测试一下，只回复OK', 2);
        expect(wait).toHaveBeenCalled();
        expect(result).toBe('真正的回答');
    });
    it('does not suppress assistant turns that happen to match landing-page chip text', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate
            .mockResolvedValueOnce({ detected: false })
            .mockResolvedValueOnce('https://www.doubao.com/chat')
            .mockResolvedValueOnce([
            { Role: 'Assistant', Text: '快速视频生成深入研究图像生成帮我写作音乐生成更多' },
        ]);
        const result = await waitForDoubaoResponse(page, [], [], '测试一下，只回复OK', 2);
        expect(result).toBe('快速视频生成深入研究图像生成帮我写作音乐生成更多');
    });
    it('raises a command error when a verification challenge appears during polling', async () => {
        const page = createPageMock();
        const evaluate = vi.mocked(page.evaluate);
        evaluate.mockResolvedValueOnce({ detected: true, reason: '请完成安全验证' });
        await expect(waitForDoubaoResponse(page, [], [], '你好', 2)).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
describe('mergeTranscriptSnapshots', () => {
    it('extends the transcript when the next snapshot overlaps with the tail', () => {
        const merged = mergeTranscriptSnapshots('Alice 00:00\nHello team\nBob 00:05\nHi', 'Bob 00:05\nHi\nAlice 00:10\nNext topic');
        expect(merged).toBe('Alice 00:00\nHello team\nBob 00:05\nHi\nAlice 00:10\nNext topic');
    });
    it('does not duplicate a snapshot that is already contained in the transcript', () => {
        const merged = mergeTranscriptSnapshots('Alice 00:00\nHello team\nBob 00:05\nHi', 'Bob 00:05\nHi');
        expect(merged).toBe('Alice 00:00\nHello team\nBob 00:05\nHi');
    });
    it('keeps both windows when a virtualized panel returns adjacent chunks without full history', () => {
        const merged = mergeTranscriptSnapshots('Alice 00:00\nHello team\nBob 00:05\nHi', 'Alice 00:10\nNext topic\nBob 00:15\nAction items');
        expect(merged).toBe('Alice 00:00\nHello team\nBob 00:05\nHi\nAlice 00:10\nNext topic\nBob 00:15\nAction items');
    });
});
