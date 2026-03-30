import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBindCurrentTab } = vi.hoisted(() => ({
  mockBindCurrentTab: vi.fn(),
}));

vi.mock('../../browser/daemon-client.js', () => ({
  bindCurrentTab: mockBindCurrentTab,
}));

import { getRegistry } from '../../registry.js';
import './bind-current.js';

describe('notebooklm bind-current', () => {
  const command = getRegistry().get('notebooklm/bind-current');

  beforeEach(() => {
    mockBindCurrentTab.mockReset();
  });

  it('binds the current notebook tab into site:notebooklm', async () => {
    mockBindCurrentTab.mockResolvedValue({
      workspace: 'site:notebooklm',
      tabId: 123,
      title: 'Bound Notebook',
      url: 'https://notebooklm.google.com/notebook/nb-live',
    });

    const result = await command!.func!({} as any, {});

    expect(mockBindCurrentTab).toHaveBeenCalledWith('site:notebooklm', {
      matchDomain: 'notebooklm.google.com',
      matchPathPrefix: '/notebook/',
    });
    expect(result).toEqual([{
      workspace: 'site:notebooklm',
      tab_id: 123,
      notebook_id: 'nb-live',
      title: 'Bound Notebook',
      url: 'https://notebooklm.google.com/notebook/nb-live',
    }]);
  });
});
