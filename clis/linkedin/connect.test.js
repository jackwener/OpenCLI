import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './connect.js';

const {
    normalizeName,
    canonicalizeLinkedInProfileUrl,
    canonicalizeLinkedInInviteUrl,
    unwrapEvaluateResult,
    clampNote,
    assessProfileSafety,
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

describe('linkedin connect helpers', () => {
    it('normalizes names and profile URLs', () => {
        expect(normalizeName('Jane Doe • 2nd degree connection')).toBe('jane doe');
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

    it('unwraps browser bridge evaluate envelopes', () => {
        expect(unwrapEvaluateResult({ session: 'site:linkedin:1', data: { ok: true } })).toEqual({ ok: true });
        const raw = { ok: true };
        expect(unwrapEvaluateResult(raw)).toBe(raw);
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

    it('passes only when profile url, name, and connect affordance all match', () => {
        const result = assessProfileSafety({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/?mini=true', connectAvailable: true }, 'Jane Doe', 'https://www.linkedin.com/in/jane/');
        expect(result).toMatchObject({ ok: true, blockReason: 'verified', actualValue: 'Jane Doe' });
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
        expect(rows[0]).toMatchObject({ status: 'verified_dry_run', recipient: 'Jane Doe', reason: 'verified' });
        expect(page.evaluate).toHaveBeenCalledTimes(1);
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

    it('sends only when --send is true after verification', async () => {
        const command = getRegistry().get('linkedin/connect');
        const page = makeFakePage({ name: 'Jane Doe', url: 'https://www.linkedin.com/in/jane/', connectAvailable: true, connectHref: '/preload/custom-invite/?vanityName=jane', buttonLabels: ['Connect'] });
        const rows = await command.func(page, {
            'profile-url': 'https://www.linkedin.com/in/jane/',
            'expected-name': 'Jane Doe',
            note: 'quick note',
            send: true,
        });
        expect(rows[0]).toMatchObject({ status: 'sent', recipient: 'Jane Doe', reason: 'connection_request_sent' });
        expect(page.evaluate).toHaveBeenCalledTimes(3);
    });
});
