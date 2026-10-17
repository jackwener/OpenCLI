import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { detailCommand } from './detail.js';
import { readCommand } from './read.js';
import { historyCommand } from './history.js';
import { projectListCommand } from './project-list.js';
import { selectChatGPTModel, getVisibleMessages, getChatGPTResponsePairCounts, ensureOnChatGPT } from './utils.js';

function makePage(html) {
    const dom = new JSDOM(html, { url: 'https://chatgpt.com/new', runScripts: 'outside-only' });
    for (const node of dom.window.document.querySelectorAll('*')) {
        node.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 36 });
        node.scrollIntoView = () => {};
    }
    return {
        dom,
        evaluate: vi.fn(async script => dom.window.eval(script)),
        wait: vi.fn(async () => {}),
        goto: vi.fn(async url => dom.reconfigure({ url })),
    };
}

const conversation = `
<div id="prompt-textarea" contenteditable="true"></div>
<div data-chatgpt-search-unit-key="fallback-turn-0:0:user">Synthetic test prompt.</div>
<div data-chatgpt-search-unit-key="fallback-turn-0:1:assistant">
  <h4 data-conversation-role="assistant" class="sr-only">ChatGPT said:</h4>
  <div data-markdown-copy="contents"><p>Synthetic test response.</p></div>
</div>`;

describe('ChatGPT current conversation DOM', () => {
    it('reads new search-unit containers through both detail and read commands', async () => {
        const page = makePage(conversation);
        const rows = await detailCommand.func(page, { id: '12345678' });
        expect(rows.map(({ Role, Text }) => ({ Role, Text }))).toEqual([
            { Role: 'User', Text: 'Synthetic test prompt.' },
            { Role: 'Assistant', Text: 'Synthetic test response.' },
        ]);
        expect((await readCommand.func(page, {})).map(row => row.Text)).toEqual(rows.map(row => row.Text));
        expect(page.wait).toHaveBeenCalledWith(expect.objectContaining({ selector: expect.stringContaining('data-chatgpt-search-unit-key') }));
    });

    it('reads current MarkdownRoot content without including its turn heading', async () => {
        const page = makePage(`<div data-chatgpt-search-unit-key="turn:user"><div data-user-message-bubble><div data-search-result-target>Question</div></div></div>
          <div data-chatgpt-search-unit-key="turn:assistant"><h4 data-conversation-role="assistant">ChatGPT said:</h4>
            <div data-markdown-text-style="assistant-message"><p>Answer</p></div></div>`);
        expect((await getVisibleMessages(page)).map(({ Role, Text }) => ({ Role, Text }))).toEqual([
            { Role: 'User', Text: 'Question' }, { Role: 'Assistant', Text: 'Answer' },
        ]);
    });

    it('preserves user-written role-like headings as content without changing message ownership', async () => {
        const page = makePage(`<h4>You said:</h4><p>Unrelated page content</p>
          <div data-chatgpt-search-unit-key="turn:assistant"><h4 data-conversation-role="assistant">ChatGPT said:</h4>
            <div data-markdown-text-style="assistant-message"><h4>You said:</h4><p>Quoted example</p></div></div>`);
        const rows = await getVisibleMessages(page);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ Role: 'Assistant', Text: 'You said:Quoted example' });
        expect(rows[0].Html).toContain('<h4>You said:</h4>');
    });

    it.each(['Show sidebar', 'Open sidebar', '展开侧边栏'])('opens %s before extracting history', async label => {
        const page = makePage(`<div id="prompt-textarea"></div><button aria-label="${label}"></button><nav style="display:none"><a href="/c/12345678">Synthetic chat</a></nav>`);
        page.dom.window.document.querySelector('button').onclick = () => {
            page.dom.window.document.querySelector('nav').style.display = 'block';
        };
        const rows = await historyCommand.func(page, { limit: 3 });
        expect(rows).toEqual([{ Index: 1, Id: '12345678', Title: 'Synthetic chat', Url: 'https://chatgpt.com/c/12345678' }]);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('opens the modern sidebar before reading project anchors', async () => {
        const page = makePage('<div id="prompt-textarea"></div><button aria-label="Show sidebar"></button><nav style="display:none"><a href="/g/g-p-12345678-test/project">Synthetic project</a></nav>');
        page.dom.window.document.querySelector('button').onclick = () => {
            page.dom.window.document.querySelector('nav').style.display = 'block';
        };
        expect((await projectListCommand.func(page, { limit: 3 }))[0].Title).toBe('Synthetic project');
        expect(page.goto).not.toHaveBeenCalled();
    });
});

