import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectModel, sendWithFile, parseThinkingResponse } from './utils.js';

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
