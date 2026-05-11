import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
  selectModel,
  sendWithFile,
  parseThinkingResponse,
  parseDeepSeekConversationId,
  pickResumeUrl,
} from './utils.js';

describe('deepseek parseDeepSeekConversationId', () => {
  const id = '749e6bbd-6a45-4440-beaa-ae5238bf06d8';

  it('returns a bare UUID unchanged', () => {
    expect(parseDeepSeekConversationId(id)).toBe(id);
  });

  it('lowercases an upper-case UUID', () => {
    expect(parseDeepSeekConversationId(id.toUpperCase())).toBe(id);
  });

  it('extracts the UUID from a full /a/chat/s/<id> URL', () => {
    expect(parseDeepSeekConversationId(`https://chat.deepseek.com/a/chat/s/${id}`)).toBe(id);
    expect(parseDeepSeekConversationId(`https://chat.deepseek.com/a/chat/s/${id}?from=share`)).toBe(id);
    expect(parseDeepSeekConversationId(`/a/chat/s/${id}`)).toBe(id);
  });

  it('throws ArgumentError on empty input', () => {
    expect(() => parseDeepSeekConversationId('')).toThrow(ArgumentError);
    expect(() => parseDeepSeekConversationId(null)).toThrow(ArgumentError);
    expect(() => parseDeepSeekConversationId(undefined)).toThrow(ArgumentError);
    expect(() => parseDeepSeekConversationId('   ')).toThrow(ArgumentError);
  });

  it('throws ArgumentError on non-UUID input', () => {
    expect(() => parseDeepSeekConversationId('not-an-id')).toThrow(ArgumentError);
    expect(() => parseDeepSeekConversationId('123')).toThrow(ArgumentError);
    // URL with the wrong path shape must not silently fall through to "use raw input".
    expect(() => parseDeepSeekConversationId('https://chat.deepseek.com/somewhere/else')).toThrow(ArgumentError);
  });
});

describe('deepseek parseThinkingResponse', () => {
  it('returns plain response when no thinking header is present', () => {
    const rawText = 'This is a regular response without thinking.';
    const result = parseThinkingResponse(rawText);

    expect(result).toEqual({
      response: rawText,
      thinking: null,
      thinking_time: null,
    });
  });

  it('parses English thinking header — all content after header is thinking', () => {
    const rawText = 'Thought for 3.5 seconds\n\nLet me analyze this problem...\nFirst, I need to consider X.\nThen, Y.\n\nThe answer is 42.';
    const result = parseThinkingResponse(rawText);

    // Text-level parser no longer splits on \n\n; everything after header is thinking.
    // DOM-level extraction in waitForResponse() handles the actual separation.
    expect(result).toEqual({
      response: '',
      thinking: 'Let me analyze this problem...\nFirst, I need to consider X.\nThen, Y.\n\nThe answer is 42.',
      thinking_time: '3.5',
    });
  });

  it('parses Chinese thinking header — all content after header is thinking', () => {
    const rawText = '已思考（用时 2.3 秒）\n\n让我分析这个问题...\n首先需要考虑X。\n然后是Y。\n\n答案是42。';
    const result = parseThinkingResponse(rawText);

    expect(result).toEqual({
      response: '',
      thinking: '让我分析这个问题...\n首先需要考虑X。\n然后是Y。\n\n答案是42。',
      thinking_time: '2.3',
    });
  });

  it('multi-paragraph thinking without final answer is not corrupted', () => {
    const rawText = 'Thought for 1.2 seconds\n\nFirst paragraph.\n\nSecond paragraph.';
    const result = parseThinkingResponse(rawText);

    // Both paragraphs must stay in thinking; response is empty.
    expect(result).toEqual({
      response: '',
      thinking: 'First paragraph.\n\nSecond paragraph.',
      thinking_time: '1.2',
    });
  });

  it('multi-paragraph final answer is not split by text parser', () => {
    const rawText = 'Thought for 3 seconds\n\nreasoning\n\nAnswer para 1.\n\nAnswer para 2.';
    const result = parseThinkingResponse(rawText);

    // Text parser treats everything as thinking; DOM handles separation.
    expect(result).toEqual({
      response: '',
      thinking: 'reasoning\n\nAnswer para 1.\n\nAnswer para 2.',
      thinking_time: '3',
    });
  });

  it('handles thinking without final response', () => {
    const rawText = 'Thought for 1.2 seconds\n\nThinking process here...';
    const result = parseThinkingResponse(rawText);

    expect(result).toEqual({
      response: '',
      thinking: 'Thinking process here...',
      thinking_time: '1.2',
    });
  });

  it('returns null for empty input', () => {
    const result = parseThinkingResponse('');
    expect(result).toBeNull();
  });

  it('returns null for null input', () => {
    const result = parseThinkingResponse(null);
    expect(result).toBeNull();
  });
});


