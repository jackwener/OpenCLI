import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './xiaoqu.js';
import { buildXiaoquFilterPath } from './xiaoqu-filters.js';

const cmd = () => getRegistry().get('ke/xiaoqu');

function mockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
  };
}

describe('ke/xiaoqu command', () => {
  it('registers with the new args', () => {
    const c = cmd();
    expect(c).toBeDefined();
    const names = c.args.map((a) => a.name);
    for (const n of ['min-price', 'max-price', 'age', 'near-subway', 'sort']) {
      expect(names).toContain(n);
    }
    const sortArg = c.args.find((a) => a.name === 'sort');
    expect(sortArg.choices).toEqual(['avg-price-asc', 'avg-price-desc']);
    const ns = c.args.find((a) => a.name === 'near-subway');
    expect(ns.type).toBe('boolean');
  });

  it('builds a URL with filters using the helper segment', async () => {
    const page = mockPage();
    const kwargs = { city: 'sh', district: 'xuhui', age: '10', 'near-subway': true, limit: 10 };
    await cmd().func(page, kwargs);
    const seg = buildXiaoquFilterPath(kwargs);
    expect(page.goto).toHaveBeenCalledWith(
      `https://sh.ke.com/xiaoqu/xuhui/${seg}/`, expect.anything(),
    );
  });

  it('backward-compat: no filters, with district', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'gz', district: 'tianhe', limit: 10 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://gz.ke.com/xiaoqu/tianhe/', expect.anything(),
    );
  });

  it('backward-compat: no district', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/xiaoqu/', expect.anything(),
    );
  });
});
