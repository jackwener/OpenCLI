import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ershoufang.js';

const cmd = () => getRegistry().get('ke/ershoufang');

function mockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    // readPageState + the list scrape both call evaluate; '' state => not blocked
    evaluate: vi.fn().mockResolvedValue([]),
  };
}

describe('ke/ershoufang command', () => {
  it('registers with the new args', () => {
    const c = cmd();
    expect(c).toBeDefined();
    const names = c.args.map((a) => a.name);
    for (const n of ['orientation', 'floor', 'age', 'decoration', 'elevator',
                      'features', 'usage', 'min-area', 'max-area', 'sort']) {
      expect(names).toContain(n);
    }
    const sortArg = c.args.find((a) => a.name === 'sort');
    expect(sortArg.choices).toContain('total-price-desc');
  });

  it('builds a URL with filters + sort in canonical order', async () => {
    const page = mockPage();
    await cmd().func(page, {
      city: 'hz', district: 'xihuqu4', rooms: 3, decoration: 'rough', sort: 'newest', limit: 10,
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://hz.ke.com/ershoufang/xihuqu4/co32de3l3/', expect.anything(),
    );
  });

  it('backward-compat: rooms only', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', rooms: 2, limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/ershoufang/l2/', expect.anything(),
    );
  });

  it('no district, no filters', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/ershoufang/', expect.anything(),
    );
  });
});