describe('deepseek sendWithFile', () => {
  const tempDirs = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it('prefers page.setFileInput over base64-in-evaluate when supported', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-deepseek-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'report.txt');
    fs.writeFileSync(filePath, 'hello');

    const page = {
      setFileInput: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)    // sidebar collapse
        .mockResolvedValueOnce(true)         // waitForFilePreview
        .mockResolvedValueOnce(true)         // send button enabled check
        .mockResolvedValueOnce({ ok: true }), // sendMessage
    };

    const result = await sendWithFile(page, filePath, 'summarize this');

    expect(result).toEqual({ ok: true });    expect(page.setFileInput).toHaveBeenCalledWith([filePath], 'input[type="file"]');
  });

  it('fails closed when upload preview appears but send button never enables', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-deepseek-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'report.txt');
    fs.writeFileSync(filePath, 'hello');

    const page = {
      setFileInput: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined) // sidebar collapse
        .mockResolvedValueOnce(true)      // waitForFilePreview
        .mockResolvedValue(false),        // send button never enables
    };

    const result = await sendWithFile(page, filePath, 'summarize this');

    expect(result).toEqual({ ok: false, reason: 'send button did not enable after upload' });
    expect(page.evaluate).toHaveBeenCalledTimes(17);
  });
});

describe('deepseek selectModel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete global.document;
  });

  it('fails expert selection when only one radio is present', async () => {
    const instantRadio = {
      getAttribute: vi.fn(() => 'true'),
      click: vi.fn(),
    };
    global.document = {
      querySelectorAll: vi.fn(() => [instantRadio]),
    };
    const page = {
      evaluate: vi.fn(async (script) => eval(script)),
    };

    const result = await selectModel(page, 'expert');

    expect(result).toEqual({ ok: false });
    expect(instantRadio.click).not.toHaveBeenCalled();
  });

  it('selects the correct radio for each model', async () => {
    const radios = [0, 1, 2].map(() => ({
      getAttribute: vi.fn(() => 'false'),
      click: vi.fn(),
    }));
    global.document = {
      querySelectorAll: vi.fn(() => radios),
    };
    const page = {
      evaluate: vi.fn(async (script) => eval(script)),
    };

    await selectModel(page, 'instant');
    expect(radios[0].click).toHaveBeenCalled();
    expect(radios[1].click).not.toHaveBeenCalled();
    expect(radios[2].click).not.toHaveBeenCalled();

    radios.forEach(r => r.click.mockClear());
    await selectModel(page, 'expert');
    expect(radios[1].click).toHaveBeenCalled();

    radios.forEach(r => r.click.mockClear());
    await selectModel(page, 'vision');
    expect(radios[2].click).toHaveBeenCalled();
  });

  it('rejects unknown model names', async () => {
    const radios = [0, 1, 2].map(() => ({
      getAttribute: vi.fn(() => 'false'),
      click: vi.fn(),
    }));
    global.document = {
      querySelectorAll: vi.fn(() => radios),
    };
    const page = {
      evaluate: vi.fn(async (script) => eval(script)),
    };

    const result = await selectModel(page, 'turbo');
    expect(result).toEqual({ ok: false });
  });
});

