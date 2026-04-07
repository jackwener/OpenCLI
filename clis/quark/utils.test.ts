import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';
import { apiGet, apiPost, extractPwdId, getToken } from './utils.js';

function makePage(evaluateImpl: (js: string) => unknown | Promise<unknown>): IPage {
  return {
    evaluate: vi.fn(evaluateImpl),
  } as unknown as IPage;
}

describe('quark utils', () => {
  it('extractPwdId accepts share URLs and raw ids', () => {
    expect(extractPwdId('https://pan.quark.cn/s/abc123')).toBe('abc123');
    expect(extractPwdId('abc123')).toBe('abc123');
  });

  it('maps JSON auth failures to AuthRequiredError', async () => {
    const page = makePage(async () => ({
      status: 401,
      code: 401,
      message: '未登录',
      data: null,
    }));

    await expect(apiGet(page, 'https://drive-pc.quark.cn/test')).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps non-JSON auth pages to AuthRequiredError', async () => {
    const page = makePage(async () => {
      const error = Object.assign(new Error('Non-JSON response: <html><title>登录</title></html>'), { status: 401 });
      throw error;
    });

    await expect(apiPost(page, 'https://drive-pc.quark.cn/test', {})).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('keeps generic API failures as CommandExecutionError', async () => {
    const page = makePage(async () => ({
      status: 500,
      code: 500,
      message: 'server busy',
      data: null,
    }));

    await expect(apiGet(page, 'https://drive-pc.quark.cn/test')).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('unwraps successful token responses', async () => {
    const page = makePage(async () => ({
      status: 200,
      code: 0,
      message: 'ok',
      data: { stoken: 'token123' },
    }));

    await expect(getToken(page, 'abc123')).resolves.toBe('token123');
  });
});
