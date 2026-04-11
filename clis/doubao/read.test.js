import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDoubaoVisibleTurns: vi.fn(),
    navigateToConversation: vi.fn(),
}));

vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        getDoubaoVisibleTurns: mocks.getDoubaoVisibleTurns,
        navigateToConversation: mocks.navigateToConversation,
    };
});

import { readCommand } from './read.js';

describe('doubao read --thread', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getDoubaoVisibleTurns.mockResolvedValue([
            { Role: 'Assistant', Text: '这是指定会话' },
        ]);
    });

    it('navigates to the requested conversation id before reading', async () => {
        const page = {};

        const result = await readCommand.func(page, {
            thread: 'https://www.doubao.com/chat/1234567890123',
        });

        expect(mocks.navigateToConversation).toHaveBeenCalledWith(page, '1234567890123');
        expect(result).toEqual([
            { Role: 'Assistant', Text: '这是指定会话' },
        ]);
    });

    it('rejects malformed thread ids before reading', async () => {
        const page = {};

        await expect(readCommand.func(page, {
            thread: '123',
        })).rejects.toMatchObject({ code: 'INVALID_INPUT' });

        expect(mocks.navigateToConversation).not.toHaveBeenCalled();
    });
});
