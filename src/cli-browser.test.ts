import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCdpConnect,
  mockBridgeConnect,
} = vi.hoisted(() => ({
  mockCdpConnect: vi.fn(),
  mockBridgeConnect: vi.fn(),
}));

vi.mock('./browser/index.js', () => ({
  BrowserBridge: class {
    connect = mockBridgeConnect;
    close = vi.fn();
  },
  CDPBridge: class {
    connect = mockCdpConnect;
    close = vi.fn();
  },
}));

import { createProgram } from './cli.js';

describe('browser manual CDP routing', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const page = {
      evaluate: vi.fn(),
      wait: vi.fn(),
    };

    mockBridgeConnect.mockResolvedValue(page);
    mockCdpConnect.mockResolvedValue(page);
  });

  it('uses CDPBridge when OPENCLI_CDP_ENDPOINT is set', async () => {
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', '  https://abcdef.ngrok.app  ');

    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'browser', 'back']);

    expect(mockCdpConnect).toHaveBeenCalledWith({
      timeout: 30,
      workspace: 'browser:default',
      cdpEndpoint: 'https://abcdef.ngrok.app',
    });
    expect(mockBridgeConnect).not.toHaveBeenCalled();
  });

  it('keeps BrowserBridge when OPENCLI_CDP_ENDPOINT is not set', async () => {
    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'browser', 'back']);

    expect(mockBridgeConnect).toHaveBeenCalledWith({
      timeout: 30,
      workspace: 'browser:default',
    });
    expect(mockCdpConnect).not.toHaveBeenCalled();
  });
});
