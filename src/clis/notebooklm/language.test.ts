import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetNotebooklmOutputLanguageViaRpc,
  mockSetNotebooklmOutputLanguageViaRpc,
} = vi.hoisted(() => ({
  mockGetNotebooklmOutputLanguageViaRpc: vi.fn(),
  mockSetNotebooklmOutputLanguageViaRpc: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getNotebooklmOutputLanguageViaRpc: mockGetNotebooklmOutputLanguageViaRpc,
    setNotebooklmOutputLanguageViaRpc: mockSetNotebooklmOutputLanguageViaRpc,
  };
});

import { getRegistry } from '../../registry.js';
import './language-get.js';
import './language-list.js';
import './language-set.js';

describe('notebooklm language commands', () => {
  const listCommand = getRegistry().get('notebooklm/language-list');
  const getCommand = getRegistry().get('notebooklm/language-get');
  const setCommand = getRegistry().get('notebooklm/language-set');

  beforeEach(() => {
    mockGetNotebooklmOutputLanguageViaRpc.mockReset();
    mockSetNotebooklmOutputLanguageViaRpc.mockReset();
  });

  it('lists supported language codes from the static upstream table', async () => {
    const result = await listCommand!.func!({} as any, {});

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'en', name: 'English', source: 'static' }),
        expect.objectContaining({ code: 'zh_Hans', name: '中文（简体）', source: 'static' }),
      ]),
    );
  });

  it('gets the current output language via rpc', async () => {
    mockGetNotebooklmOutputLanguageViaRpc.mockResolvedValue({
      language: 'ja',
      name: '日本語',
      source: 'rpc',
    });

    const result = await getCommand!.func!({} as any, {});

    expect(mockGetNotebooklmOutputLanguageViaRpc).toHaveBeenCalledWith(expect.anything());
    expect(result).toEqual([
      {
        language: 'ja',
        name: '日本語',
        source: 'rpc',
      },
    ]);
  });

  it('sets the current output language via rpc', async () => {
    mockSetNotebooklmOutputLanguageViaRpc.mockResolvedValue({
      language: 'zh_Hans',
      name: '中文（简体）',
      source: 'rpc',
    });

    const result = await setCommand!.func!({} as any, { code: 'zh_Hans' });

    expect(mockSetNotebooklmOutputLanguageViaRpc).toHaveBeenCalledWith(expect.anything(), 'zh_Hans');
    expect(result).toEqual([
      {
        language: 'zh_Hans',
        name: '中文（简体）',
        source: 'rpc',
      },
    ]);
  });
});
