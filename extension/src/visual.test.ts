import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureVisibleTab, focusedControl, pointAction, typeFocusedText } from './visual';

const targetTab = { id: 7, windowId: 3, url: 'https://example.test/form' };
const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

function mockChrome(activeTabId = 7) {
  const tabs = {
    get: vi.fn(async () => targetTab),
    query: vi.fn(async () => [{ id: activeTabId }]),
    captureVisibleTab: vi.fn(async () => dataUrl),
    update: vi.fn(),
  };
  const scripting = {
    executeScript: vi.fn(async (request: { target: { frameIds: number[] }; func: Function }) => {
      if (request.func.name === 'readViewport') {
        return [{ result: { url: targetTab.url, width: 100, height: 50 } }];
      }
      if (request.func.name === 'readFocusedControl') {
        return [{ result: request.target.frameIds[0] === 2
          ? { kind: 'textarea', hasFocus: true }
          : { kind: 'other', hasFocus: false } }];
      }
      if (request.func.name === 'pointInFrame') return [{ result: request.target.frameIds[0] === 0
        ? { kind: 'iframe', src: 'https://chat.example.test/frame', left: 5, top: 2, clientLeft: 0, clientTop: 0, transform: 'none' }
        : { kind: 'element', tag: 'BUTTON' } }];
      if (request.func.name === 'insertFocusedText') return [{ result: { typed: true, kind: 'textarea' } }];
      return [{ result: { ready: true } }];
    }),
  };
  const webNavigation = {
    getAllFrames: vi.fn(async () => [
      { frameId: 0, parentFrameId: -1, url: targetTab.url },
      { frameId: 1, parentFrameId: 0, url: 'chrome-extension://icloud/menu.html' },
      { frameId: 2, parentFrameId: 0, url: 'https://chat.example.test/frame' },
    ]),
  };
  vi.stubGlobal('chrome', { tabs, scripting, webNavigation });
  return { tabs, scripting, webNavigation };
}

beforeEach(() => vi.unstubAllGlobals());

describe('debugger-free visual path', () => {
  it('captures only the exact active web tab without focusing or switching tabs', async () => {
    const { tabs } = mockChrome();
    const result = await captureVisibleTab(7);
    expect(result).toEqual({ url: targetTab.url, cssWidth: 100, cssHeight: 50, data: 'iVBORw0KGgo=', transport: 'extension' });
    expect(tabs.captureVisibleTab).toHaveBeenCalledWith(3, { format: 'png' });
    expect(tabs.update).not.toHaveBeenCalled();
  });

  it('refuses to capture a different active tab', async () => {
    const { tabs } = mockChrome(8);
    await expect(captureVisibleTab(7)).rejects.toThrow('not the active tab');
    expect(tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('skips the protected iCloud frame and reaches the page iframe', async () => {
    const { scripting } = mockChrome();
    await expect(pointAction(7, 'click', 20, 10)).resolves.toEqual({ dispatched: true, input: 'synthetic', tag: 'BUTTON' });
    const frames = scripting.executeScript.mock.calls.map(([request]) => request.target.frameIds[0]);
    expect(frames).toContain(2);
    expect(frames).not.toContain(1);
    expect(frames).toEqual([0, 2]);
  });

  it('inserts text only in the uniquely focused child frame', async () => {
    const { scripting } = mockChrome();
    await expect(focusedControl(7)).resolves.toEqual({ kind: 'textarea', frameId: 2 });
    await expect(typeFocusedText(7, '你好 OpenCLI')).resolves.toEqual({ typed: true, kind: 'textarea', frameId: 2, input: 'synthetic' });
    const final = scripting.executeScript.mock.calls.at(-1)?.[0];
    expect(final?.target.frameIds).toEqual([2]);
  });
});
