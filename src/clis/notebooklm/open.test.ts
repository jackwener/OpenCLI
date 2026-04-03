import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetNotebooklmPageState,
  mockReadCurrentNotebooklm,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockGetNotebooklmPageState: vi.fn(),
  mockReadCurrentNotebooklm: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    readCurrentNotebooklm: mockReadCurrentNotebooklm,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './open.js';

describe('notebooklm open', () => {
  const command = getRegistry().get('notebooklm/open');

  beforeEach(() => {
    mockGetNotebooklmPageState.mockReset();
    mockReadCurrentNotebooklm.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockRequireNotebooklmSession.mockResolvedValue(undefined);
    mockGetNotebooklmPageState.mockResolvedValue({
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      title: 'Browser Automation',
      hostname: 'notebooklm.google.com',
      kind: 'notebook',
      notebookId: 'nb-demo',
      loginRequired: false,
      notebookCount: 1,
    });
    mockReadCurrentNotebooklm.mockResolvedValue({
      id: 'nb-demo',
      title: 'Browser Automation',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'current-page',
    });
  });

  it('opens a notebook by id in the automation workspace', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      wait: vi.fn(async () => {}),
    };

    const result = await command!.func!(page as any, { notebook: 'nb-demo' });

    expect(page.goto).toHaveBeenCalledWith('https://notebooklm.google.com/notebook/nb-demo');
    expect(result).toEqual([{
      id: 'nb-demo',
      title: 'Browser Automation',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'current-page',
    }]);
  });

  it('accepts a full notebook url', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      wait: vi.fn(async () => {}),
    };

    await command!.func!(page as any, { notebook: 'https://notebooklm.google.com/notebook/nb-demo?pli=1' });

    expect(page.goto).toHaveBeenCalledWith('https://notebooklm.google.com/notebook/nb-demo');
  });
});