describe('ChatGPT current reasoning slider', () => {
    function sliderPage(efforts = ['low', 'medium', 'high', 'xhigh', 'max']) {
        const page = makePage(`<div id="prompt-textarea"></div>
          <button data-selected-reasoning-effort="low" aria-expanded="false">Select effort</button>
          <div data-reasoning-slider="true" tabindex="-1" hidden><span role="slider"></span></div>`);
        const trigger = page.dom.window.document.querySelector('button');
        const row = page.dom.window.document.querySelector('[data-reasoning-slider]');
        let index = 0;
        page.nativeClick = vi.fn(async () => { trigger.setAttribute('aria-expanded', 'true'); row.hidden = false; });
        page.nativeKeyPress = vi.fn(async key => {
            if (key === 'Escape') { trigger.setAttribute('aria-expanded', 'false'); row.hidden = true; return; }
            index = Math.max(0, Math.min(efforts.length - 1, index + (key === 'ArrowRight' ? 1 : -1)));
            trigger.setAttribute('data-selected-reasoning-effort', efforts[index]);
        });
        return page;
    }

    it.each([['balanced', 'medium'], ['advanced', 'high'], ['very-high', 'xhigh']])('selects %s and verifies %s through the UI', async (model, effort) => {
        const page = sliderPage();
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        try {
            expect((await selectChatGPTModel(page, model)).Status).toBe('Success');
            expect(page.dom.window.document.querySelector('button').getAttribute('data-selected-reasoning-effort')).toBe(effort);
            expect(page.nativeKeyPress).toHaveBeenLastCalledWith('Escape');
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally { fetchSpy.mockRestore(); }
    });

    it('ignores a transparent reasoning-control clone before the real trigger', async () => {
        const page = sliderPage();
        const { document } = page.dom.window;
        const trigger = document.querySelector('button');
        const wrapper = document.createElement('div');
        wrapper.style.opacity = '0';
        const clone = trigger.cloneNode(true);
        clone.setAttribute('data-selected-reasoning-effort', 'high');
        clone.getBoundingClientRect = () => ({ left: 700, top: 0, width: 120, height: 36 });
        wrapper.append(clone);
        document.body.prepend(wrapper);
        await expect(selectChatGPTModel(page, 'advanced')).resolves.toMatchObject({ Status: 'Success' });
        expect(page.nativeClick).toHaveBeenCalledWith(60, 18);
        expect(trigger.getAttribute('data-selected-reasoning-effort')).toBe('high');
    });

    it('rejects multiple visible triggers even if one already shows the requested effort', async () => {
        const page = sliderPage();
        const { document } = page.dom.window;
        const clone = document.querySelector('button').cloneNode(true);
        clone.setAttribute('data-selected-reasoning-effort', 'high');
        clone.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 36 });
        document.body.prepend(clone);
        await expect(selectChatGPTModel(page, 'advanced')).rejects.toThrow('ambiguous');
        expect(page.nativeClick).not.toHaveBeenCalled();
        expect(page.nativeKeyPress).not.toHaveBeenCalled();
    });

    it('rejects a disabled reasoning trigger without clicking it', async () => {
        const page = sliderPage();
        page.dom.window.document.querySelector('button').disabled = true;
        await expect(selectChatGPTModel(page, 'advanced')).rejects.toThrow('disabled');
        expect(page.nativeClick).not.toHaveBeenCalled();
    });

    it('does not send arrow keys when two visible sliders compete for focus', async () => {
        const page = sliderPage();
        const { document } = page.dom.window;
        const clone = document.querySelector('[data-reasoning-slider]').cloneNode(true);
        clone.hidden = false;
        clone.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 36 });
        document.body.append(clone);
        await expect(selectChatGPTModel(page, 'advanced')).rejects.toThrow('focus');
        expect(page.nativeKeyPress.mock.calls).toEqual([['Escape']]);
    });

    it('stops sending arrow keys if the slider disappears after the first change', async () => {
        const page = sliderPage();
        const { document } = page.dom.window;
        const row = document.querySelector('[data-reasoning-slider]');
        page.nativeKeyPress.mockImplementation(async key => {
            if (key === 'ArrowRight') {
                expect(document.activeElement).toBe(row);
                document.querySelector('button').setAttribute('data-selected-reasoning-effort', 'medium');
                row.remove();
            }
        });
        await expect(selectChatGPTModel(page, 'advanced')).rejects.toThrow('focus target');
        expect(page.nativeKeyPress.mock.calls).toEqual([['ArrowRight'], ['Escape']]);
    });

    it('waits for the slider to mount before focusing and sending native keys', async () => {
        const page = sliderPage();
        const trigger = page.dom.window.document.querySelector('button');
        const row = page.dom.window.document.querySelector('[data-reasoning-slider]');
        page.nativeClick.mockImplementation(async () => trigger.setAttribute('aria-expanded', 'true'));
        page.wait.mockImplementation(async options => { if (options?.time === 0.25) row.hidden = false; });
        await expect(selectChatGPTModel(page, 'balanced')).resolves.toMatchObject({ Status: 'Success' });
        expect(page.wait).toHaveBeenCalledWith({ time: 0.25 });
    });

    it('fails rather than claiming success when the model does not expose the requested effort', async () => {
        const page = sliderPage(['low', 'medium']);
        await expect(selectChatGPTModel(page, 'advanced')).rejects.toThrow('did not switch');
        expect(page.nativeKeyPress).toHaveBeenLastCalledWith('Escape');
    });
});


