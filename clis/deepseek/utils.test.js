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

  it('parses English thinking header with content and response', () => {
    const rawText = 'Thought for 3.5 seconds\n\nLet me analyze this problem...\nFirst, I need to consider X.\nThen, Y.\n\nThe answer is 42.';
    const result = parseThinkingResponse(rawText);

    expect(result).toEqual({
      response: 'The answer is 42.',
      thinking: 'Let me analyze this problem...\nFirst, I need to consider X.\nThen, Y.',
      thinking_time: '3.5',
    });
  });

  it('parses Chinese thinking header with content and response', () => {
    const rawText = '已思考（用时 2.3 秒）\n\n让我分析这个问题...\n首先需要考虑X。\n然后是Y。\n\n答案是42。';
    const result = parseThinkingResponse(rawText);

    expect(result).toEqual({
      response: '答案是42。',
      thinking: '让我分析这个问题...\n首先需要考虑X。\n然后是Y。',
      thinking_time: '2.3',
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
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce({ ok: true }),
    };

    const result = await sendWithFile(page, filePath, 'summarize this');

    expect(result).toEqual({ ok: true });
    expect(page.setFileInput).toHaveBeenCalledWith([filePath], 'input[type="file"]');
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
});
