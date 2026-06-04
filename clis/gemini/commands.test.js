import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';

const mocks = vi.hoisted(() => ({
    ensureGeminiPage: vi.fn(),
    getGeminiPageState: vi.fn(),
    getGeminiConversationList: vi.fn(),
    getGeminiVisibleTurns: vi.fn(),
    resolveGeminiConversationForQuery: vi.fn(),
}));

vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        ensureGeminiPage: mocks.ensureGeminiPage,
        getGeminiPageState: mocks.getGeminiPageState,
        getGeminiConversationList: mocks.getGeminiConversationList,
        getGeminiVisibleTurns: mocks.getGeminiVisibleTurns,
        resolveGeminiConversationForQuery: mocks.resolveGeminiConversationForQuery,
    };
});

import { statusCommand } from './status.js';
import { historyCommand, extractGeminiId } from './history.js';
import { detailCommand } from './detail.js';
import { readCommand } from './read.js';

function makePage() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(null),
    };
}

describe('extractGeminiId', () => {
    it('parses bare id', () => {
        expect(extractGeminiId('b8368a89d4242e5f')).toBe('b8368a89d4242e5f');
    });
    it('parses /app/<id> path', () => {
        expect(extractGeminiId('/app/abc123')).toBe('abc123');
    });
    it('parses full URL', () => {
        expect(extractGeminiId('https://gemini.google.com/app/xyz789')).toBe('xyz789');
    });
    it('returns empty for garbage', () => {
        expect(extractGeminiId('')).toBe('');
        expect(extractGeminiId('not a url with spaces!')).toBe('');
    });
});

describe('gemini status', () => {
    it('returns Connected + Yes when composer present and no sign-in CTA', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiPageState.mockResolvedValue({
            url: 'https://gemini.google.com/app',
            title: 'Google Gemini',
            isSignedIn: true,
            composerLabel: 'Enter a prompt here',
            canSend: true,
        });
        const rows = await statusCommand.func(makePage(), {});
        expect(rows).toEqual([{ Status: 'Connected', Login: 'Yes', Url: 'https://gemini.google.com/app' }]);
    });

    it('returns No login when sign-in CTA detected', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiPageState.mockResolvedValue({
            url: 'https://gemini.google.com/app',
            title: 'Google Gemini',
            isSignedIn: false,
            composerLabel: '',
            canSend: false,
        });
        const rows = await statusCommand.func(makePage(), {});
        expect(rows[0].Login).toBe('No');
        expect(rows[0].Status).toBe('Page not ready');
    });

    it('treats isSignedIn=null (ambiguous) as logged in when composer is present', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiPageState.mockResolvedValue({
            url: 'https://gemini.google.com/app',
            isSignedIn: null,
            canSend: true,
        });
        const rows = await statusCommand.func(makePage(), {});
        expect(rows[0].Login).toBe('Yes');
    });
});

describe('gemini history', () => {
    it('returns numbered conversation rows', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiConversationList.mockResolvedValue([
            { Title: 'First chat', Url: 'https://gemini.google.com/app/aaa111' },
            { Title: 'Second chat', Url: 'https://gemini.google.com/app/bbb222' },
        ]);
        const rows = await historyCommand.func(makePage(), { limit: 20 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            Index: 1,
            Id: 'aaa111',
            Title: 'First chat',
            Url: 'https://gemini.google.com/app/aaa111',
        });
        expect(rows[1].Id).toBe('bbb222');
    });

    it('respects --limit', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiConversationList.mockResolvedValue([
            { Title: 'a', Url: 'https://gemini.google.com/app/1' },
            { Title: 'b', Url: 'https://gemini.google.com/app/2' },
            { Title: 'c', Url: 'https://gemini.google.com/app/3' },
        ]);
        const rows = await historyCommand.func(makePage(), { limit: 2 });
        expect(rows).toHaveLength(2);
    });

    it('throws ArgumentError for non-positive --limit', async () => {
        await expect(historyCommand.func(makePage(), { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(historyCommand.func(makePage(), { limit: -1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(historyCommand.func(makePage(), { limit: 1.5 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('throws EmptyResultError when sidebar is empty', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiConversationList.mockResolvedValue([]);
        await expect(historyCommand.func(makePage(), { limit: 20 })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('gemini detail', () => {
    it('navigates directly when given a bare id', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiVisibleTurns.mockResolvedValue([
            { Role: 'User', Text: 'hello' },
            { Role: 'Assistant', Text: 'hi there' },
        ]);
        const page = makePage();
        const rows = await detailCommand.func(page, { id: 'b8368a89d4242e5f' });
        expect(page.goto).toHaveBeenCalledWith(
            'https://gemini.google.com/app/b8368a89d4242e5f',
            expect.objectContaining({ waitUntil: 'load' }),
        );
        expect(rows).toEqual([
            { Index: 1, Role: 'User', Text: 'hello' },
            { Index: 2, Role: 'Assistant', Text: 'hi there' },
        ]);
    });

    it('resolves a sidebar title to its URL', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiConversationList.mockResolvedValue([
            { Title: 'Roman empire study', Url: 'https://gemini.google.com/app/rome1' },
        ]);
        mocks.resolveGeminiConversationForQuery.mockReturnValue({
            Title: 'Roman empire study',
            Url: 'https://gemini.google.com/app/rome1',
        });
        mocks.getGeminiVisibleTurns.mockResolvedValue([{ Role: 'Assistant', Text: 'reply' }]);
        const page = makePage();
        const rows = await detailCommand.func(page, { id: 'roman' });
        expect(page.goto).toHaveBeenCalledWith(
            'https://gemini.google.com/app/rome1',
            expect.any(Object),
        );
        expect(rows).toHaveLength(1);
    });

    it('throws ArgumentError when id is missing', async () => {
        await expect(detailCommand.func(makePage(), { id: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('throws EmptyResultError when title has no match', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiConversationList.mockResolvedValue([
            { Title: 'a', Url: 'https://gemini.google.com/app/1' },
        ]);
        mocks.resolveGeminiConversationForQuery.mockReturnValue(null);
        await expect(detailCommand.func(makePage(), { id: 'nope' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws EmptyResultError when navigated page yields zero turns', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiVisibleTurns.mockResolvedValue([]);
        await expect(detailCommand.func(makePage(), { id: 'abc' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('gemini read', () => {
    it('returns indexed turns for the current page', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiVisibleTurns.mockResolvedValue([
            { Role: 'User', Text: 'q1' },
            { Role: 'Assistant', Text: 'a1' },
        ]);
        const rows = await readCommand.func(makePage());
        expect(rows).toEqual([
            { Index: 1, Role: 'User', Text: 'q1' },
            { Index: 2, Role: 'Assistant', Text: 'a1' },
        ]);
    });

    it('throws EmptyResultError when no turns are visible', async () => {
        mocks.ensureGeminiPage.mockResolvedValue(undefined);
        mocks.getGeminiVisibleTurns.mockResolvedValue([]);
        await expect(readCommand.func(makePage())).rejects.toBeInstanceOf(EmptyResultError);
    });
});
