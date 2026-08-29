import { describe, expect, it } from 'vitest';
import { browserSession, type IBrowserFactory } from './runtime.js';
import type { IPage } from './types.js';

describe('browserSession', () => {
  it('forwards the app CDP target filter to the browser factory', async () => {
    let connectOptions: Parameters<IBrowserFactory['connect']>[0];
    class TestBrowser implements IBrowserFactory {
      async connect(options?: Parameters<IBrowserFactory['connect']>[0]) {
        connectOptions = options;
        return {} as IPage;
      }

      async close() {}
    }

    await browserSession(TestBrowser, async () => true, {
      cdpEndpoint: 'http://127.0.0.1:9225',
      cdpTargetFilter: 'doubao-chat/chat',
    });

    expect(connectOptions).toMatchObject({
      cdpEndpoint: 'http://127.0.0.1:9225',
      cdpTargetFilter: 'doubao-chat/chat',
    });
  });
});
