import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';
import {
  buildNotebooklmRpcBody,
  extractNotebooklmRpcResult,
  getNotebooklmPageAuth,
  parseNotebooklmChunkedResponse,
} from './rpc.js';

describe('notebooklm rpc transport', () => {
  it('extracts auth tokens from the page html via page evaluation', async () => {
    const page = {
      evaluate: vi.fn(async (script: string) => {
        expect(script).toContain('document.documentElement.innerHTML');
        return {
          html: '<html>"SNlM0e":"csrf-123","FdrFJe":"sess-456"</html>',
          sourcePath: '/',
        };
      }),
    } as unknown as IPage;

    await expect(getNotebooklmPageAuth(page)).resolves.toEqual({
      csrfToken: 'csrf-123',
      sessionId: 'sess-456',
      sourcePath: '/',
    });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('falls back to WIZ_global_data tokens when html regex data is missing', async () => {
    const page = {
      evaluate: vi.fn(async () => ({
        html: '<html><body>NotebookLM</body></html>',
        sourcePath: '/notebook/nb-demo',
        readyState: 'complete',
        csrfToken: 'csrf-wiz',
        sessionId: 'sess-wiz',
      })),
    } as unknown as IPage;

    await expect(getNotebooklmPageAuth(page)).resolves.toEqual({
      csrfToken: 'csrf-wiz',
      sessionId: 'sess-wiz',
      sourcePath: '/notebook/nb-demo',
    });
  });

  it('retries token extraction once when the first probe returns no tokens', async () => {
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          html: '<html><body>Loading…</body></html>',
          sourcePath: '/notebook/nb-demo',
          readyState: 'interactive',
          csrfToken: '',
          sessionId: '',
        })
        .mockResolvedValueOnce({
          html: '<html>"SNlM0e":"csrf-123","FdrFJe":"sess-456"</html>',
          sourcePath: '/notebook/nb-demo',
          readyState: 'complete',
          csrfToken: '',
          sessionId: '',
        }),
      wait: vi.fn(async () => undefined),
    } as unknown as IPage;

    await expect(getNotebooklmPageAuth(page)).resolves.toEqual({
      csrfToken: 'csrf-123',
      sessionId: 'sess-456',
      sourcePath: '/notebook/nb-demo',
    });
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('builds the rpc body with the expected notebooklm payload shape', () => {
    const body = buildNotebooklmRpcBody('wXbhsf', [null, 1, null, [2]], 'csrf-123');

    expect(body).toContain('f.req=');
    expect(body).toContain('at=csrf-123');
    expect(body.endsWith('&')).toBe(true);
    expect(decodeURIComponent(body)).toContain('"[null,1,null,[2]]"');
  });

  it('parses chunked batchexecute responses into json chunks', () => {
    const raw = `)]}'\n107\n[["wrb.fr","wXbhsf","[[[\\\"Notebook One\\\",null,\\\"nb1\\\",null,null,[null,false,null,null,null,[1704067200]]]]]"]]`;
    const chunks = parseNotebooklmChunkedResponse(raw);

    expect(chunks).toHaveLength(1);
    expect(Array.isArray(chunks[0])).toBe(true);
    expect(chunks[0]).toEqual([
      [
        'wrb.fr',
        'wXbhsf',
        '[[["Notebook One",null,"nb1",null,null,[null,false,null,null,null,[1704067200]]]]]',
      ],
    ]);
  });

  it('extracts the rpc payload from wrb.fr responses', () => {
    const raw = `)]}'\n107\n[["wrb.fr","wXbhsf","[[[\\\"Notebook One\\\",null,\\\"nb1\\\",null,null,[null,false,null,null,null,[1704067200]]]]]"]]`;

    const result = extractNotebooklmRpcResult(raw, 'wXbhsf');

    expect(result).toEqual([
      [
        ['Notebook One', null, 'nb1', null, null, [null, false, null, null, null, [1704067200]]],
      ],
    ]);
  });

  it('classifies auth errors as AuthRequiredError', () => {
    const raw = `)]}'\n25\n[["er",null,null,null,null,401,"generic"]]`;

    expect(() => extractNotebooklmRpcResult(raw, 'wXbhsf')).toThrow(AuthRequiredError);

    try {
      extractNotebooklmRpcResult(raw, 'wXbhsf');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthRequiredError);
      expect((error as AuthRequiredError).domain).toBe('notebooklm.google.com');
      expect((error as AuthRequiredError).code).toBe('AUTH_REQUIRED');
    }
  });
});
