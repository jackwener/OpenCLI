import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';

const { mockApiGet, mockDownloadMedia, mockCheckYtdlp } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockDownloadMedia: vi.fn(),
  mockCheckYtdlp: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  apiGet: mockApiGet,
}));

vi.mock('@jackwener/opencli/download', () => ({
  checkYtdlp: mockCheckYtdlp,
  sanitizeFilename: (s) => s,
}));

vi.mock('@jackwener/opencli/download/media-download', () => ({
  downloadMedia: mockDownloadMedia,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './download.js';

/** view API 成功响应的最小骨架 */
function viewPayload(extra = {}) {
  return { code: 0, data: { bvid: 'BV1xx411c7mD', rights: {}, ...extra } };
}

describe('bilibili download paid-content pre-check', () => {
  const command = getRegistry().get('bilibili/download');
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ title: '标题', author: 'UP主' }),
    getCookies: vi.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    mockApiGet.mockReset();
    mockDownloadMedia.mockReset();
    mockCheckYtdlp.mockReset();
    mockCheckYtdlp.mockReturnValue(true);
    mockDownloadMedia.mockResolvedValue([{ status: 'success', size: '10MB' }]);
    page.goto.mockClear();
    page.evaluate.mockClear();
  });

  it('downloads normal (free) video without interference', async () => {
    mockApiGet.mockResolvedValueOnce(viewPayload());

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD', output: './o', quality: 'best', force: false });

    expect(rows[0].status).toBe('success');
    expect(mockDownloadMedia).toHaveBeenCalledTimes(1);
  });

  it('throws PAID_CONTENT for member-only bangumi when account has no vip', async () => {
    mockApiGet
      .mockResolvedValueOnce(viewPayload({ rights: { pay: 1 } })) // view
      .mockResolvedValueOnce({ code: 0, data: { vipStatus: 0 } }); // nav

    await expect(
      command.func(page, { bvid: 'BV1xx411c7mD', output: './o', quality: 'best', force: false }),
    ).rejects.toSatisfy((err) => err instanceof CliError && err.code === 'PAID_CONTENT');
    expect(mockDownloadMedia).not.toHaveBeenCalled();
  });

  it('allows member-only content when account has active vip', async () => {
    mockApiGet
      .mockResolvedValueOnce(viewPayload({ rights: { pay: 1 } }))
      .mockResolvedValueOnce({ code: 0, data: { vipStatus: 1 } });

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD', output: './o', quality: 'best', force: false });

    expect(rows[0].status).toBe('success');
    expect(mockDownloadMedia).toHaveBeenCalledTimes(1);
  });

  it('throws PAID_CONTENT for upower-exclusive video (no entitlement endpoint, conservative block)', async () => {
    mockApiGet.mockResolvedValueOnce(viewPayload({ is_upower_exclusive: true }));

    await expect(
      command.func(page, { bvid: 'BV1xx411c7mD', output: './o', quality: 'best', force: false }),
    ).rejects.toSatisfy((err) => err instanceof CliError && err.code === 'PAID_CONTENT');
    // upower 没有权益查询端点，不应再打 nav API
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockDownloadMedia).not.toHaveBeenCalled();
  });

  it('fails closed when successful view payload lacks paid-content metadata', async () => {
    mockApiGet.mockResolvedValueOnce({ code: 0, data: { bvid: 'BV1xx411c7mD' } });

    await expect(
      command.func(page, { bvid: 'BV1xx411c7mD', output: './o', quality: 'best', force: false }),
    ).rejects.toSatisfy(
      (err) => err instanceof CommandExecutionError && /paid-content metadata/.test(err.message),
    );
    expect(mockDownloadMedia).not.toHaveBeenCalled();
  });

  it('skips pre-check entirely with --force', async () => {
    const rows = await command.func(page, { bvid: 'BV1xx411c7mD', output: './o', quality: 'best', force: true });

    expect(rows[0].status).toBe('success');
    expect(mockApiGet).not.toHaveBeenCalled();
    expect(mockDownloadMedia).toHaveBeenCalledTimes(1);
  });

  it('does not block download when the pre-check API itself fails', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('network down'));

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD', output: './o', quality: 'best', force: false });

    expect(rows[0].status).toBe('success');
    expect(mockDownloadMedia).toHaveBeenCalledTimes(1);
  });
});
