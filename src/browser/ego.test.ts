import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrowserFactory } from '../runtime.js';
import { BrowserBridge, CDPBridge } from './index.js';
import { EgoBridge } from './ego.js';
import { runEgo } from './ego-transport.js';

vi.mock('./ego-transport.js');

const personalTab = { label: 'p1', targetId: 'manual', openedBy: 'unknown', active: true, url: 'https://personal.example' };
const agentTab = { label: 'p2', targetId: 'agent', openedBy: 'agent', active: false, url: 'about:blank' };

describe('Ego browser backend', () => {
  const page = {
    goto: vi.fn(),
    url: vi.fn(() => agentTab.url),
    evaluate: vi.fn(),
    cdp: vi.fn(),
    close: vi.fn(),
  };
  const task = {
    spaceId: 41,
    ownership: 'agent',
    tabs: vi.fn(() => [personalTab, agentTab]),
    page: vi.fn(() => page),
    finish: vi.fn(),
  };
  const taskSpace = vi.fn(() => task);

  beforeEach(() => {
    vi.clearAllMocks();
    task.ownership = 'agent';
    vi.mocked(runEgo).mockImplementation((body, input) =>
      new Function('input', 'taskSpace', `return (async () => { ${body} })();`)(input, taskSpace));
  });

  afterEach(() => vi.unstubAllEnvs());

  it('opts both browser entry points into Ego and keeps the legacy routing', () => {
    vi.stubEnv('OPENCLI_BROWSER_BACKEND', undefined);
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', undefined);
    expect(getBrowserFactory()).toBe(BrowserBridge);
    expect(getBrowserFactory('browser')).toBe(BrowserBridge);
    vi.stubEnv('OPENCLI_BROWSER_BACKEND', 'ego');
    expect(getBrowserFactory()).toBe(EgoBridge);
    expect(getBrowserFactory('browser')).toBe(EgoBridge);
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://localhost:9222');
    expect(() => getBrowserFactory()).toThrow(/Unset OPENCLI_CDP_ENDPOINT/);
    vi.stubEnv('OPENCLI_BROWSER_BACKEND', undefined);
    expect(getBrowserFactory()).toBe(CDPBridge);
    expect(getBrowserFactory('browser')).toBe(BrowserBridge);
  });

  it('uses the agent Page inside the resolved Space, rejecting unmanaged tabs', async () => {
    const bridge = new EgoBridge();
    const ego = await bridge.connect({ session: 'research', surface: 'browser' });
    expect(taskSpace).toHaveBeenCalledWith(expect.stringContaining('OpenCLI browser:research'));
    expect(ego.getActivePage()).toBe('agent');
    expect(await ego.tabs()).toEqual([{ page: 'agent', url: 'about:blank', active: false, title: undefined }]);
    await expect(ego.closeTab('manual')).rejects.toThrow(/no longer in this OpenCLI Space/);
    expect(page.close).not.toHaveBeenCalled();
    await ego.goto('https://example.com', { waitUntil: 'none' });
    expect(taskSpace).toHaveBeenLastCalledWith(41);
    expect(task.page).toHaveBeenLastCalledWith('p2');
    expect(page.goto).toHaveBeenCalledWith('https://example.com', { waitUntil: 'commit' });
    await ego.closeWindow();
    expect(task.finish).toHaveBeenCalledWith({ keep: [] });
    await expect(ego.tabs()).rejects.toThrow(/connection is closed/);
  });

  it('fails closed when a user takes control during a command sequence', async () => {
    const ego = await new EgoBridge().connect({ session: 'research' });
    task.ownership = 'user';
    await expect(ego.goto('https://example.com')).rejects.toThrow(/agent-owned Ego Space/);
    await expect(ego.closeWindow()).rejects.toThrow(/agent-owned Ego Space/);
    expect(page.goto).not.toHaveBeenCalled();
    expect(task.finish).not.toHaveBeenCalled();
  });

  it('passes Unicode arguments to page-scoped CDP and evaluates a write only once', async () => {
    const ego = await new EgoBridge().connect({ session: 'research' });
    page.cdp.mockResolvedValueOnce({ result: { value: '小红书' } });
    expect(await ego.evaluate((value: string) => value, '小红书')).toBe('小红书');
    expect(page.cdp).toHaveBeenLastCalledWith('Runtime.evaluate',
      { expression: expect.stringContaining('小红书'), awaitPromise: true, returnByValue: true }, { timeout: 55_000 });
    page.cdp.mockRejectedValueOnce(new Error('unknown outcome'));
    await expect(ego.evaluateOnce('submit()')).rejects.toThrow(/unknown outcome/);
    expect(page.cdp).toHaveBeenCalledTimes(2);
  });
});
