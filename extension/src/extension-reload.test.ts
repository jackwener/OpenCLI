import { describe, expect, it, vi } from 'vitest';
import { createExtensionReloader } from './extension-reload';

function createFixture() {
  const deps = {
    ready: vi.fn(async () => {}),
    isIdle: vi.fn(() => true),
    reload: vi.fn(),
    schedule: vi.fn(),
  };
  return { deps, guard: createExtensionReloader(deps) };
}

describe('createExtensionReloader', () => {
  it('reloads once after ACK is delivered and blocks subsequent commands', async () => {
    const { deps, guard } = createFixture();
    const reply = await guard.prepare({ id: 'one', action: 'chrome-call', chromeMethod: 'runtime.reload' });

    expect(reply).toMatchObject({ ok: true, data: { reloading: true } });
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.schedule).not.toHaveBeenCalled();

    guard.acknowledge(reply, true);
    guard.acknowledge(reply, true);
    expect(deps.schedule).toHaveBeenCalledTimes(1);

    (deps.schedule.mock.calls[0][0] as () => void)();
    expect(deps.reload).toHaveBeenCalledTimes(1);

    expect((await guard.prepare({ id: 'two', action: 'chrome-call' })).ok).toBe(false);
  });

  it('rejects reload while a command is in flight', async () => {
    const { deps, guard } = createFixture();
    deps.isIdle.mockReturnValue(false);

    const reply = await guard.prepare({ id: 'one', action: 'chrome-call', chromeMethod: 'runtime.reload' });
    expect(reply).toMatchObject({ ok: false, errorCode: 'extension_reload_busy' });
    expect(guard.isPending()).toBe(false);
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.schedule).not.toHaveBeenCalled();
  });

  it('releases the latch without reloading if ACK delivery fails', async () => {
    const { deps, guard } = createFixture();
    const reply = await guard.prepare({ id: 'one', action: 'chrome-call', chromeMethod: 'runtime.reload' });

    guard.acknowledge(reply, false);
    expect(guard.isPending()).toBe(false);
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });
});
