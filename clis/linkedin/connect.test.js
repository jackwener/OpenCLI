import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './connect.js';

const {
    normalizeName,
    matchInvitationName,
    canonicalizeLinkedInProfileUrl,
    canonicalizeLinkedInInviteUrl,
    clampNote,
    assessProfileSafety,
    buildProfileProbeScript,
    buildOpenConnectDialogScript,
    buildSentInvitationsProbeScript,
} = await import('./connect.js').then((m) => m.__test__);

function makeFakePage(probe, sendResult = { ok: true, status: 'sent', reason: 'connection_request_sent' }) {
    return {
        goto: vi.fn(async () => undefined),
        wait: vi.fn(async () => undefined),
        evaluate: vi.fn(async (script) => {
            const text = String(script);
            if (text.includes('custom-message') || text.includes('invite_dialog_not_found')) return sendResult;
            return probe;
        }),
    };
}

function makeSequentialFakePage(values) {
    let index = 0;
    return {
        goto: vi.fn(async () => undefined),
        wait: vi.fn(async () => undefined),
        evaluate: vi.fn(async (script) => {
            const text = String(script);
            if (text.includes('custom-message') || text.includes('invite_dialog_not_found')) return { ok: true, status: 'sent', reason: 'connection_request_sent' };
            const value = values[Math.min(index, values.length - 1)];
            index += 1;
            return value;
        }),
    };
}

// Like makeSequentialFakePage, but also answers the in-page "open connect dialog" script
// (button/More-menu path) with a fixed result, without consuming a sequence slot. The
// sequence therefore only feeds the profile probe and the sent-invitations probe(s).
function makeMoreMenuFakePage(values, openResult = { ok: true, opened: 'dialog' }) {
    let index = 0;
    return {
        goto: vi.fn(async () => undefined),
        wait: vi.fn(async () => undefined),
        evaluate: vi.fn(async (script) => {
            const text = String(script);
            if (text.includes('opened:')) return openResult;
            if (text.includes('custom-message') || text.includes('invite_dialog_not_found')) return { ok: true, status: 'sent', reason: 'invitation_sent_without_note' };
            const value = values[Math.min(index, values.length - 1)];
            index += 1;
            return value;
        }),
    };
}

function evaluateProfileProbe(html, expectedName = 'Jane Doe', { withText = false } = {}) {
    const dom = new JSDOM(html, {
        url: 'https://www.linkedin.com/in/jane/',
        runScripts: 'outside-only',
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get() {
            return this.dataset.hidden === 'true' ? null : dom.window.document.body;
        },
    });
    // jsdom has no innerText; the auth-wall cases need the page text the way a browser reads it.
    if (withText) {
        Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
            configurable: true,
            get() { return this.textContent; },
        });
    }
    return dom.window.eval(buildProfileProbeScript(expectedName));
}

describe('linkedin profile probe: the 1st-degree badge', () => {
    // 2026-10-06: "Brittany Pollard She/Her · 1st" read as not connected, because the badge check
    // expected the dot right after the name.
    const page = (afterName) => `<main><section class="pv-top-card"><h1>Jane Doe</h1><span>${afterName}</span>
        <button aria-label="Message">Message</button><button aria-label="More">More</button></section></main>`;
    it('reads the badge after the name, with or without pronouns', () => {
        expect(evaluateProfileProbe(page(' · 1st'), 'Jane Doe', { withText: true }).alreadyConnected).toBe(true);
        expect(evaluateProfileProbe(page(' She/Her · 1st'), 'Jane Doe', { withText: true }).alreadyConnected).toBe(true);
        expect(evaluateProfileProbe(page(' He/Him · 2nd'), 'Jane Doe', { withText: true }).alreadyConnected).toBe(false);
        expect(evaluateProfileProbe(page(' Someone else · 1st'), 'Jane Doe', { withText: true }).alreadyConnected).toBe(false);
    });
});

