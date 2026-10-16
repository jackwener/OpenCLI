import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    __test__,
    collectDoubaoTranscriptAdditions,
    getDoubaoConversationList,
    getDoubaoPageState,
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
describe('doubao conversation list (history)', () => {
    // Drives the real sidebar extraction script through the real
    // getDoubaoConversationList() so the asserted shape is exactly what
    // `opencli doubao history` prints (Id / Title / Url).
    async function listFromHtml(html) {
        const dom = new JSDOM(html, { url: 'https://www.doubao.com/chat', runScripts: 'outside-only' });
        const page = createPageMock();
        vi.mocked(page.evaluate).mockImplementation(async (script) => (script === 'window.location.href'
            ? 'https://www.doubao.com/chat'
            : dom.window.eval(script)));
        return getDoubaoConversationList(page);
    }

    // 对话形态 fixture 来自历史版本、未经现网验证（本机账号只能进入工作形态，
    // 无法对对话形态做端到端验证）。结构取自本文件既有的 2026-05 DOM 片段：
    // 会话项本身就是 <a data-testid="chat_list_thread_item" href="/chat/<id>">。
    const conversationSkinSidebar = `
      <div data-testid="flow_chat_sidebar">
        <a data-testid="chat_list_thread_item" href="/chat/1234567890123">Weekly Sync</a>
        <a data-testid="chat_list_thread_item" href="/chat/9876543210987">Sprint 计划</a>
      </div>
    `;

    // Live DOM sample from a Doubao Work sidebar (2026-10-16). The sidebar root
    // [data-testid="flow_chat_sidebar"] is unchanged, but each conversation is a
    // div[data-testid="conversation-list-v2-item"] — NOT an <a> — carrying
    // data-conversation-id, wrapped in its own <a href="/chat/<id>"> PARENT
    // (the anchor is an ancestor, not a descendant), while the title is the item
    // text.
    const doubaoWorkSkinSidebar = `
      <div data-testid="flow_chat_sidebar">
        <div data-testid="chat_list_wrapper">
          <div data-testid="conversation-section">
            <a href="/chat/46370507058831106">
              <div data-testid="conversation-list-v2-item" data-conversation-id="46370507058831106">
                季度复盘会议纪要季度复盘会议纪要季度复盘会议纪要
                <button data-testid="chat_list_item_more_button"></button>
              </div>
            </a>
            <a href="/chat/46370507058842882">
              <div data-testid="conversation-list-v2-item" data-conversation-id="46370507058842882">
                新工作任务
                <button data-testid="chat_list_item_more_button"></button>
              </div>
            </a>
          </div>
        </div>
      </div>
    `;

    it('keeps the Doubao Work sidebar item selector alongside the conversation-skin one', () => {
        const listScript = __test__.getConversationListScript();
        expect(listScript).toContain('a[data-testid="chat_list_thread_item"]');
        expect(listScript).toContain('[data-testid="conversation-list-v2-item"]');
        expect(listScript).toContain('[data-testid="flow_chat_sidebar"]');
    });

    it('lists conversations from the conversation-skin sidebar', async () => {
        expect(await listFromHtml(conversationSkinSidebar)).toEqual([
            {
                Id: '1234567890123',
                Title: 'Weekly Sync',
                Url: 'https://www.doubao.com/chat/1234567890123',
            },
            {
                Id: '9876543210987',
                Title: 'Sprint 计划',
                Url: 'https://www.doubao.com/chat/9876543210987',
            },
        ]);
    });

    it('lists conversations from the Doubao Work sidebar, taking the id from the item itself', async () => {
        // Guards: the item must stay a div without the legacy testid and carry
        // data-conversation-id, and the anchor must sit ABOVE it — otherwise this
        // fixture would not exercise the live div/parent-anchor shape at all.
        expect(doubaoWorkSkinSidebar).toContain('data-testid="conversation-list-v2-item"');
        expect(doubaoWorkSkinSidebar).toContain('data-conversation-id="46370507058831106"');
        expect(doubaoWorkSkinSidebar).not.toContain('chat_list_thread_item');
        expect(doubaoWorkSkinSidebar).not.toContain('inner-link');

        expect(await listFromHtml(doubaoWorkSkinSidebar)).toEqual([
            {
                Id: '46370507058831106',
                Title: '季度复盘会议纪要',
                Url: 'https://www.doubao.com/chat/46370507058831106',
            },
            {
                Id: '46370507058842882',
                Title: '新工作任务',
                Url: 'https://www.doubao.com/chat/46370507058842882',
            },
        ]);
    });

    // Cross-skin mismatch guards. Both skins share the same URL and the same
    // [data-testid="flow_chat_sidebar"] root, so a selector added for one skin is
    // only safe if it cannot pick up the other skin's markup. Each fixture is run
    // through the combined script and its rows pinned: a selector that starts
    // matching across skins shows up as an added, dropped or duplicated row.

    it('does not let the Doubao Work selector misread a conversation-skin sidebar', async () => {
        expect(conversationSkinSidebar).not.toContain('conversation-list-v2-item');
        expect(await listFromHtml(conversationSkinSidebar)).toHaveLength(2);
    });

    it('does not let the conversation-skin selector misread a Doubao Work sidebar', async () => {
        expect(doubaoWorkSkinSidebar).not.toContain('chat_list_thread_item');
        expect(await listFromHtml(doubaoWorkSkinSidebar)).toHaveLength(2);
    });

    it('returns no conversations when the sidebar holds only chrome', async () => {
        expect(await listFromHtml(`
          <div data-testid="flow_chat_sidebar">
            <div data-testid="chat_list_wrapper">
              <div data-testid="conversation-section"></div>
            </div>
          </div>
        `)).toEqual([]);
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
describe('doubao receive strategy', () => {
    function runTurnsScript(html) {
        const dom = new JSDOM(html, { url: 'https://www.doubao.com/chat', runScripts: 'outside-only' });
        Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
            configurable: true,
            get() {
                return this.textContent || '';
            },
        });
        dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
            width: 100,
            height: 24,
            top: 0,
            left: 0,
            right: 100,
            bottom: 24,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
        return dom.window.eval(__test__.getTurnsScript());
    }

    it('keeps both the new skin selectors and the older structural fallbacks in the turns script', () => {
        const turnsScript = __test__.getTurnsScript();
        expect(turnsScript).toContain('[class*="message-list-"]');
        expect(turnsScript).toContain('.container-PvPoAn');
        expect(turnsScript).toContain('[data-testid="message-list"]');
        expect(turnsScript).toContain('[class*="bg-g-receive-msg-bubble"]');
        expect(turnsScript).toContain('[data-testid="receive_message"]');
        expect(turnsScript).toContain('[data-foundation-type="receive-message-action-bar"]');
        expect(turnsScript).toContain('[data-testid="union_message"]');
        expect(turnsScript).toContain('[data-testid="message-block-container"]');
    });

    it('includes the 2026-05 doubao DOM-refactor inner-item / top-item wrappers and the flow-markdown-body assistant fallback', () => {
        const turnsScript = __test__.getTurnsScript();
        // New wrappers added to itemSelectors so message roots resolve under the
        // refactored DOM where the legacy item-kDun2N / union_message / message-block-container
        // / data-message-id selectors no longer match.
        expect(turnsScript).toContain('[class*="inner-item-"]');
        expect(turnsScript).toContain('[class*="top-item-"]');
        // Assistant fallback: post-refactor doubao no longer emits receive-message /
        // bg-g-receive-msg-bubble markup. Only signal is .flow-markdown-body content
        // container without send-bubble.
        expect(turnsScript).toContain('.flow-markdown-body');
        expect(turnsScript).toContain('.md-box-root');
    });

    it('extracts clean assistant turns from the 2026-05 wrapper DOM without using whole-page chrome', () => {
        const turns = runTurnsScript(`
          <main>
            <aside>历史对话</aside>
            <section class="message-list-S2Fv2S">
              <div class="top-item-user">
                <div class="inner-item-user">
                  <div class="bg-g-send-msg-bubble">测试一下，只回复OK</div>
                </div>
              </div>
              <div class="top-item-assistant">
                <div class="inner-item-assistant">
                  <div class="flow-markdown-body"><p>OK</p></div>
                </div>
              </div>
            </section>
          </main>
        `);

        expect(turns).toEqual([
            { Role: 'User', Text: '测试一下，只回复OK' },
            { Role: 'Assistant', Text: 'OK' },
        ]);
    });

    it('extracts turns from the current hashed message list and markdown box DOM', () => {
        const turns = runTurnsScript(`
          <main>
            <aside>历史对话</aside>
            <section class="message-list-zLoNs1 opacity-100">
              <div class="top-item-bAlX0F"></div>
              <div class="inner-item-BjaxFt">
                <div data-message-id="46370507058831106" class="flex-row flex w-full justify-end">
                  <div class="bg-g-send-msg-bubble-bg">请联网查找太原红星天铂</div>
                </div>
              </div>
              <div class="inner-item-BjaxFt">
                <div data-message-id="46370507058842882" class="relative flex-row flex w-full">
                  <div class="container-qX9Csx md-box-root"><h3>太原红星天铂公开信息整理</h3><p>项目位于南内环东街与东中环交汇处东北角。</p></div>
                </div>
              </div>
            </section>
          </main>
        `);

        expect(turns).toEqual([
            { Role: 'User', Text: '请联网查找太原红星天铂' },
            { Role: 'Assistant', Text: '太原红星天铂公开信息整理项目位于南内环东街与东中环交汇处东北角。' },
        ]);
    });

    it('does not let a stale hidden hashed message list mask the visible current one', () => {
        const turns = runTurnsScript(`
          <main>
            <section class="message-list-old" style="display:none">
              <div class="inner-item-old">
                <div class="bg-g-send-msg-bubble-bg">旧问题</div>
              </div>
            </section>
            <section class="message-list-current">
              <div class="inner-item-current">
                <div class="bg-g-send-msg-bubble-bg">当前问题</div>
              </div>
              <div class="inner-item-current">
                <div class="md-box-root"><p>当前回答</p></div>
              </div>
            </section>
          </main>
        `);

        expect(turns).toEqual([
            { Role: 'User', Text: '当前问题' },
            { Role: 'Assistant', Text: '当前回答' },
        ]);
    });

    it('extends transcript-noise cleanup for the current zh-CN chrome copy', () => {
        const transcriptScript = __test__.getTranscriptLinesScript();
        expect(transcriptScript).toContain('请仔细甄别');
        expect(transcriptScript).toContain('下载电脑版');
    });

    // ---------------------------------------------------------------------
    // Doubao Work ("豆包工作") skin.
    //
    // Enterprise accounts land on a page whose URL is identical to the
    // conversation skin, so the two can only be told apart by DOM shape.
    // Doubao Work keeps the [data-testid="message-list"] /
    // [data-testid="union_message"] item roots, but renders bubbles as
    // [data-testid="send_message"] / [data-testid="receive_message"] with the
    // text in [data-testid="message_text_content"] — the same three testids
    // getConversationDetailScript() reads.
    // ---------------------------------------------------------------------

    // Live DOM sample from a Doubao Work conversation (2026-10-16): the message
    // list is a virtual list (v_list_*), each row wraps one union_message.
    const doubaoWorkSkin = `
      <main>
        <aside>最近</aside>
        <section data-testid="message-list" class="v_list-D34x3M">
          <div class="scroller v_list_scroller-BxcoIX">
            <div class="scroller_content">
              <div class="list_items">
                <div class="v_list_row">
                  <div data-testid="union_message" class="w-full inner-item-BjaxFt">
                    <div data-testid="message-block-container" class="w-full">
                      <div data-testid="send_message">
                        <div data-testid="message_text_content">1+1 等于几？只回答一个数字。</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="v_list_row">
                  <div data-testid="union_message" class="w-full inner-item-BjaxFt">
                    <div data-testid="message-block-container" data-reply-message="true" class="w-full">
                      <div data-testid="receive_message">
                        <div data-testid="message_text_content">2</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;

    // 对话形态 fixture 来自历史版本、未经现网验证（本机账号只能进入工作形态，
    // 无法对对话形态做端到端验证）。它取自本文件既有的 2026-05 DOM 片段。
    const conversationSkin = `
      <main>
        <aside>历史对话</aside>
        <section class="message-list-S2Fv2S">
          <div class="top-item-user">
            <div class="inner-item-user">
              <div class="bg-g-send-msg-bubble">测试一下，只回复OK</div>
            </div>
          </div>
          <div class="top-item-assistant">
            <div class="inner-item-assistant">
              <div class="flow-markdown-body"><p>OK</p></div>
            </div>
          </div>
        </section>
      </main>
    `;

    it('keeps the Doubao Work bubble testids in the turns script', () => {
        const turnsScript = __test__.getTurnsScript();
        expect(turnsScript).toContain('[data-testid="send_message"]');
        expect(turnsScript).toContain('[data-testid="receive_message"]');
        expect(turnsScript).toContain('[data-testid="message_text_content"]');
        expect(turnsScript).toContain('[data-testid="union_message"]');
    });

    it('extracts user and assistant turns from the Doubao Work skin', () => {
        expect(runTurnsScript(doubaoWorkSkin)).toEqual([
            { Role: 'User', Text: '1+1 等于几？只回答一个数字。' },
            { Role: 'Assistant', Text: '2' },
        ]);
    });

    // Cross-skin mismatch guards. Adding a second skin's selectors to a shared
    // candidate list is only safe if neither skin's markup can be picked up by
    // the other skin's path, so each fixture is run through the combined script
    // and the exact turns are pinned: a selector that starts matching across
    // skins shows up as an added, dropped, or relabelled turn.

    it('does not let the Doubao Work path misread a conversation-skin fixture', () => {
        // Guard: the fixture must not carry Doubao Work markers, otherwise this
        // test would not exercise the cross-skin path at all.
        expect(conversationSkin).not.toContain('send_message');
        expect(conversationSkin).not.toContain('receive_message');
        expect(conversationSkin).not.toContain('message_text_content');

        expect(runTurnsScript(conversationSkin)).toEqual([
            { Role: 'User', Text: '测试一下，只回复OK' },
            { Role: 'Assistant', Text: 'OK' },
        ]);
    });

    it('does not let the conversation-skin path misread a Doubao Work fixture', () => {
        // Guard: the fixture must not carry conversation-skin markers.
        expect(doubaoWorkSkin).not.toContain('bg-g-send-msg-bubble');
        expect(doubaoWorkSkin).not.toContain('bg-g-receive-msg-bubble');
        expect(doubaoWorkSkin).not.toContain('flow-markdown-body');
        expect(doubaoWorkSkin).not.toContain('md-box-root');

        expect(runTurnsScript(doubaoWorkSkin)).toEqual([
            { Role: 'User', Text: '1+1 等于几？只回答一个数字。' },
            { Role: 'Assistant', Text: '2' },
        ]);
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
        expect(__test__.clickSendButtonScript()).toContain("button#flow-end-msg-send");
        expect(__test__.clickSendButtonScript()).toContain("getAttribute('disabled') !== null");
        expect(__test__.clickSendButtonScript()).toContain("getAttribute('aria-disabled') === 'true'");
        expect(__test__.clickSendButtonScript()).toContain('bestScore >= 200');
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
describe('doubao page state login detection (status)', () => {
    // Drives the real getDoubaoPageState() scripts through jsdom, so the asserted
    // isLogin is exactly what `opencli doubao status` renders (Yes / No / Unknown).
    //
    // 对话形态 fixture 来自历史版本、未经现网验证（本机账号只能进入工作形态，
    // 无法对对话形态做端到端验证）。结构取自本文件既有的 2026-05 DOM 片段：
    // _ROUTER_DATA.loaderData.chat_layout.userSetting.data.is_login。
    const conversationSkinRouterData = {
        loaderData: { chat_layout: { userSetting: { data: { is_login: true } } } },
    };
    // Live sample from a Doubao Work page (2026-10-16): chat_layout exists but
    // carries no userSetting at all, so the embedded-data fast path cannot answer.
    const doubaoWorkSkinRouterData = {
        loaderData: { chat_layout: { accountInfo: { data: { description: '' } } } },
    };
    const loggedInProbe = async () => ({
        ok: true,
        json: async () => ({ data: { user_id_str: '1065907194174404' } }),
    });

    // Runs the fixture through the real scripts. `probe` stands in for
    // /passport/account/info/v2/; probeCalls counts how many times the account
    // probe was reached, which is how the "no unconditional round trip" rule is
    // asserted.
    async function stateFromFixture(routerData, probe) {
        const dom = new JSDOM('<textarea data-testid="chat_input_input" placeholder="发消息"></textarea>', {
            url: 'https://www.doubao.com/chat/',
            runScripts: 'outside-only',
        });
        if (routerData !== undefined)
            dom.window._ROUTER_DATA = routerData;
        let probeCalls = 0;
        dom.window.fetch = async (...args) => {
            probeCalls += 1;
            return probe(...args);
        };
        const page = createPageMock();
        vi.mocked(page.evaluate).mockImplementation(async (script) => (script === 'window.location.href'
            ? 'https://www.doubao.com/chat/'
            : dom.window.eval(script)));
        const state = await getDoubaoPageState(page);
        return { state, probeCalls };
    }

    it('reads the login state from the page-embedded data without reaching the account probe', async () => {
        const { state, probeCalls } = await stateFromFixture(conversationSkinRouterData, loggedInProbe);
        expect(state.isLogin).toBe(true);
        expect(probeCalls).toBe(0);
    });

    it('keeps the embedded-data fast path as the source of truth when it says logged out', async () => {
        const { state, probeCalls } = await stateFromFixture({
            loaderData: { chat_layout: { userSetting: { data: { is_login: false } } } },
        }, loggedInProbe);
        expect(state.isLogin).toBe(false);
        expect(probeCalls).toBe(0);
    });

    it('falls back to the account probe when the Doubao Work page has no embedded login flag', async () => {
        // Guard: the fixture must genuinely lack the fast path, otherwise this
        // test would pass without ever exercising the fallback.
        expect(doubaoWorkSkinRouterData.loaderData.chat_layout.userSetting).toBeUndefined();

        const { state, probeCalls } = await stateFromFixture(doubaoWorkSkinRouterData, loggedInProbe);
        expect(state.isLogin).toBe(true);
        expect(probeCalls).toBe(1);
    });

    it('reports logged out when the fallback probe is rejected by the account API', async () => {
        const { state } = await stateFromFixture(doubaoWorkSkinRouterData, async () => ({
            ok: false,
            status: 401,
            json: async () => ({}),
        }));
        expect(state.isLogin).toBe(false);
    });

    it('stays unknown instead of guessing when the fallback probe cannot reach the account API', async () => {
        const { state } = await stateFromFixture(doubaoWorkSkinRouterData, async () => {
            throw new Error('network down');
        });
        expect(state.isLogin).toBe(null);
    });
});
