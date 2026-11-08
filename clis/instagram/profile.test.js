import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { normalizeInstagramUsername, readInstagramProfileUser } from './_shared/profile-web-client.js';
import './profile.js';

const doms = [];
afterEach(() => { for (const dom of doms.splice(0)) dom.window.close(); });

const nasa = {
    username: 'nasa',
    full_name: 'NASA',
    biography: 'Making the seemingly\nimpossible, possible.',
    follower_count: 104385304,
    following_count: 90,
    media_count: 5000,
    is_verified: true,
    profile_pic_url: 'https://scontent.cdninstagram.com/nasa_150.jpg',
    hd_profile_pic_url_info: { url: 'https://scontent.cdninstagram.com/nasa_1080.jpg' },
};

/**
 * A page whose "Instagram client" answers a history-API route change by issuing
 * the given GraphQL requests over XHR, like the Polaris web client does.
 */
function fixture({ requests = [], cookie = 'ds_user_id=1; csrftoken=t', bodyText = '' } = {}) {
    const dom = new JSDOM('<body></body>', { url: 'https://www.instagram.com/', runScripts: 'outside-only' });
    doms.push(dom);
    const { window } = dom;
    Object.defineProperty(window.document, 'cookie', { get: () => cookie, configurable: true });
    const sent = [];
    class FakeXHR {
        constructor() { this.listeners = {}; this.responseText = ''; }
        open(method, url) { this.url = url; }
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
        send(body) {
            sent.push({ url: this.url, body });
            const reply = requests.find(r => r.body === body);
            setTimeout(() => { this.responseText = reply?.response ?? ''; for (const fn of this.listeners.load || []) fn(); }, 10);
        }
    }
    window.XMLHttpRequest = FakeXHR;
    window.addEventListener('popstate', () => {
        if (bodyText) window.document.body.textContent = bodyText;
        for (const request of requests) {
            const xhr = new window.XMLHttpRequest();
            xhr.open('POST', request.url || '/api/graphql');
            xhr.send(request.body);
        }
    });
    const page = { goto: vi.fn(), wait: vi.fn(), evaluate: vi.fn(async script => window.eval(script)) };
    return { window, page, sent, run: (username = 'nasa') => getRegistry().get('instagram/profile').func(page, { username }) };
}

const form = name => new URLSearchParams({ fb_api_req_friendly_name: name, doc_id: '1', variables: '{}' }).toString();
const profileQuery = (user, extra = {}) => ({ body: form('PolarisProfilePageContentQuery'), response: JSON.stringify({ data: { user }, ...extra }) });

describe('instagram profile via the web client', () => {
    it('reads PolarisProfilePageContentQuery after routing to the profile in a fresh document', async () => {
        const f = fixture({ requests: [
            { body: form('PolarisProfileNoteBubbleQuery'), response: JSON.stringify({ data: { user: { username: 'other' } } }) },
            profileQuery(nasa),
        ] });
        await expect(f.run('@nasa')).resolves.toEqual([{
            username: 'nasa', name: 'NASA', followers: 104385304, following: 90, posts: 5000, verified: 'Yes',
            bio: 'Making the seemingly impossible, possible.', avatar_url: 'https://scontent.cdninstagram.com/nasa_1080.jpg',
        }]);
        expect(f.page.goto.mock.calls.map(c => c[0])).toEqual([expect.stringContaining('__opencli_reset='), 'https://www.instagram.com/']);
        expect(f.window.location.pathname).toBe('/nasa/');
        expect(f.sent).toHaveLength(2);
    });

    it('restores XHR after reading', async () => {
        const f = fixture({ requests: [profileQuery(nasa)] });
        const send = f.window.XMLHttpRequest.prototype.send;
        await f.run();
        expect(f.window.XMLHttpRequest.prototype.send).toBe(send);
    });

    it('returns an empty avatar_url when Instagram sends none or a non-https value', async () => {
        const f = fixture({ requests: [profileQuery({ ...nasa, hd_profile_pic_url_info: null, profile_pic_url: 'javascript:alert(1)' })] });
        expect((await f.run())[0].avatar_url).toBe('');
    });

    it('requires a logged-in session', async () => {
        const f = fixture({ cookie: 'csrftoken=t', requests: [profileQuery(nasa)] });
        await expect(f.run()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
        expect(f.sent).toHaveLength(0);
    });

    it('reports a missing account as EMPTY_RESULT', async () => {
        const f = fixture({ requests: [profileQuery(null)] });
        await expect(f.run('ghost.account')).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('reports the "page isn\'t available" screen as EMPTY_RESULT', async () => {
        const f = fixture({ bodyText: "Sorry, this page isn't available." });
        await expect(f.run('ghost.account')).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('reads once more when Instagram reloads the document for an unknown username', async () => {
        const f = fixture({ bodyText: "Sorry, this page isn't available." });
        const evaluate = f.page.evaluate.getMockImplementation();
        f.page.evaluate.mockImplementationOnce(async () => { throw new Error('Execution context was destroyed.'); }).mockImplementation(evaluate);
        await expect(f.run('ghost.account')).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        expect(f.page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('fails typed after a second lost context instead of looping', async () => {
        const f = fixture();
        f.page.evaluate.mockRejectedValue(new Error('Execution context was destroyed.'));
        await expect(f.run()).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(f.page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('rejects a profile for a different account', async () => {
        const f = fixture({ requests: [profileQuery({ ...nasa, username: 'someoneelse' })] });
        await expect(f.run()).rejects.toThrow('Instagram loaded @someoneelse instead of @nasa');
    });

    it('times out with Instagram\'s GraphQL error instead of returning empty rows', async () => {
        const f = fixture({ requests: [{ body: form('PolarisProfilePageContentQuery'), response: JSON.stringify({ errors: [{ message: 'Please wait a few minutes' }] }) }] });
        await expect(readInstagramProfileUser(f.page, 'nasa', { timeoutMs: 600 }))
            .rejects.toMatchObject({ code: 'TIMEOUT', hint: expect.stringContaining('Please wait a few minutes') });
    });

    it('validates usernames before navigating', async () => {
        expect(normalizeInstagramUsername('@nasa')).toBe('nasa');
        const f = fixture();
        await expect(f.run('../evil')).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(f.page.goto).not.toHaveBeenCalled();
    });
});
