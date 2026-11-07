import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { askLee } from './ask.js';
import { leeDOM } from './utils.js';

// Synthetic semantic fixture, not a captured/claimed Cloudflare DOM.
function fixture({ challenge = false, hidden = false, approval = false, modeApproval = false, stalled = false } = {}) {
    const browser = new JSDOM(`<html><head><title>${challenge ? 'Just a moment...' : 'Cloudflare'}</title></head><body>
      <button id="open">Ask AI</button><main>Unrelated account data</main>
      <aside hidden><button id="new">New conversation</button><section id="messages"></section>
        <form><textarea placeholder="Type @ to tag a resource or ? for shortcuts"></textarea><button type="button" id="mode">Ask</button></form>
      </aside><div id="menu" hidden><button>Ask before editing</button><button>Automatically edit</button></div>
    </body></html>`, { url: 'https://dash.cloudflare.com/', runScripts: 'outside-only' });
    const w = browser.window;
    Object.defineProperty(w.document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' });
    w.HTMLElement.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}]; };
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    const doc = w.document;
    const clicks = [];
    doc.addEventListener('click', e => clicks.push(e.target.textContent || e.target.getAttribute('aria-label')));
    doc.querySelector('#open').onclick = () => { doc.querySelector('aside').hidden = false; };
    doc.querySelector('#new').onclick = () => { doc.querySelector('#messages').replaceChildren(); doc.querySelector('textarea').value = ''; };
    doc.querySelector('#mode').onclick = () => { doc.querySelector('#menu').hidden = false; };
    const approve = () => {
        const b = doc.createElement('button'); b.textContent = 'Allow for this conversation';
        b.onclick = () => { b.remove(); if (approval) finish(); };
        doc.querySelector('#messages').append(b);
    };
    for (const b of doc.querySelectorAll('#menu button')) b.onclick = () => {
        doc.querySelector('#mode').textContent = b.textContent === 'Automatically edit' ? 'Edit' : 'Ask';
        doc.querySelector('#menu').hidden = true;
        if (modeApproval && b.textContent === 'Automatically edit') approve();
    };
    const finish = () => {
        doc.querySelector('#messages').innerHTML = '<button><span>Worked 34 s</span></button><div><p>Yes. Email Routing is enabled on example.test.</p></div><button>Copy</button>';
    };
    const page = {
        cdp: vi.fn(async () => {}), goto: vi.fn(async () => {}),
        evaluate: vi.fn(async (fn, ...args) => w.eval(`(${fn.toString()})(...${JSON.stringify(args)})`)),
        wait: vi.fn(async seconds => { if (vi.isFakeTimers()) vi.advanceTimersByTime(seconds * 1000); }),
        fillText: vi.fn(async (_, value) => { doc.querySelector('textarea').value = value; }),
        pressKey: vi.fn(async () => { if (approval) approve(); else if (!stalled) finish(); }),
    };
    return { page, doc, clicks, browser };
}

afterEach(() => { vi.useRealTimers(); });

