import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const {
    mockEnsureChatGPTComposer,
    mockEnsureOnChatGPT,
    mockGetVisibleMessages,
    mockSendChatGPTMessage,
    mockStartNewChat,
    mockUploadChatGPTFiles,
    mockWaitForChatGPTResponse,
    mockCurrentChatGPTUrl,
    mockParseChatGPTConversationId,
} = vi.hoisted(() => ({
    mockEnsureChatGPTComposer: vi.fn(),
    mockEnsureOnChatGPT: vi.fn(),
    mockGetVisibleMessages: vi.fn(),
    mockSendChatGPTMessage: vi.fn(),
    mockStartNewChat: vi.fn(),
    mockUploadChatGPTFiles: vi.fn(),
    mockWaitForChatGPTResponse: vi.fn(),
    mockCurrentChatGPTUrl: vi.fn(),
    mockParseChatGPTConversationId: vi.fn(),
}));

vi.mock('./utils.js', () => ({
    CHATGPT_DOMAIN: 'chatgpt.com',
    ensureChatGPTComposer: mockEnsureChatGPTComposer,
    ensureOnChatGPT: mockEnsureOnChatGPT,
    getVisibleMessages: mockGetVisibleMessages,
    sendChatGPTMessage: mockSendChatGPTMessage,
    startNewChat: mockStartNewChat,
    uploadChatGPTFiles: mockUploadChatGPTFiles,
    waitForChatGPTResponse: mockWaitForChatGPTResponse,
    currentChatGPTUrl: mockCurrentChatGPTUrl,
    parseChatGPTConversationId: mockParseChatGPTConversationId,
    normalizeBooleanFlag: (v, f = false) => (v === true || v === 'true' ? true : (v === false || v === 'false' ? false : f)),
    openChatGPTConversation: vi.fn(),
    navigateToProject: vi.fn(),
    getChatGPTResponsePairCounts: vi.fn(() => new Map()),
}));

import { askFileCommand } from './ask-file.js';

describe('chatgpt/ask-file command', () => {
    let tmpDir;
    const page = {};

    beforeEach(() => {
        vi.clearAllMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-ask-file-test-'));
        mockEnsureChatGPTComposer.mockResolvedValue(true);
        mockEnsureOnChatGPT.mockResolvedValue(undefined);
        mockUploadChatGPTFiles.mockResolvedValue({ ok: true, files: ['test.png'] });
        mockGetVisibleMessages.mockResolvedValue([]);
        mockSendChatGPTMessage.mockResolvedValue(true);
        mockWaitForChatGPTResponse.mockResolvedValue('File received.');
        mockCurrentChatGPTUrl.mockResolvedValue('https://chatgpt.com/c/test-conv');
        mockParseChatGPTConversationId.mockReturnValue('test-conv');
    });

    afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    it('does not send a prompt or wait for a reply when attachment confirmation fails', async () => {
        mockUploadChatGPTFiles.mockResolvedValue({ ok: false, reason: 'attachment not ready' });
        await expect(askFileCommand.func(page, { prompt: 'summarize', file: 'doc.txt' })).rejects.toThrow('attachment not ready');
        expect(mockSendChatGPTMessage).not.toHaveBeenCalled();
        expect(mockWaitForChatGPTResponse).not.toHaveBeenCalled();
    });

    it('rejects empty prompts', async () => {
        const filePath = path.join(tmpDir, 'sample.txt');
        fs.writeFileSync(filePath, 'hello');
        await expect(askFileCommand.func(page, { prompt: '', file: filePath }))
            .rejects.toThrow('non-empty prompt');
    });

    it('rejects missing --file argument', async () => {
        await expect(askFileCommand.func(page, { prompt: 'hello', file: '' }))
            .rejects.toThrow('requires at least one file path');
    });

    it('rejects conflicting --new and --conversation arguments', async () => {
        const filePath = path.join(tmpDir, 'sample.txt');
        fs.writeFileSync(filePath, 'hello');
        await expect(askFileCommand.func(page, { prompt: 'hello', file: filePath, new: true, conversation: '123' }))
            .rejects.toThrow('cannot use --new and --conversation together');
    });

    it('successfully uploads file, sends prompt, and returns structured result', async () => {
        const filePath = path.join(tmpDir, 'doc.txt');
        fs.writeFileSync(filePath, 'sample content');

        const result = await askFileCommand.func(page, { prompt: 'summarize', file: filePath });
        expect(mockUploadChatGPTFiles).toHaveBeenCalledWith(page, [filePath]);
        expect(mockSendChatGPTMessage).toHaveBeenCalledWith(page, 'summarize');
        expect(result).toEqual([{
            conversation_id: 'test-conv',
            conversation_url: 'https://chatgpt.com/c/test-conv',
            attachments: 1,
            response: 'File received.',
        }]);
    });
});