describe('deepseek sendWithFile Not allowed fallback', () => {
  const tempDirs = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it('falls back to DataTransfer when setFileInput throws Not allowed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-deepseek-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'image.png');
    fs.writeFileSync(filePath, 'fake-png');

    const page = {
      setFileInput: vi.fn().mockRejectedValue(new Error('Not allowed')),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)    // sidebar collapse
        .mockResolvedValueOnce({ ok: true }) // DataTransfer fallback
        .mockResolvedValueOnce(true)         // waitForFilePreview
        .mockResolvedValueOnce(true)         // send button enabled
        .mockResolvedValueOnce({ ok: true }),// sendMessage
    };

    const result = await sendWithFile(page, filePath, 'describe');

    expect(page.setFileInput).toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ ok: true });
  });

  it('does not treat send-button enablement alone as image upload proof', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-deepseek-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'image.png');
    fs.writeFileSync(filePath, 'fake-png');

    const page = {
      setFileInput: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined) // sidebar collapse
        .mockResolvedValue(false),        // no filename / thumbnail preview
    };

    const result = await sendWithFile(page, filePath, 'describe');

    expect(result).toEqual({ ok: false, reason: 'file preview did not appear' });
    expect(page.evaluate.mock.calls[1][0]).toContain('img[src], canvas, video');
    expect(page.evaluate.mock.calls[1][0]).not.toContain("aria-disabled') === 'false'");
  });
});

describe('deepseek pickResumeUrl', () => {
  function createPage() {
    return {
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(),
    };
  }

  it('returns the URL on the first attempt when the sidebar is already populated', async () => {
    const page = createPage();
    // First evaluate is the sidebar-expand no-op; subsequent ones look up the resume URL.
    page.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('https://chat.deepseek.com/a/chat/s/recent-id');

    const url = await pickResumeUrl(page);

    expect(url).toBe('https://chat.deepseek.com/a/chat/s/recent-id');
    // Sidebar expand + one resume lookup. No retry needed.
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page.wait).toHaveBeenCalledTimes(1);
  });

  it('polls until the sidebar finishes loading and returns the late URL', async () => {
    const page = createPage();
    page.evaluate
      .mockResolvedValueOnce(undefined)               // sidebar-expand
      .mockResolvedValueOnce(null)                    // attempt 1: nothing
      .mockResolvedValueOnce(null)                    // attempt 2: nothing
      .mockResolvedValueOnce('https://chat.deepseek.com/a/chat/s/late-id'); // attempt 3: ready

    const url = await pickResumeUrl(page);

    expect(url).toBe('https://chat.deepseek.com/a/chat/s/late-id');
    expect(page.evaluate).toHaveBeenCalledTimes(4);
    expect(page.wait).toHaveBeenCalledTimes(3);
  });

  it('returns null after exhausting all retries instead of falling through silently', async () => {
    const page = createPage();
    // Sidebar expand + 5 polling attempts, each returning null.
    page.evaluate.mockResolvedValue(null);

    const url = await pickResumeUrl(page);

    expect(url).toBeNull();
    expect(page.evaluate).toHaveBeenCalledTimes(6);
    expect(page.wait).toHaveBeenCalledTimes(5);
  });

  it('embeds the pinned-section text matcher inside the resume lookup', async () => {
    const page = createPage();
    page.evaluate.mockResolvedValue(null);

    await pickResumeUrl(page);

    const lookupSrc = page.evaluate.mock.calls
      .map(([js]) => js)
      .find((js) => js.includes('firstElementChild'));
    expect(lookupSrc, 'expected a resume-lookup evaluate call').toBeDefined();
    // Pinned detection must be text-based on the section header (CSS-module class names are randomized per build).
    expect(lookupSrc).toContain('置');
    expect(lookupSrc).toContain('Pinned');
    expect(lookupSrc).toContain('firstElementChild');
  });
});
