import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './chengjiao.js';
import { buildChengjiaoFilterPath } from './chengjiao-filters.js';

const cmd = () => getRegistry().get('ke/chengjiao');

function mockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
  };
}

describe('ke/chengjiao command', () => {
  it('registers with the new args', () => {
    const c = cmd();
    expect(c).toBeDefined();
    const names = c.args.map((a) => a.name);
    for (const n of ['rooms', 'min-area', 'max-area', 'orientation', 'floor',
                      'age', 'decoration', 'usage', 'elevator', 'sort']) {
      expect(names).toContain(n);
    }
    const sortArg = c.args.find((a) => a.name === 'sort');
    expect(sortArg.choices).toContain('total-price-desc');
    // chengjiao sort must NOT offer 'newest'
    expect(sortArg.choices).not.toContain('newest');
  });

  it('builds a URL with filters using the helper segment', async () => {
    const page = mockPage();
    const kwargs = { city: 'sh', district: 'xuhui', rooms: 3, decoration: 'rough', limit: 10 };
    await cmd().func(page, kwargs);
    const seg = buildChengjiaoFilterPath(kwargs);
    expect(page.goto).toHaveBeenCalledWith(
      `https://sh.ke.com/chengjiao/xuhui/${seg}/`, expect.anything(),
    );
  });

  it('backward-compat: no filters, with district', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', district: 'haidian', limit: 10 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/chengjiao/haidian/', expect.anything(),
    );
  });

  it('backward-compat: no district', async () => {
    const page = mockPage();
    await cmd().func(page, { city: 'bj', limit: 20 });
    expect(page.goto).toHaveBeenCalledWith(
      'https://bj.ke.com/chengjiao/', expect.anything(),
    );
  });
});
