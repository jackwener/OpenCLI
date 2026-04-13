import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Strategy, getRegistry } from '@jackwener/opencli/registry';
import './docs.js';
import './tool.js';
import './electronics.js';
import './formula.js';

describe('saky command registration', () => {
  it('registers docs and all three query commands', () => {
    const docs = getRegistry().get('saky/docs');
    const tool = getRegistry().get('saky/tool');
    const electronics = getRegistry().get('saky/electronics');
    const formula = getRegistry().get('saky/formula');
    const alias = getRegistry().get('saky/elec');

    expect(docs).toBeDefined();
    expect(tool).toBeDefined();
    expect(electronics).toBeDefined();
    expect(formula).toBeDefined();
    expect(alias).toBe(electronics);
    expect(docs?.strategy).toBe(Strategy.PUBLIC);
    expect(tool?.strategy).toBe(Strategy.PUBLIC);
    expect(electronics?.strategy).toBe(Strategy.PUBLIC);
    expect(formula?.strategy).toBe(Strategy.PUBLIC);
    expect(docs?.browser).toBe(false);
    expect(tool?.browser).toBe(false);
    expect(electronics?.browser).toBe(false);
    expect(formula?.browser).toBe(false);
  });
});

describe('saky docs command', () => {
  it('returns the dataset summary rows', async () => {
    const docs = getRegistry().get('saky/docs');
    expect(docs?.func).toBeTypeOf('function');

    const result = await docs!.func!(null as never, {});
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'saky/tool', endpoint: '/warehouse_ai/product_label_info_tool' }),
        expect.objectContaining({ command: 'saky/electronics', endpoint: '/warehouse_ai/product_label_info_electronics' }),
        expect.objectContaining({ command: 'saky/formula', endpoint: '/warehouse_ai/product_label_info_formula' }),
      ]),
    );
  });
});

describe('saky query commands', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.SAKY_APPCODE;
    delete process.env.SAKY_APP_CODE;
    delete process.env.SAKY_BASE_URL;
    delete process.env.SAKY_PT;
  });

  it('uses APPCODE auth and maps tool rows', async () => {
    process.env.SAKY_APPCODE = 'test-code';
    const tool = getRegistry().get('saky/tool');
    expect(tool?.func).toBeTypeOf('function');

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      errCode: 0,
      errMsg: 'success',
      requestId: 'req-1',
      data: {
        totalNum: 12,
        pageSize: 5,
        pageNum: 2,
        rows: [
          { id: '1', cpmc: '成人牙刷', cpmcdh: '成人牙刷-产品', cptm: '6900001', cppl: '成人牙刷', pt: '20260409' },
        ],
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await tool!.func!(null as never, {
      'page-num': 2,
      'page-size': 5,
      pt: '20260409',
      'return-total-num': false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dataapi.weimeizi.com/warehouse/warehouse_ai/product_label_info_tool?pageNum=2&pageSize=5&pt=20260409&returnTotalNum=false',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'APPCODE test-code',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: '1',
        cpmc: '成人牙刷',
        cptm: '6900001',
        _requestId: 'req-1',
        _pageNum: 2,
        _pageSize: 5,
        _totalNum: 12,
      }),
    ]);
  });

  it('accepts app-code and base-url overrides', async () => {
    const formula = getRegistry().get('saky/formula');
    expect(formula?.func).toBeTypeOf('function');

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      errCode: 0,
      errMsg: 'success',
      requestId: 'req-2',
      data: {
        totalNum: 1,
        pageSize: 1,
        pageNum: 1,
        rows: [
          { id: 9, cpmc: '美白牙膏', cptxm: '6900009', cppl: '牙膏', pt: '20260409' },
        ],
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await formula!.func!(null as never, {
      'app-code': 'override-code',
      'base-url': 'https://internal.example.com/warehouse/',
      'page-num': 1,
      'page-size': 1,
      pt: '20260409',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://internal.example.com/warehouse/warehouse_ai/product_label_info_formula?pageNum=1&pageSize=1&pt=20260409&returnTotalNum=true',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'APPCODE override-code',
        }),
      }),
    );
  });

  it('raises a helpful error for warehouse SQL failures', async () => {
    process.env.SAKY_APPCODE = 'test-code';
    const electronics = getRegistry().get('saky/electronics');
    expect(electronics?.func).toBeTypeOf('function');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      errCode: 1108110565,
      errMsg: 'An error occurred while executing the SQL statement.',
      requestId: 'req-3',
      data: { rows: [] },
    }), { status: 200 })));

    await expect(electronics!.func!(null as never, { pt: '20260409' })).rejects.toThrow(
      'SAKY API error 1108110565',
    );
  });
});
