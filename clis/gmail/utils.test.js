import { describe, expect, it, vi } from 'vitest';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@jackwener/opencli/errors';
import {
  fetchThread,
  htmlToText,
  legacyThreadId,
  listLabels,
  parseAccount,
  parseBatchView,
  parseFetchData,
  parseLabels,
  parseLimit,
  queryThreads,
} from './utils.js';

function batchViewFixture({ threads = true, labels = true } = {}) {
  const body = Array(19).fill(null);
  if (threads) {
    const summary = [];
    summary[1] = [null, 'sender@example.com', 'Sender Name'];
    summary[10] = ['^u', '^t'];
    body[2] = [[[
      'Fixture subject',
      'Fixture snippet',
      1_700_000_000_000,
      'thread-f:1234567890123456789',
      [summary],
    ], null]];
  } else {
    body[2] = [];
  }
  if (labels) {
    body[1] = [
      [[ '^i', 'Inbox' ], null],
      [[ '^x_project', 'Project' ], null],
    ];
    body[6] = [[['^i', 2, 10], ['^x_project', 1, 3]]];
  } else {
    body[1] = [];
    body[6] = [[]];
  }
  return body;
}

function fetchDataFixture() {
  const body = [];
  const record = Array(35).fill(null);
  record[0] = [[null, 'to@example.com', 'To']];
  record[1] = [[null, 'cc@example.com', 'Cc']];
  record[4] = 'Fixture subject';
  record[5] = [null, [[null, null, [null, '<p>Hello <b>world</b></p>']]], 0, null, [null, null, null, null, null, null, 'Hello world']];
  record[6] = 'Fixture snippet';
  const sender = [];
  sender[14] = 'Sender Name';
  sender[16] = 'sender@example.com';
  record[10] = sender;
  record[13] = [[[null, 'attachment-1', null, [null, null, 'file.pdf', 'application/pdf', 1234]]]];
  record[16] = 1_700_000_001_000;
  record[34] = 'legacy-message-id';
  body[1] = [['thread-f:1234567890123456789', null, [['msg-f:1', record]]]];
  return body;
}

function batchPage(start, count) {
  const body = batchViewFixture({ labels: false });
  body[2] = Array.from({ length: count }, (_unused, offset) => {
    const record = structuredClone(body[2]?.[0]?.[0]);
    record[0] = `Fixture subject ${start + offset}`;
    record[2] = 1_700_000_000_000 + start + offset;
    record[3] = `thread-f:${1234567890123456789n + BigInt(start + offset)}`;
    return [[...record], null];
  });
  return body;
}

function captureEntry(path, body, overrides = {}) {
  return {
    url: `https://mail.google.com/sync/u/0/i/${path}`,
    responseStatus: 200,
    responsePreview: JSON.stringify(body),
    ...overrides,
  };
}

function capturePage(entry, query = 'is:unread') {
  let typed = '';
  const page = {
    getCurrentUrl: vi.fn().mockResolvedValue('https://mail.google.com/mail/u/0/#inbox'),
    goto: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
    startNetworkCapture: vi.fn().mockResolvedValue(true),
    readNetworkCapture: vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(entry ? [entry] : [])
      .mockResolvedValue([]),
    nativeType: vi.fn().mockImplementation(async (value) => { typed = value; }),
    nativeKeyPress: vi.fn().mockResolvedValue(undefined),
    nativeClick: vi.fn().mockResolvedValue(undefined),
    cdp: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async (source) => {
      const code = String(source);
      if (code.includes('!!document.querySelector')) return true;
      if (code.includes('field.select()')) return true;
      if (code.includes("document.querySelector('input[name=\"q\"]')?.value")) return typed || query;
      if (code.includes('data-legacy-thread-id')) return { found: false };
      if (code.includes("const target = '#all/")) return true;
      return true;
    }),
  };
  return page;
}

describe('gmail positional response parsers', () => {
  it('parses an arity-19 batch-view thread and labels', () => {
    const body = batchViewFixture();
    expect(parseBatchView(body)).toEqual([expect.objectContaining({
      threadId: 'thread-f:1234567890123456789',
      subject: 'Fixture subject',
      from: 'sender@example.com',
      unread: true,
      starred: true,
      date: '2023-11-14T22:13:20.000Z',
    })]);
    expect(parseLabels(body)).toEqual([
      { id: '^i', name: 'Inbox', type: 'system', unreadCount: 2, totalCount: 10 },
      { id: '^x_project', name: 'Project', type: 'user', unreadCount: 1, totalCount: 3 },
    ]);
  });

  it('parses fetch-data messages, bodies, recipients, and attachments', () => {
    expect(parseFetchData(fetchDataFixture())).toEqual([expect.objectContaining({
      messageId: 'msg-f:1',
      legacyMessageId: 'legacy-message-id',
      from: 'sender@example.com',
      to: 'to@example.com',
      cc: 'cc@example.com',
      body: 'Hello world',
      attachments: [{
        attachmentId: 'attachment-1',
        name: 'file.pdf',
        mimeType: 'application/pdf',
        size: 1234,
      }],
    })]);
  });

  it('rejects malformed positional arrays instead of returning partial data', () => {
    expect(() => parseBatchView([])).toThrow(CommandExecutionError);
    expect(() => parseLabels(Array(18).fill(null))).toThrow(CommandExecutionError);
    expect(() => parseFetchData([null, 'wrong'])).toThrow(CommandExecutionError);
  });

  it('converts HTML to readable text without scripts or styles', () => {
    expect(htmlToText('<style>.x{}</style><p>Hello&nbsp;<b>world</b></p><script>x()</script>'))
      .toBe('Hello world');
  });
});

