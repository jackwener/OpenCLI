import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';

const {
    mockEnsureOnClaude,
    mockEnsureClaudeComposer,
    mockEnsureClaudeLogin,
    mockSendMessage,
    mockParseBoolFlag,
    mockRequireNonEmptyPrompt,
    mockGetVisibleMessages,
    mockGetConversationList,
    mockRequirePositiveInt,
    mockRequireConversationId,
    mockWithRetry,
} = vi.hoisted(() => ({
    mockEnsureOnClaude: vi.fn(),
    mockEnsureClaudeComposer: vi.fn(),
    mockEnsureClaudeLogin: vi.fn(),
    mockSendMessage: vi.fn(),
    mockParseBoolFlag: vi.fn((v) => v === true || v === 'true'),
    mockRequireNonEmptyPrompt: vi.fn((v) => String(v ?? '')),
    mockGetVisibleMessages: vi.fn(),
    mockGetConversationList: vi.fn(),
    mockRequirePositiveInt: vi.fn((v) => Number(v)),
    mockRequireConversationId: vi.fn((v) => String(v ?? '').trim()),
    mockWithRetry: vi.fn(async (fn) => fn()),
}));

vi.mock('./utils.js', () => ({
    CLAUDE_DOMAIN: 'claude.ai',
    CLAUDE_URL: 'https://claude.ai/new',
    ensureOnClaude: mockEnsureOnClaude,
    ensureClaudeComposer: mockEnsureClaudeComposer,
    ensureClaudeLogin: mockEnsureClaudeLogin,
    sendMessage: mockSendMessage,
    parseBoolFlag: mockParseBoolFlag,
    requireNonEmptyPrompt: mockRequireNonEmptyPrompt,
    getVisibleMessages: mockGetVisibleMessages,
    getConversationList: mockGetConversationList,
    requirePositiveInt: mockRequirePositiveInt,
    requireConversationId: mockRequireConversationId,
    withRetry: mockWithRetry,
}));

import { sendCommand } from './send.js';
import { newCommand } from './new.js';
import { readCommand } from './read.js';
import { historyCommand } from './history.js';
import { detailCommand } from './detail.js';

describe('claude command-level fail-fast contracts', () => {
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockEnsureOnClaude.mockResolvedValue(false);
        mockEnsureClaudeComposer.mockResolvedValue({ isLoggedIn: true, hasComposer: true });
        mockEnsureClaudeLogin.mockResolvedValue({ isLoggedIn: true });
        mockSendMessage.mockResolvedValue({ ok: true });
        mockRequireNonEmptyPrompt.mockImplementation((v) => String(v ?? ''));
        mockGetVisibleMessages.mockResolvedValue([{ Index: 0, Role: 'assistant', Text: 'hi' }]);
        mockGetConversationList.mockResolvedValue([{ Index: 1, Id: 'abc', Title: 'Hi', Url: 'https://claude.ai/chat/abc' }]);
        mockRequirePositiveInt.mockImplementation((v) => Number(v));
        mockRequireConversationId.mockImplementation((v) => String(v ?? '').trim());
    });

    it('send rejects empty prompt via ArgumentError', async () => {
        mockRequireNonEmptyPrompt.mockImplementation(() => {
            throw new ArgumentError('claude send prompt cannot be empty');
        });

        await expect(sendCommand.func(page, { prompt: '', new: false })).rejects.toThrow(ArgumentError);
    });

    it('send surfaces auth failure from composer readiness', async () => {
        mockEnsureClaudeComposer.mockRejectedValue(new AuthRequiredError('claude.ai', 'Claude send requires a logged-in Claude session.'));

        await expect(sendCommand.func(page, { prompt: 'hi', new: false })).rejects.toThrow(AuthRequiredError);
    });

    it('new no longer false-succeeds on login wall', async () => {
        mockEnsureClaudeComposer.mockRejectedValue(new AuthRequiredError('claude.ai', 'Claude new requires a logged-in Claude session with a visible composer.'));

        await expect(newCommand.func(page)).rejects.toThrow(AuthRequiredError);
    });

    it('read throws EmptyResultError instead of a placeholder row', async () => {
        mockGetVisibleMessages.mockResolvedValue([]);

        await expect(readCommand.func(page)).rejects.toThrow(EmptyResultError);
    });

    it('history rejects invalid --limit values instead of silently coercing them', async () => {
        mockRequirePositiveInt.mockImplementation(() => {
            throw new ArgumentError('claude history --limit must be a positive integer');
        });

        await expect(historyCommand.func(page, { limit: 0 })).rejects.toThrow(ArgumentError);
    });

    it('history throws EmptyResultError on an empty /recents page', async () => {
        mockGetConversationList.mockResolvedValue([]);

        await expect(historyCommand.func(page, { limit: 20 })).rejects.toThrow(EmptyResultError);
    });

    it('detail rejects a missing conversation id', async () => {
        mockRequireConversationId.mockImplementation(() => {
            throw new ArgumentError('claude detail requires a conversation id');
        });

        await expect(detailCommand.func(page, { id: '' })).rejects.toThrow(ArgumentError);
    });
});