describe('Cloudflare Lee command (synthetic DOM)', () => {
    it('sets ask explicitly, submits once, waits for Worked, returns only final answer', async () => {
        const { page, clicks } = fixture();
        const result = await askLee(page, { question: 'Is routing enabled?', zone: 'example.test' });
        expect(result).toEqual([{ response: 'Yes. Email Routing is enabled on example.test.', worked: 'Worked 34 s', mode: 'ask', zone: 'example.test' }]);
        expect(clicks).toEqual(['Ask AI', 'New conversation', 'Ask', 'Ask before editing']);
        expect(page.pressKey).toHaveBeenCalledExactlyOnceWith('ENTER');
        expect(page.fillText.mock.calls[0][1]).toContain('Read-only request.');
        expect(page.fillText.mock.calls[0][1]).toContain('Zone: example.test');
        expect(page.cdp).toHaveBeenCalledWith('Page.bringToFront');
    });

    it('leaves every approval untouched in ask mode', async () => {
        const { page, clicks, doc } = fixture({ approval: true });
        await expect(askLee(page, { question: 'Inspect' })).rejects.toThrow('ask mode leaves it unapproved');
        expect(clicks).not.toContain('Allow for this conversation');
        expect(doc.querySelector('#messages').textContent).toContain('Allow for this conversation');
    });

    it.each([false, true])('edit explicitly selects automatic mode and approves once (early=%s)', async early => {
        const { page, clicks } = fixture({ approval: !early, modeApproval: early });
        await expect(askLee(page, { question: 'Authorized task', mode: 'edit' })).resolves.toEqual(expect.any(Array));
        expect(clicks).toContain('Automatically edit');
        expect(clicks.filter(c => c === 'Allow for this conversation')).toHaveLength(1);
    });

    it('reports the exact challenge and login route before typing', async () => {
        const { page } = fixture({ challenge: true });
        await expect(askLee(page, { question: 'Inspect' })).rejects.toMatchObject({
            code: 'AUTH_REQUIRED', message: 'Cloudflare security verification blocks https://dash.cloudflare.com/',
            hint: expect.stringContaining('https://dash.cloudflare.com/login'),
        });
        expect(page.fillText).not.toHaveBeenCalled();
    });

    it('refuses a still-hidden tab without spoofing visibility', async () => {
        const { page } = fixture({ hidden: true });
        await expect(askLee(page, { question: 'Inspect' })).rejects.toThrow('visibilityState=visible');
        expect(page.fillText).not.toHaveBeenCalled();
    });

    it.each(['approve', 'EDIT', ''])('rejects invalid modes before browser work: %s', async mode => {
        const { page } = fixture();
        await expect(askLee(page, { question: 'Inspect', mode })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('does not reuse an old Worked response or return a partial on timeout', async () => {
        vi.useFakeTimers();
        const { page, doc } = fixture({ stalled: true });
        doc.querySelector('#messages').innerHTML = '<div>Worked 5 s</div><p>Old answer</p>';
        await expect(askLee(page, { question: 'Inspect', timeout: 2 })).rejects.toMatchObject({ code: 'TIMEOUT' });
        expect(page.pressKey).toHaveBeenCalledTimes(1);
        expect(doc.querySelector('#messages').textContent).not.toContain('Old answer');
    });

    it('fails closed when panel controls are missing or ambiguous', async () => {
        const { page, doc } = fixture();
        doc.querySelector('#new').remove();
        await expect(askLee(page, { question: 'Inspect' })).rejects.toThrow('Could not identify the Lee panel');
        expect(page.pressKey).not.toHaveBeenCalled();
    });

    it('verifies the edit mode actually changed before submitting', async () => {
        const { page, doc } = fixture();
        doc.querySelectorAll('#menu button')[1].onclick = () => { doc.querySelector('#menu').hidden = true; };
        await expect(askLee(page, { question: 'Authorized task', mode: 'edit' })).rejects.toThrow('mode selection did not take effect');
        expect(page.pressKey).not.toHaveBeenCalled();
    });

    it('does not click a stale approval twice', async () => {
        const { page, doc, clicks } = fixture({ approval: true });
        page.pressKey = vi.fn(async () => {
            const b = doc.createElement('button'); b.textContent = 'Allow for this conversation';
            doc.querySelector('#messages').append(b);
        });
        await expect(askLee(page, { question: 'Authorized task', mode: 'edit' })).rejects.toThrow('still visible after one approval');
        expect(clicks.filter(c => c === 'Allow for this conversation')).toHaveLength(1);
    });

    it('ignores hidden completion text and requires an actual Worked marker', () => {
        const { doc, browser } = fixture();
        doc.querySelector('aside').hidden = false;
        doc.querySelector('#messages').innerHTML = '<div hidden>Worked 3 s</div><p>Partial answer</p>';
        const result = browser.window.eval(`(${leeDOM.toString()})('answer')`);
        expect(result).toMatchObject({ worked: '', response: '' });
    });
});
