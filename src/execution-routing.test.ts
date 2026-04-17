import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBrowserSession,
  mockGetDaemonHealth,
  mockProbeCDP,
  mockResolveElectronEndpoint,
  mockEmitHook,
} = vi.hoisted(() => ({
  mockBrowserSession: vi.fn(async (_Factory, fn) => fn({
    goto: vi.fn(),
    wait: vi.fn(),
  } as any)),
  mockGetDaemonHealth: vi.fn(),
  mockProbeCDP: vi.fn(),
  mockResolveElectronEndpoint: vi.fn(),
  mockEmitHook: vi.fn(),
}));

vi.mock('./runtime.js', async () => {
  const actual = await vi.importActual<typeof import('./runtime.js')>('./runtime.js');
  return {
    ...actual,
    browserSession: mockBrowserSession,
  };
});

vi.mock('./browser/daemon-client.js', () => ({
  getDaemonHealth: mockGetDaemonHealth,
}));

vi.mock('./launcher.js', () => ({
  probeCDP: mockProbeCDP,
  resolveElectronEndpoint: mockResolveElectronEndpoint,
}));

vi.mock('./hooks.js', () => ({
  emitHook: mockEmitHook,
}));

import { CDPBridge } from './browser/index.js';
import { executeCommand } from './execution.js';
import { cli, Strategy } from './registry.js';

const youtubeCommand = cli({
  site: 'youtube',
  name: 'search',
  description: 'search',
  browser: true,
  strategy: Strategy.COOKIE,
  domain: 'www.youtube.com',
  navigateBefore: false,
  func: vi.fn(async () => 'ok'),
});

const cursorCommand = cli({
  site: 'cursor',
  name: 'status',
  description: 'status',
  browser: true,
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  func: vi.fn(async () => 'ok'),
});

describe('executeCommand manual CDP routing', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mockGetDaemonHealth.mockResolvedValue({ state: 'ready', status: { extensionConnected: true } });
    mockProbeCDP.mockResolvedValue(true);
    mockResolveElectronEndpoint.mockResolvedValue('http://127.0.0.1:9333');
  });

  it('uses CDPBridge for non-Electron browser commands when OPENCLI_CDP_ENDPOINT is set', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'https://abcdef.ngrok.app');

    await expect(executeCommand(youtubeCommand, {})).resolves.toBe('ok');

    expect(mockGetDaemonHealth).not.toHaveBeenCalled();
    expect(mockProbeCDP).not.toHaveBeenCalled();
    expect(mockBrowserSession).toHaveBeenCalledWith(
      CDPBridge,
      expect.any(Function),
      expect.objectContaining({ cdpEndpoint: 'https://abcdef.ngrok.app' }),
    );
  });

  it('preserves manual-endpoint validation for Electron apps', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9222');

    await expect(executeCommand(cursorCommand, {})).resolves.toBe('ok');

    expect(mockProbeCDP).toHaveBeenCalledWith(9222);
    expect(mockGetDaemonHealth).not.toHaveBeenCalled();
  });

  it('keeps Browser Bridge checks when no manual endpoint is set', async () => {
    mockGetDaemonHealth.mockResolvedValue({ state: 'no-extension', status: { extensionConnected: false } });

    await expect(executeCommand(youtubeCommand, {})).rejects.toThrow('Browser Bridge extension not connected');
  });
});
