import { describe, it, expect, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const { __test__ } = await import('./note.js');
const command = __test__.command;

function makePage(evaluatePayload) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluatePayload),
  };
}

describe('youdao note', () => {
  it('registers as a public browser read command', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('youdao');
    expect(command.name).toBe('note');
    expect(command.access).toBe('read');
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('public');
    expect(command.domain).toBe('share.note.youdao.com');
    expect(command.columns).toEqual(['title', 'content', 'summary', 'keywords', 'created_at', 'file_size', 'url']);
  });

  it('strictly validates share URL before navigation', async () => {
    const page = makePage({});
    await expect(command.func(page, { url: '' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { url: 'https://share.note.youdao.com.evil/ynoteshare/index.html?id=1&type=note' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { url: 'javascript:alert(1)' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { url: 'https://share.note.youdao.com/ynoteshare/index.html?type=note' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { url: 'https://share.note.youdao.com/ynoteshare/index.html?id=1&type=notebook' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('accepts canonical youdao share URLs', () => {
    expect(__test__.normalizeShareUrl('https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note#/')).toBe('https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note#/');
    expect(__test__.normalizeShareUrl('https://note.youdao.cn/ynoteshare/index.html?id=abc')).toBe('https://note.youdao.cn/ynoteshare/index.html?id=abc');
  });

  it('unwraps Browser Bridge envelopes and returns full note rows', async () => {
    const page = makePage({
      session: 'site:youdao:test',
      data: [true, 'Expert call', 'Question\nAnswer', 'Short summary', 'PCB | ABF', 1715750400000, 1234, true, 42, 'https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note#/'],
    });
    await expect(command.func(page, { url: 'https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note#/' }))
      .resolves.toEqual([{
        title: 'Expert call',
        content: 'Question\nAnswer',
        summary: 'Short summary',
        keywords: 'PCB | ABF',
        created_at: '2024-05-15T05:20:00.000Z',
        file_size: '1234',
        url: 'https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note#/',
      }]);
  });

  it('maps missing or expired shares to EmptyResultError', async () => {
    const page = makePage([false, 'not_found']);
    await expect(command.func(page, { url: 'https://share.note.youdao.com/ynoteshare/index.html?id=missing&type=note' }))
      .rejects.toBeInstanceOf(EmptyResultError);
  });

  it('maps permission/login pages to AuthRequiredError', async () => {
    const page = makePage([false, 'auth']);
    await expect(command.func(page, { url: 'https://share.note.youdao.com/ynoteshare/index.html?id=private&type=note' }))
      .rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('treats parser drift as CommandExecutionError instead of an empty success row', async () => {
    await expect(command.func(makePage([false, 'store_missing']), { url: 'https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
    await expect(command.func(makePage([true, 'Only title', '', '', '', null, null, false, 0, '']), { url: 'https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
    await expect(command.func(makePage([true, 'Bad body', '', '', '', null, null, true, 100, '']), { url: 'https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('wraps navigation and evaluate failures as CommandExecutionError', async () => {
    const navPage = makePage({});
    navPage.goto.mockRejectedValueOnce(new Error('network down'));
    await expect(command.func(navPage, { url: 'https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note' }))
      .rejects.toBeInstanceOf(CommandExecutionError);

    const evalPage = makePage({});
    evalPage.evaluate.mockRejectedValueOnce(new Error('bad script'));
    await expect(command.func(evalPage, { url: 'https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('keeps the full-content React store extractor contract in source', () => {
    const js = __test__.buildExtractorJs();
    expect(js).toContain('store.content');
    expect(js).toContain('contentData.content');
    expect(js).toContain('__reactContainer$');
    expect(js).toContain('walkText');
  });
});
