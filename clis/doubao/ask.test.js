import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { askCommand, askDoubao } from './ask.js';

afterEach(() => vi.restoreAllMocks());

function makePage(options = {}) {
    let time = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    let input = options.draft || '';
    let sent = false;
    let polls = 0;
    const page = {
        getActivePage: vi.fn(() => 'test-page'),
        goto: vi.fn(async () => {}),
        evaluate: vi.fn(async () => {
            if (input && !sent) polls++;
            const fresh = sent && !options.noSubmit;
            return {
                url: options.blank ? 'about:blank' : 'https://www.doubao.com/chat/test',
                inputCount: 1, inputIndex: 1, input,
                sendIndex: 0, sendReady: !options.blocked,
                point: { x: options.moving && polls < 5 ? polls * 20 : 100, y: 100, w: 36, h: 36 },
                modeLabel: input && options.modeChanged ? 'Different mode' : '豆包 快速',
                modeIndex: 0, modeItems: [], challenge: !!options.challenge,
                generating: !!options.busy || (!!input && !!options.busyAfterType) || (sent && !!options.streaming),
                users: fresh ? [{ id: 'new-user', text: 'Hello world' }] : [],
                replies: sent && !options.oldOnly ? [{ id: 'new-reply', text: 'Answer', links: ['https://example.com/'], done: !options.streaming }] : [{ id: 'old-reply', text: 'Old answer', links: [], done: true }],
            };
        }),
        typeText: vi.fn(async (_selector, value) => { input = options.badInput ? 'wrong' : value; }),
        click: vi.fn(async () => {
            if (options.moving) expect(polls).toBeGreaterThanOrEqual(7);
            sent = true;
            if (!options.noSubmit) input = '';
        }),
        wait: vi.fn(async seconds => { time += seconds * 1000; }),
        tabs: vi.fn(),
        selectTab: vi.fn(),
    };
    return page;
}

describe('doubao ask', () => {
    it('declares optional modes and keeps the Role/Text output contract', () => {
        expect(askCommand.columns).toEqual(['Role', 'Text']);
        expect(askCommand.args.find(arg => arg.name === 'mode')).toMatchObject({ default: 'current', choices: ['current', 'fast', 'expert'] });
        expect(askCommand.defaultWindowMode).toBe('foreground');
    });
    it('pins the leased page, uses the visible editor, sends once and returns a completed reply', async () => {
        const page = makePage();
        const result = await askDoubao(page, { text: 'Hello world', timeout: 10 });
        expect(page.goto).toHaveBeenCalledWith('https://www.doubao.com/chat/test', expect.any(Object));
        expect(page.typeText).toHaveBeenCalledWith(expect.stringContaining('contenteditable'), 'Hello world', { nth: 1 });
        expect(page.click).toHaveBeenCalledTimes(1);
        expect(result).toEqual([{ Role: 'User', Text: 'Hello world' }, { Role: 'Assistant', Text: 'Answer\n\nSources:\nhttps://example.com/' }]);
    });
    it('navigates a blank lease without adopting another user tab', async () => {
        const page = makePage({ blank: true });
        await askDoubao(page, { text: 'Hello world' });
        expect(page.goto).toHaveBeenCalledWith('https://www.doubao.com/chat', expect.any(Object));
        expect(page.tabs).not.toHaveBeenCalled();
        expect(page.selectTab).not.toHaveBeenCalled();
    });
    it.each([{ text: '' }, { text: 'hello', timeout: 0 }, { text: 'hello', mode: 'unknown' }])('rejects invalid arguments before browser work: %j', async args => {
        const page = makePage();
        await expect(askDoubao(page, args)).rejects.toBeInstanceOf(ArgumentError);
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('preserves existing drafts without navigation, typing or sending', async () => {
        const page = makePage({ draft: 'unsent draft' });
        await expect(askDoubao(page, { text: 'Hello world' })).rejects.toThrow('unsent draft');
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.typeText).not.toHaveBeenCalled();
        expect(page.click).not.toHaveBeenCalled();
    });
    it.each([{ challenge: true }, { busy: true }])('stops before writing when the page is not ready: %j', async options => {
        const page = makePage(options);
        await expect(askDoubao(page, { text: 'Hello world' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.typeText).not.toHaveBeenCalled();
    });
    it.each([{ badInput: true }, { modeChanged: true }, { blocked: true }, { busyAfterType: true }])('does not submit after unsafe composer changes: %j', async options => {
        const page = makePage(options);
        await expect(askDoubao(page, { text: 'Hello world' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.click).not.toHaveBeenCalled();
    });
    it('waits for moving send-button geometry to settle', async () => {
        const page = makePage({ moving: true });
        await expect(askDoubao(page, { text: 'Hello world' })).resolves.toHaveLength(2);
        expect(page.click).toHaveBeenCalledTimes(1);
    });
    it('does not return a reply without a confirmed new user message or resend', async () => {
        const page = makePage({ noSubmit: true });
        await expect(askDoubao(page, { text: 'Hello world' })).rejects.toThrow('submission was not confirmed');
        expect(page.click).toHaveBeenCalledTimes(1);
    });
    it.each([{ oldOnly: true }, { streaming: true }])('times out instead of returning old or partial answers: %j', async options => {
        const page = makePage(options);
        await expect(askDoubao(page, { text: 'Hello world', timeout: 3 })).rejects.toBeInstanceOf(TimeoutError);
        expect(page.click).toHaveBeenCalledTimes(1);
    });
});