describe('gmail input validation', () => {
  it('strictly validates limit and account values', () => {
    expect(parseLimit(50)).toBe(50);
    expect(parseAccount(2)).toBe(2);
    for (const value of [0, -1, 1.5, 'x', 201]) expect(() => parseLimit(value)).toThrow(ArgumentError);
    for (const value of [-1, 1.5, 'x', 21]) expect(() => parseAccount(value)).toThrow(ArgumentError);
  });

  it('accepts sync ids, legacy hex ids, and Gmail thread URLs', () => {
    expect(legacyThreadId('thread-f:1234567890123456789')).toBe(BigInt('1234567890123456789').toString(16));
    expect(legacyThreadId('18ABCDEF123')).toBe('18abcdef123');
    expect(legacyThreadId('https://mail.google.com/mail/u/0/#all/18ABCDEF123')).toBe('18abcdef123');
    expect(() => legacyThreadId('not-a-thread')).toThrow(ArgumentError);
  });
});

describe('gmail browser capture path', () => {
  it('queries threads through Gmail natural navigation and captured bv data', async () => {
    const page = capturePage(captureEntry('bv', batchViewFixture({ labels: false })), 'from:sender@example.com');
    const rows = await queryThreads(page, 'from:sender@example.com', { limit: 1, account: 0 });
    expect(page.nativeType).toHaveBeenCalledWith('from:sender@example.com');
    expect(page.cdp).toHaveBeenCalledWith('Input.dispatchKeyEvent', expect.objectContaining({ key: 'Enter' }));
    expect(rows).toHaveLength(1);
  });

  it('merges all completed captures so pagination cannot select a stale response', async () => {
    const first = captureEntry('bv', batchPage(0, 50));
    const second = captureEntry('bv', batchPage(50, 5));
    const page = capturePage(null, 'in:anywhere');
    page.readNetworkCapture
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([second, first])
      .mockResolvedValueOnce([]);
    page.evaluate.mockImplementation(async (source) => {
      const code = String(source);
      if (code.includes('!!document.querySelector')) return true;
      if (code.includes('field.select()')) return true;
      if (code.includes("document.querySelector('input[name=\"q\"]')?.value")) return 'in:anywhere';
      if (code.includes('getBoundingClientRect')) return { found: true, x: 1, y: 1 };
      return true;
    });

    const rows = await queryThreads(page, 'in:anywhere', { limit: 55, account: 0 });
    expect(rows).toHaveLength(55);
    expect(new Set(rows.map((row) => row.threadId)).size).toBe(55);
    expect(page.nativeClick).toHaveBeenCalledOnce();
  });

  it('rejects a repeated pagination response instead of returning partial rows', async () => {
    const first = captureEntry('bv', batchPage(0, 50));
    const page = capturePage(null, 'in:anywhere');
    page.readNetworkCapture
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([]);
    page.evaluate.mockImplementation(async (source) => {
      const code = String(source);
      if (code.includes('!!document.querySelector')) return true;
      if (code.includes('field.select()')) return true;
      if (code.includes("document.querySelector('input[name=\"q\"]')?.value")) return 'in:anywhere';
      if (code.includes('getBoundingClientRect')) return { found: true, x: 1, y: 1 };
      return true;
    });

    await expect(queryThreads(page, 'in:anywhere', { limit: 55, account: 0 }))
      .rejects.toThrow(/refusing partial results/);
  });

  it('rejects a completed short page when another capture was drained without a body', async () => {
    const completed = captureEntry('bv', batchPage(0, 5));
    const bodyless = {
      url: 'https://mail.google.com/sync/u/0/i/bv',
      responseStatus: 200,
    };
    const page = capturePage(null, 'in:anywhere');
    page.readNetworkCapture
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bodyless, completed])
      .mockResolvedValueOnce([]);

    await expect(queryThreads(page, 'in:anywhere', { limit: 10, account: 0 }))
      .rejects.toThrow(/refusing possibly partial results/);
  });

  it('lists labels through a fresh captured bv response', async () => {
    const page = capturePage(captureEntry('bv', batchViewFixture({ threads: false })));
    await expect(listLabels(page, 0)).resolves.toHaveLength(2);
    expect(page.nativeType).toHaveBeenCalledWith('in:anywhere');
  });

  it('loads a thread through a fresh captured fd response', async () => {
    const page = capturePage(captureEntry('fd', fetchDataFixture()));
    const messages = await fetchThread(page, 'thread-f:1234567890123456789', 0);
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('#all/112210f47de98115'));
    expect(messages).toHaveLength(1);
  });

  it('preserves typed auth, truncation, malformed, empty, and timeout failures', async () => {
    const authPage = capturePage(captureEntry('bv', [], { responseStatus: 401 }));
    await expect(queryThreads(authPage, 'is:unread', { limit: 1 })).rejects.toThrow(AuthRequiredError);

    const truncatedPage = capturePage(captureEntry('bv', [], { responseBodyTruncated: true }));
    await expect(queryThreads(truncatedPage, 'is:unread', { limit: 1 })).rejects.toThrow(/capture limit/);

    const malformedPage = capturePage(captureEntry('bv', [], { responsePreview: '{' }));
    await expect(queryThreads(malformedPage, 'is:unread', { limit: 1 })).rejects.toThrow(/malformed JSON/);

    const emptyPage = capturePage(captureEntry('bv', batchViewFixture({ threads: false, labels: false })));
    await expect(queryThreads(emptyPage, 'is:unread', { limit: 1 })).rejects.toThrow(EmptyResultError);

    vi.useFakeTimers();
    try {
      const timeoutPage = capturePage(null);
      timeoutPage.sleep.mockImplementation(async (seconds) => { vi.advanceTimersByTime(seconds * 1000); });
      await expect(queryThreads(timeoutPage, 'is:unread', { limit: 1 })).rejects.toThrow(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });
});
