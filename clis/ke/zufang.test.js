import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './zufang.js';
import { buildZufangFilterPath } from './zufang-filters.js';

const cmd = () => getRegistry().get('ke/zufang');

function mockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
  };
}

describe('ke/zufang command', () => {
  it('registers with the new args', () => {
    const c = cmd();
    expect(c).toBeDefined();
    const names = c.args.map((a) => a.name);
    for (const n of ['rent-type', 'rooms', 'orientation', 'features',
                      'lease-term', 'floor', 'elevator', 'sort']) {
      expect(names).toContain(n);
    }
    const rt = c.args.find((a) => a.name === 'rent-type');
    expect(rt.choices).toEqual(['whole', 'shared']);
  });

  it('builds a URL with filters using the helper segment', async () => {
    const page = mockPage();
    const kwargs = { city: 'sh', district: 'pudong', 'rent-type': 'whole', rooms: 2, limit: 10 };
    await cmd().func(page, kwargs);
    const seg = buildZufangFilterPath(kwargs);
    expect(page.goto).toHaveBeenCalledWith(
      `https://sh.zu.ke.com/zufang/pudong/${seg}/`, expect.anything(),
    );
  });

  it('backward-compat: rent range only', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'sh', 'max-price': 8000, limit: 10 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://sh.zu.ke.com/zufang/rpt8000/', expect.anything(),
    );
  });

  it('no district, no filters', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.zu.ke.com/zufang/', expect.anything(),
    );
  });
});
