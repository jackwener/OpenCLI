import { describe, expect, it } from 'vitest';
import { __test__ } from './auth.js';

describe('shein auth adapter', () => {
  it('builds a page-request capture auth probe', () => {
    const script = __test__.buildCaptureListScript();

    expect(script).toContain('/gsp/aftersalesOrder/list');
    expect(script).toContain('window.fetch = async function');
    expect(script).toContain('XMLHttpRequest.prototype');
    expect(script).toContain("textOf(el).includes('搜索')");
  });

  it('extracts a captured list response', () => {
    const payload = __test__.extractListCapture([
      {
        url: '/gsp/aftersalesOrder/list',
        responseStatus: 200,
        responsePreview: '{"code":0,"info":{"data":[{"site":"shein-jp"}]}}',
      },
    ]);

    expect(payload.info.data[0].site).toBe('shein-jp');
  });

  it('parses cookie values used for identity summary', () => {
    const cookie = 'foo=bar; gsp_store_site=shein-jp; SITE_ID=05c6226e-dc9c-4969-869d-1a00665bf10a';

    expect(__test__.parseCookieValue(cookie, 'gsp_store_site')).toBe('shein-jp');
    expect(__test__.parseCookieValue(cookie, 'SITE_ID')).toBe('05c6226e-dc9c-4969-869d-1a00665bf10a');
    expect(__test__.parseCookieValue(cookie, 'missing')).toBe('');
  });

  it('builds an automatic login autofill script', () => {
    const script = __test__.buildAutofillLoginScript('maibeiAI', 'secret');

    expect(script).toContain('const username = "maibeiAI";');
    expect(script).toContain('const password = "secret";');
    expect(script).toContain("querySelectorAll('input')");
    expect(script).toContain('login inputs not found');
    expect(script).toContain('login button not found');
  });
});
