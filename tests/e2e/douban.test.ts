import { describe, it, expect } from 'vitest';
import { parseJsonOutput, runCli } from './helpers.js';

function isEnvironmentSkip(result: { code: number; stdout: string; stderr: string }) {
  const text = `${result.stderr}\n${result.stdout}`;
  return /AUTH_REQUIRED|Browser Bridge.*not connected|Extension.*not connected|异常请求|sec\.douban\.com|captcha/i.test(text);
}

async function runDoubanJsonOrSkip(args: string[], label: string) {
  const result = await runCli(args, { timeout: 90_000 });
  if (result.code !== 0) {
    if (isEnvironmentSkip(result)) {
      console.warn(`${label}: skipped — douban login or browser environment is unavailable`);
      return null;
    }
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }

  const data = parseJsonOutput(result.stdout);
  if (!Array.isArray(data)) {
    throw new Error(`${label} returned non-array JSON:\n${result.stdout.slice(0, 500)}`);
  }
  return data;
}

describe('douban browser e2e', () => {
  it('search --type book returns structured candidates', async () => {
    const data = await runDoubanJsonOrSkip(['douban', 'search', '--type', 'book', '三体', '--limit', '3', '-f', 'json'], 'douban search book');
    if (data === null) return;

    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('id');
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('url');
  }, 90_000);

  it('subject --type book returns normalized detail fields', async () => {
    const data = await runDoubanJsonOrSkip(['douban', 'subject', '2567698', '--type', 'book', '-f', 'json'], 'douban subject book');
    if (data === null) return;

    expect(data.length).toBe(1);
    expect(data[0]).toMatchObject({
      id: '2567698',
      type: 'book',
    });
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('authors');
    expect(data[0]).toHaveProperty('publisher');
    expect(data[0]).toHaveProperty('rating');
    expect(data[0]).toHaveProperty('url');
  }, 90_000);
});