describe('ChatGPT repeated conversation turns', () => {
    it('keeps identical questions and answers in separate turns while deduplicating nested selector matches', async () => {
        const page = makePage([0, 1].map(index => `
            <article data-testid="conversation-turn-${index * 2}-user"><div data-message-author-role="user">Repeat question</div></article>
            <article data-testid="conversation-turn-${index * 2 + 1}-assistant"><div data-message-author-role="assistant"><div class="markdown">Same answer</div></div></article>
        `).join(''));
        const messages = await getVisibleMessages(page, { textOnly: true });
        expect(messages.map(({ Role, Text }) => ({ Role, Text }))).toEqual([
            { Role: 'User', Text: 'Repeat question' }, { Role: 'Assistant', Text: 'Same answer' },
            { Role: 'User', Text: 'Repeat question' }, { Role: 'Assistant', Text: 'Same answer' },
        ]);
        expect([...getChatGPTResponsePairCounts(messages, 'Repeat question').values()]).toEqual([2]);
    });
});


describe('ChatGPT owned tab activation', () => {
    it('activates the sole ChatGPT tab in its session', async () => {
        const page = makePage('<div id="prompt-textarea"></div>');
        page.tabs = vi.fn(async () => [{ page: 'owned-chatgpt', url: 'https://chatgpt.com/c/test', active: false }]);
        page.selectTab = vi.fn(async () => {});
        await ensureOnChatGPT(page);
        expect(page.selectTab).toHaveBeenCalledWith('owned-chatgpt');
    });
    it('does not switch an ambiguous or unrelated session target', async () => {
        const page = makePage('<div id="prompt-textarea"></div>');
        page.tabs = vi.fn(async () => [
            { page: 'one', url: 'https://chatgpt.com/c/one', active: false },
            { page: 'two', url: 'https://chatgpt.com/c/two', active: false },
            { page: 'other', url: 'https://example.com', active: false },
        ]);
        page.selectTab = vi.fn(async () => {});
        await ensureOnChatGPT(page);
        expect(page.selectTab).not.toHaveBeenCalled();
    });
});