describe('linkedin connect helpers', () => {
    it('normalizes names and profile URLs', () => {
        expect(normalizeName('Jane Doe • 2nd degree connection')).toBe('jane doe');
        expect(matchInvitationName('Jane Doe, P.Eng.', ' jane   doe ')).toBe(true);
        expect(matchInvitationName('Jane Q. Doe', 'Jane Doe')).toBe(true);
        expect(matchInvitationName('Janet Doe', 'Jane Doe')).toBe(false);
        expect(canonicalizeLinkedInProfileUrl('https://www.linkedin.com/in/jane/?mini=true#x'))
            .toBe('https://www.linkedin.com/in/jane/');
        expect(canonicalizeLinkedInProfileUrl('https://ca.linkedin.com/in/jane/?mini=true#x'))
            .toBe('https://www.linkedin.com/in/jane/');
        expect(canonicalizeLinkedInProfileUrl('https://www.linkedin.com/company/opencli/')).toBe('');
        expect(canonicalizeLinkedInProfileUrl('https://evil-linkedin.com/in/jane/')).toBe('');
        expect(canonicalizeLinkedInProfileUrl('http://www.linkedin.com/in/jane/')).toBe('');
    });

    it('only accepts LinkedIn invitation route hrefs for sending', () => {
        expect(canonicalizeLinkedInInviteUrl('/preload/custom-invite/?vanityName=jane'))
            .toBe('https://www.linkedin.com/preload/custom-invite/?vanityName=jane');
        expect(canonicalizeLinkedInInviteUrl('https://www.linkedin.com/feed/')).toBe('');
        expect(canonicalizeLinkedInInviteUrl('https://evil-linkedin.com/preload/custom-invite/?vanityName=jane')).toBe('');
    });

    it('enforces LinkedIn note length', () => {
        expect(clampNote(' hello\nthere ')).toBe('hello there');
        expect(() => clampNote('x'.repeat(301))).toThrow('--note must be 300 characters or fewer');
    });

    it('fails closed on wrong profile name, pending state, or missing connect button', () => {
        expect(assessProfileSafety({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: true }, 'Janet Doe', 'https://www.linkedin.com/in/jane/').blockReason)
            .toBe('profile_name_mismatch');
        expect(assessProfileSafety({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', pending: true, connectAvailable: true }, 'Jane Doe', 'https://www.linkedin.com/in/jane/').blockReason)
            .toBe('connection_pending');
        expect(assessProfileSafety({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/' }, 'Jane Doe', 'https://www.linkedin.com/in/jane/').blockReason)
            .toBe('connect_button_not_found');
    });

    it('classifies routine non-connectable profiles separately from unsafe blocks', () => {
        expect(assessProfileSafety({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', alreadyConnected: true }, 'Jane Doe', 'https://www.linkedin.com/in/jane/'))
            .toMatchObject({ ok: false, safety: 'routine_non_connectable', connectable: false, blockReason: 'already_connected' });
        expect(assessProfileSafety({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', pending: true }, 'Jane Doe', 'https://www.linkedin.com/in/jane/'))
            .toMatchObject({ ok: false, safety: 'routine_non_connectable', connectable: false, blockReason: 'connection_pending' });
        expect(assessProfileSafety({ name: 'Wrong Person', url: 'https://www.linkedin.com/in/wrong/', connectAvailable: true }, 'Jane Doe', 'https://www.linkedin.com/in/jane/'))
            .toMatchObject({ ok: false, safety: 'unsafe_block', connectable: null, blockReason: 'profile_name_mismatch' });
    });

    it('passes only when profile url, name, and connect affordance all match', () => {
        const result = assessProfileSafety({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/?mini=true', connectAvailable: true }, 'Jane Doe', 'https://www.linkedin.com/in/jane/');
        expect(result).toMatchObject({ ok: true, blockReason: 'verified', actualValue: 'Jane Doe', connectable: true });
    });

    it('treats a present "More" menu as connectable when there is no top-level Connect button', () => {
        // Follow-primary profiles hide Connect inside the "More" actions menu. The probe
        // reports moreAvailable; the send step opens the menu and confirms (or fails closed).
        const result = assessProfileSafety({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: false, moreAvailable: true }, 'Jane Doe', 'https://www.linkedin.com/in/jane/');
        expect(result).toMatchObject({ ok: true, blockReason: 'verified_via_more', connectable: true });
    });

    it('still blocks when neither a Connect button nor a More menu is present', () => {
        const result = assessProfileSafety({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: false, moreAvailable: false }, 'Jane Doe', 'https://www.linkedin.com/in/jane/');
        expect(result.blockReason).toBe('connect_button_not_found');
    });

    it('does not read a member post that says "log in" as an auth wall on a signed-in profile', () => {
        // 2026-09-26: a post reading "👉 Log in to https://exoc.ad/..." made this probe report
        // auth_required on a signed-in page, and the daily run hard-stopped its invitations.
        const probe = evaluateProfileProbe(`
          <header>
            <a href="https://www.linkedin.com/messaging/?">Messaging</a>
            <a href="https://www.linkedin.com/notifications/?">Notifications</a>
          </header>
          <main>
            <section class="pv-top-card">
              <h1>Jane Doe</h1>
              <div class="pvs-profile-actions">
                <button aria-label="Follow Jane Doe">Follow</button>
                <button aria-label="More actions">More</button>
              </div>
            </section>
            <section><p>👉 Log in to https://exoc.ad/x to claim your seat</p></section>
          </main>
        `, 'Jane Doe', { withText: true });
        expect(probe.authRequired).toBe(false);
        expect(probe.name).toBe('Jane Doe');
        expect(probe.moreAvailable).toBe(true);
    });

    it('still reports the signed-out view of a profile as an auth wall', () => {
        const probe = evaluateProfileProbe(`
          <header>
            <a href="https://www.linkedin.com/login?session_redirect=%2Fin%2Fjane%2F">Sign in</a>
            <a href="https://www.linkedin.com/signup/cold-join">Join now</a>
          </header>
          <main><h1>Jane Doe</h1></main>
        `, 'Jane Doe', { withText: true });
        expect(probe.authRequired).toBe(true);
    });

    it('verifies a sent invitation whose invitee headline says "sign in"', () => {
        const dom = new JSDOM(`
          <header><a href="https://www.linkedin.com/messaging/?">Messaging</a></header>
          <ul><li>
            <a href="/in/jane/">Jane Doe</a>
            <p>Sign in to our patient portal | Dentist</p>
          </li></ul>
        `, { url: 'https://www.linkedin.com/mynetwork/invitation-manager/sent/', runScripts: 'outside-only' });
        Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
            configurable: true,
            get() { return this.textContent; },
        });
        const probe = dom.window.eval(buildSentInvitationsProbeScript('Jane Doe', 'https://www.linkedin.com/in/jane/'));
        expect(probe).toMatchObject({ authRequired: false, found: true, matchedUrl: 'https://www.linkedin.com/in/jane/' });
    });

    it('scopes profile action probing to the profile owner instead of sidebar cards', () => {
        const probe = evaluateProfileProbe(`
          <main>
            <section class="pv-top-card">
              <h1>Jane Doe</h1>
              <div class="pvs-profile-actions">
                <button aria-label="Follow Jane Doe">Follow</button>
                <button aria-label="More actions">More</button>
              </div>
            </section>
            <aside>
              <a href="/preload/custom-invite/?vanityName=other">Connect</a>
              <button>More</button>
            </aside>
          </main>
        `);
        expect(probe.name).toBe('Jane Doe');
        expect(probe.moreAvailable).toBe(true);
        expect(probe.connectAvailable).toBe(false);
        expect(probe.connectHref).toBe('');
    });

    it('finds the action bar in 2026 markup that has no top card, h1 or section', () => {
        // The geometry that produced connect_button_not_found on 7 of 26 real profiles: no h1, no
        // .pv-top-card, obfuscated classes, and Follow/Message/More split across wrapper divs so
        // closest() matches nothing and the old parentElement fallback saw only Follow.
        const probe = evaluateProfileProbe(`
          <main><div class="_02c5e36f">
            <div class="_7e88b6e9">
              <div><div><button aria-label="Follow Jane Doe">Follow</button></div></div>
              <div><a href="/messaging/thread/x">Message</a></div>
              <div><button aria-label="More">More</button></div>
            </div>
          </div></main>
        `);
        expect(probe.moreAvailable).toBe(true);
        expect(probe.connectHref).toBe('');
    });

    it('refuses an action bar that also contains another member\'s Connect control', () => {
        // The adversarial shape. The owner's bar exposes only ONE distinct action, so the walk keeps
        // climbing and reaches an ancestor shared with "People also viewed". Bounding by depth alone
        // let that ancestor through - measured live, the real margin was two levels - and turned a
        // safe not_connectable into an invitation aimed at someone else.
        const probe = evaluateProfileProbe(`
          <main><div>
            <div><div><button aria-label="Follow Jane Doe">Follow</button></div></div>
            <aside>
              <a href="/preload/custom-invite/?vanityName=someone-else">Connect</a>
              <button aria-label="Invite Adrien Toupet to connect">Connect</button>
              <button aria-label="Message Adrien Toupet">Message</button>
            </aside>
          </div></main>
        `);
        expect(probe.connectAvailable).toBe(false);
        expect(probe.moreAvailable).toBe(false);
        expect(probe.connectHref).toBe('');
    });

    it('never captures an invite href that does not belong to the profile owner', () => {
        // connectHref feeds straight into a goto + Send. It carries ?vanityName=, which the URL
        // canonicaliser preserves and the send path never re-checks against the intended person.
        const probe = evaluateProfileProbe(`
          <main><div>
            <div><button aria-label="Follow Jane Doe">Follow</button></div>
            <div><button aria-label="More">More</button></div>
            <div><a href="/preload/custom-invite/?vanityName=someone-else">Connect</a></div>
          </div></main>
        `);
        expect(probe.connectHref).not.toContain('someone-else');
    });

    it('does not treat sidebar Connect as profile-owner connectable when the owner has no action menu', () => {
        const probe = evaluateProfileProbe(`
          <main>
            <section class="pv-top-card">
              <h1>Jane Doe</h1>
            </section>
            <aside>
              <a href="/preload/custom-invite/?vanityName=other">Connect</a>
              <button>More</button>
            </aside>
          </main>
        `);
        expect(probe.connectAvailable).toBe(false);
        expect(probe.moreAvailable).toBe(false);
        expect(probe.connectHref).toBe('');
    });
});

// Runs the real in-page SEND script against a fixture, with the page's reactions wired in by the
// test: clicking the owner's More opens a menu holding Connect, and Connect opens the invite dialog.
async function runOpenConnectDialog(html, wire = () => {}, expectedName = 'Jane Doe') {
    const dom = new JSDOM(html, {
        url: 'https://www.linkedin.com/in/jane/',
        runScripts: 'outside-only',
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get() {
            return this.dataset.hidden === 'true' ? null : dom.window.document.body;
        },
    });
    // The script paces its clicks with setTimeout; the fixture reacts synchronously.
    dom.window.setTimeout = (fn) => { fn(); return 0; };
    const clicked = [];
    wire(dom.window.document, clicked);
    const result = await dom.window.eval(buildOpenConnectDialogScript(expectedName));
    return { result, clicked };
}

function wireConnectFlow(doc, clicked) {
    const openDialog = () => doc.body.insertAdjacentHTML('beforeend', '<div role="dialog">Add a note to your invitation? Send without a note</div>');
    for (const el of doc.querySelectorAll('[data-test]')) {
        el.addEventListener('click', () => {
            clicked.push(el.dataset.test);
            if (el.dataset.test === 'owner-more') {
                doc.body.insertAdjacentHTML('beforeend', '<div role="menu"><div role="menuitem" data-test="menu-connect">Connect</div></div>');
                doc.querySelector('[data-test="menu-connect"]').addEventListener('click', () => { clicked.push('menu-connect'); openDialog(); });
            }
            if (el.dataset.test === 'owner-connect') openDialog();
        });
    }
}

// 2026-09-17/18: the probe's 2026 fixture, which the dry-run passes as verified_via_more. The send
// used to look only in the Follow button's own wrapper and refused it owner_more_button_not_found.
const MARKUP_2026_MORE_ONLY = `
  <main><div class="_02c5e36f">
    <div class="_7e88b6e9">
      <div><div><button aria-label="Follow Jane Doe">Follow</button></div></div>
      <div><a href="/messaging/thread/x">Message</a></div>
      <div><button aria-label="More" data-test="owner-more">More</button></div>
    </div>
  </div></main>
`;

// 2026-09-19, measured live on a Follow-primary profile: plain <div> wrappers around each item, and
// Connect is an <a role="menuitem"> to the invitation route with the owner-named aria-label on a
// <div> inside it. The old send clicked the outer wrapper, whose text is also just "Connect".
function wireLinkMenu(vanity) {
    return (doc, clicked) => {
        doc.querySelector('[data-test="owner-more"]').addEventListener('click', () => {
            clicked.push('owner-more');
            doc.body.insertAdjacentHTML('beforeend', `
              <div role="menu">
                <div><div><a role="menuitem" href="/messaging/compose/?body=x">Send profile in a message</a></div></div>
                <div><div><div role="menuitem">Save to PDF</div></div></div>
                <div data-test="menu-wrapper"><div><a role="menuitem" data-test="menu-link" href="/preload/custom-invite/?vanityName=${vanity}">
                  <div aria-label="Invite Jane Doe to connect"><svg></svg><div><p>Connect</p></div></div>
                </a></div></div>
              </div>`);
            for (const el of doc.querySelectorAll('[role="menu"] [data-test]')) {
                el.addEventListener('click', (event) => {
                    // Record only the element actually clicked; bubbling would log the wrapper twice.
                    if (event.target === el) clicked.push(el.dataset.test);
                });
            }
        });
    };
}

describe('linkedin connect send script', () => {
    it('opens Connect from the owner More menu that the dry-run verified', async () => {
        const probe = evaluateProfileProbe(MARKUP_2026_MORE_ONLY);
        expect(probe.moreAvailable).toBe(true);
        const { result, clicked } = await runOpenConnectDialog(MARKUP_2026_MORE_ONLY, wireConnectFlow);
        expect(result).toEqual({ ok: true, opened: 'dialog' });
        expect(clicked).toEqual(['owner-more', 'menu-connect']);
    });

    it('hands back the More menu\'s invitation link instead of clicking its wrapper', async () => {
        const { result, clicked } = await runOpenConnectDialog(MARKUP_2026_MORE_ONLY, wireLinkMenu('jane'));
        expect(result).toEqual({ ok: true, opened: 'invite_link', inviteHref: '/preload/custom-invite/?vanityName=jane' });
        expect(clicked).toEqual(['owner-more']);
    });

    it('refuses a More menu invitation link that names another member', async () => {
        const { result, clicked } = await runOpenConnectDialog(MARKUP_2026_MORE_ONLY, wireLinkMenu('someone-else'));
        expect(result).toEqual({ ok: false, reason: 'connect_link_not_owner' });
        expect(clicked).toEqual(['owner-more']);
    });

    it('never clicks a Connect button that names nobody, even in the owner bar', async () => {
        // The one click this path makes is a real invitation, and a bare "Connect" carries no
        // recipient. Here the owner's More menu holds no Connect, so the send fails closed.
        const html = `
          <main><div>
            <div>
              <div><div><button aria-label="Follow Jane Doe">Follow</button></div></div>
              <div><button data-test="bare-connect">Connect</button></div>
              <div><button aria-label="More" data-test="empty-more">More</button></div>
            </div>
          </div></main>
        `;
        const wireEmptyMenu = (doc, clicked) => {
            for (const el of doc.querySelectorAll('[data-test]')) {
                el.addEventListener('click', () => {
                    clicked.push(el.dataset.test);
                    if (el.dataset.test === 'empty-more') doc.body.insertAdjacentHTML('beforeend', '<div role="menu"><div role="menuitem">Save to PDF</div></div>');
                });
            }
        };
        const { result, clicked } = await runOpenConnectDialog(html, wireEmptyMenu);
        expect(result).toEqual({ ok: false, reason: 'connect_control_not_found' });
        expect(clicked).toEqual(['empty-more']);
    });

    it('refuses a scope that holds another member\'s control and clicks nothing', async () => {
        const html = `
          <main><div>
            <div><div><button aria-label="Follow Jane Doe">Follow</button></div></div>
            <aside>
              <button aria-label="Invite Adrien Toupet to connect" data-test="stranger-connect">Connect</button>
              <button aria-label="More" data-test="stranger-more">More</button>
            </aside>
          </div></main>
        `;
        expect(evaluateProfileProbe(html).moreAvailable).toBe(false);
        const { result, clicked } = await runOpenConnectDialog(html, wireConnectFlow);
        expect(result).toEqual({ ok: false, reason: 'owner_more_button_not_found' });
        expect(clicked).toEqual([]);
    });

    it('refuses the whole page as the owner scope when no control names the owner', async () => {
        const html = `
          <main>
            <div><button data-test="unnamed-more">More</button></div>
            <aside><button aria-label="Invite Adrien Toupet to connect" data-test="stranger-connect">Connect</button></aside>
          </main>
        `;
        const { result, clicked } = await runOpenConnectDialog(html, wireConnectFlow);
        expect(result).toEqual({ ok: false, reason: 'owner_action_bar_not_found' });
        expect(clicked).toEqual([]);
    });
});

describe('linkedin connect command', () => {
    it('registers as a write command and dry-runs by default', async () => {
        const command = getRegistry().get('linkedin/connect');
        expect(command).toBeDefined();
        expect(command.access).toBe('write');
        const page = makeFakePage({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: true, connectHref: '/preload/custom-invite/?vanityName=jane', buttonLabels: ['Connect'] });
        const rows = await command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            note: 'quick note',
        });
        expect(rows[0]).toMatchObject({ status: 'connectable_dry_run', recipient: 'Jane Doe', reason: 'verified', connectable: true });
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('returns a clean not_connectable dry-run row for routine blocked states', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeFakePage({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', alreadyConnected: true, buttonLabels: ['Message'] });
        const rows = await command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            note: 'quick note',
        });
        expect(rows[0]).toMatchObject({ status: 'not_connectable', recipient: 'Jane Doe', reason: 'already_connected', connectable: false });
    });

    it('does not send when recipient verification fails', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeFakePage({ name: 'Wrong Person', url: 'https://www.linkedin.com/in/wrong/', connectAvailable: true, buttonLabels: ['Connect'] });
        await expect(command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            note: 'quick note',
            send: true,
        })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('rejects non-profile URLs before navigating', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeFakePage({});

        await expect(command.func(page, {
            'profile-url': 'https://www.linkedin.com/company/opencli/',
            'expected-name': 'Jane Doe',
            send: true,
        })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('blocks send when the connect link is not LinkedIn invitation route', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeFakePage({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: true, connectHref: 'https://www.linkedin.com/feed/', buttonLabels: ['Connect'] });

        await expect(command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            send: true,
        })).rejects.toThrow('invalid_connect_link');
    });

    it('sends only when --send is true after verification and sent-invitations confirms delivery', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeSequentialFakePage([
            { name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: true, connectHref: '/preload/custom-invite/?vanityName=jane', buttonLabels: ['Connect'] },
            { found: true, matchedName: 'Jane Doe', matchedUrl: 'https://www.linkedin.com/in/jane/' },
        ]);
        const rows = await command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            note: 'quick note',
            send: true,
        });
        expect(rows[0]).toMatchObject({ status: 'sent_verified', recipient: 'Jane Doe', reason: 'sent_invitation_verified', delivery_verified: true });
        expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/invitation-manager/sent/');
    });

    it('retries sent-invitations verification before reporting unverified', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeSequentialFakePage([
            { name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: true, connectHref: '/preload/custom-invite/?vanityName=jane', buttonLabels: ['Connect'] },
            { found: false, matchedName: '', matchedUrl: '', visibleNames: ['Other Person'] },
            { found: false, matchedName: '', matchedUrl: '', visibleNames: ['Other Person'] },
            { found: true, matchedName: 'Jane Doe, P.Eng.', matchedUrl: '' },
        ]);
        const rows = await command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            note: 'quick note',
            send: true,
        });
        expect(rows[0]).toMatchObject({ status: 'sent_verified', recipient: 'Jane Doe', reason: 'sent_invitation_verified', delivery_verified: true, matched_invitation_name: 'Jane Doe, P.Eng.' });
        expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/invitation-manager/sent/');
        expect(page.evaluate).toHaveBeenCalledTimes(5);
    });

    it('does not report sent when sent-invitations verification fails after retries', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeSequentialFakePage([
            { name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: true, connectHref: '/preload/custom-invite/?vanityName=jane', buttonLabels: ['Connect'] },
            { found: false, matchedName: '', matchedUrl: '' },
            { found: false, matchedName: '', matchedUrl: '' },
            { found: false, matchedName: '', matchedUrl: '' },
        ]);
        const rows = await command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            note: 'quick note',
            send: true,
        });
        expect(rows[0]).toMatchObject({ status: 'send_unverified', recipient: 'Jane Doe', reason: 'sent_invitation_not_found_after_retries', delivery_verified: false });
        expect(page.evaluate).toHaveBeenCalledTimes(5);
    });

    it('opens the invite dialog in-page when Connect has no anchor (button/More-menu path) and verifies delivery', async () => {
        const command = getRegistry().get('linkedin/connect');
        // Follow-primary profile: no connectHref anchor, but a "More" menu is present.
        const page = makeMoreMenuFakePage([
            { name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: false, moreAvailable: true, connectHref: '', buttonLabels: ['Follow', 'Message', 'More'] },
            { found: true, matchedName: 'Jane Doe', matchedUrl: 'https://www.linkedin.com/in/jane/' },
        ]);
        const rows = await command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            send: true,
        });
        expect(rows[0]).toMatchObject({ status: 'sent_verified', recipient: 'Jane Doe', reason: 'sent_invitation_verified', delivery_verified: true });
        expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/invitation-manager/sent/');
    });

    it('follows a More menu invitation link to the invitation route before sending', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeMoreMenuFakePage(
            [
                { name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: false, moreAvailable: true, connectHref: '', buttonLabels: ['Follow', 'Message', 'More'] },
                { found: true, matchedName: 'Jane Doe', matchedUrl: 'https://www.linkedin.com/in/jane/' },
            ],
            { ok: true, opened: 'invite_link', inviteHref: '/preload/custom-invite/?vanityName=jane' },
        );
        const rows = await command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            send: true,
        });
        expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/preload/custom-invite/?vanityName=jane');
        expect(rows[0]).toMatchObject({ status: 'sent_verified', reason: 'sent_invitation_verified', delivery_verified: true });
    });

    it('refuses a More menu link result that carries no link', async () => {
        // An empty link would skip the navigation, find no dialog, and land in the no-dialog
        // fallback, which assumes a clicked button already fired the invite.
        const command = getRegistry().get('linkedin/connect');
        const page = makeMoreMenuFakePage(
            [{ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: false, moreAvailable: true, connectHref: '', buttonLabels: ['Follow', 'Message', 'More'] }],
            { ok: true, opened: 'invite_link', inviteHref: '' },
        );
        await expect(command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            send: true,
        })).rejects.toThrow('invalid_connect_link');
    });

    it('fails closed when the owner Connect control cannot be opened from the More menu', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeMoreMenuFakePage(
            [{ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: false, moreAvailable: true, connectHref: '', buttonLabels: ['Follow', 'Message', 'More'] }],
            { ok: false, reason: 'owner_action_bar_not_found' },
        );
        await expect(command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            send: true,
        })).rejects.toThrow('owner_action_bar_not_found');
    });
});
