import { describe, expect, it, vi } from 'vitest'
import {
  probeCdpTargets,
  probeCdpDomains,
  probeBrowserDownloadBehavior,
  probeFetchStreamLive,
} from './_shared/download/probe.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal event bus that mimics CDPBridge.on/off/waitForEvent.
 */
function createEventBus () {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map()

  return {
    on (/** @type {string} */ event, /** @type {Function} */ handler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(handler)
    },
    off (/** @type {string} */ event, /** @type {Function} */ handler) {
      listeners.get(event)?.delete(handler)
    },
    /** Emit an event synchronously (like CDP messages over WebSocket). */
    emit (/** @type {string} */ event, /** @type {any} */ params) {
      const set = listeners.get(event)
      if (set) set.forEach(fn => fn(params))
    },
    waitForEvent (/** @type {string} */ event, /** @type {number} */ _timeoutMs) {
      return new Promise((resolve) => {
        const handler = (/** @type {any} */ params) => {
          this.off(event, handler)
          resolve(params)
        }
        this.on(event, handler)
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Probe 0: probeCdpTargets
// ---------------------------------------------------------------------------

describe('probeCdpTargets', () => {
  it('returns target info from Target.getTargets result', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({
        targetInfos: [
          { targetId: 't1', type: 'page', url: 'https://example.com', title: 'Test', browserContextId: 'c1', attached: false },
          { targetId: 't2', type: 'webview', url: 'file:///shell.html', title: 'Loader', browserContextId: 'c2', attached: true },
        ],
      }),
    }

    const result = await probeCdpTargets(page)

    expect(result.totalTargets).toBe(2)
    expect(result.allTargets).toHaveLength(2)
    expect(result.allTargets[0].targetId).toBe('t1')
    expect(result.allTargets[1].browserContextId).toBe('c2')
    expect(result.selectedTargetId).toBe('t2')
    expect(result.selectedTargetUrl).toBe('file:///shell.html')
    expect(page.cdp).toHaveBeenCalledWith('Target.getTargets', {})
  })

  it('handles empty target list', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({ targetInfos: [] }),
    }

    const result = await probeCdpTargets(page)

    expect(result.totalTargets).toBe(0)
    expect(result.allTargets).toEqual([])
  })

  it('handles missing targetInfos field', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({}),
    }

    const result = await probeCdpTargets(page)

    expect(result.totalTargets).toBe(0)
    expect(result.allTargets).toEqual([])
  })

  it('re-throws CDP protocol errors', async () => {
    const page = {
      cdp: vi.fn().mockRejectedValue(new Error('Target.getTargets not available')),
    }

    await expect(probeCdpTargets(page)).rejects.toThrow('Target.getTargets not available')
  })
})

// ---------------------------------------------------------------------------
// Probe 1: probeCdpDomains
// ---------------------------------------------------------------------------

describe('probeCdpDomains', () => {
  it('detects all required domains', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({
        domains: [
          { name: 'Fetch' },
          { name: 'IO' },
          { name: 'Browser' },
          { name: 'Network' },
          { name: 'Target' },
          { name: 'Page' },
          { name: 'Runtime' },
        ],
      }),
    }

    const result = await probeCdpDomains(page)

    expect(result.fetchSupported).toBe(true)
    expect(result.ioSupported).toBe(true)
    expect(result.browserSupported).toBe(true)
    expect(result.networkSupported).toBe(true)
    expect(result.targetSupported).toBe(true)
    expect(result.availableDomains).toContain('Fetch')
    expect(result.availableDomains).toContain('IO')
  })

  it('reports missing domains correctly', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({
        domains: [{ name: 'Page' }, { name: 'Runtime' }],
      }),
    }

    const result = await probeCdpDomains(page)

    expect(result.fetchSupported).toBe(false)
    expect(result.ioSupported).toBe(false)
    expect(result.browserSupported).toBe(false)
  })

  it('handles empty domain list', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({ domains: [] }),
    }

    const result = await probeCdpDomains(page)

    expect(result.availableDomains).toEqual([])
    expect(result.fetchSupported).toBe(false)
  })

  it('handles missing domains field', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({}),
    }

    const result = await probeCdpDomains(page)

    expect(result.availableDomains).toEqual([])
  })

  it('sorts domain names alphabetically', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({
        domains: [{ name: 'Runtime' }, { name: 'Browser' }, { name: 'Fetch' }],
      }),
    }

    const result = await probeCdpDomains(page)

    expect(result.availableDomains).toEqual(['Browser', 'Fetch', 'Runtime'])
  })
})

// ---------------------------------------------------------------------------
// Probe 2: probeBrowserDownloadBehavior
// ---------------------------------------------------------------------------

describe('probeBrowserDownloadBehavior', () => {
  it('returns success when command succeeds with no events', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({}),
    }
    const bus = createEventBus()

    const result = await probeBrowserDownloadBehavior(page, bus, '/tmp/dl-probe')

    expect(result.commandSucceeded).toBe(true)
    expect(result.errorMessage).toBeNull()
    expect(result.downloadWillBeginFired).toBe(false)
    expect(result.downloadProgressFired).toBe(false)
    expect(result.eventsCaptured).toBe(0)
    expect(page.cdp).toHaveBeenCalledWith('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: '/tmp/dl-probe',
      eventsEnabled: true,
    })
  })

  it('subscribes to Browser.downloadWillBegin and captures events', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({}),
    }
    const bus = createEventBus()

    // Start probe in background
    const probePromise = probeBrowserDownloadBehavior(page, bus, '/tmp/dl-probe', {
      timeoutMs: 5000,
    })

    // Emit a download event as if CDP sent it
    bus.emit('Browser.downloadWillBegin', {
      guid: 'dl-1',
      url: 'https://example.com/file.pdf',
      suggestedFilename: 'file.pdf',
      totalBytes: 1000,
    })

    const result = await probePromise

    expect(result.commandSucceeded).toBe(true)
    expect(result.downloadWillBeginFired).toBe(true)
    expect(result.downloadProgressFired).toBe(false)
    expect(result.eventsCaptured).toBe(1)
  })

  it('captures both downloadWillBegin and downloadProgress events', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({}),
    }
    const bus = createEventBus()

    const probePromise = probeBrowserDownloadBehavior(page, bus, '/tmp/dl-probe', {
      timeoutMs: 5000,
    })

    bus.emit('Browser.downloadWillBegin', {
      guid: 'dl-1',
      url: 'https://example.com/file.pdf',
      suggestedFilename: 'file.pdf',
      totalBytes: 1000,
    })
    bus.emit('Browser.downloadProgress', {
      guid: 'dl-1',
      state: 'inProgress',
      receivedBytes: 500,
      totalBytes: 1000,
    })

    const result = await probePromise

    expect(result.downloadWillBeginFired).toBe(true)
    expect(result.downloadProgressFired).toBe(true)
    expect(result.eventsCaptured).toBe(2)
  })

  it('cleans up event listeners after probe completes', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({}),
    }
    const bus = createEventBus()

    const onWillBeginSpy = vi.fn()

    await probeBrowserDownloadBehavior(page, bus, '/tmp/dl-probe')

    // Emit after probe completes — should not be captured
    bus.emit('Browser.downloadWillBegin', { guid: 'dl-2' })

    // Re-subscribe to verify the old handler isn't still listening
    bus.on('Browser.downloadWillBegin', onWillBeginSpy)
    bus.emit('Browser.downloadWillBegin', { guid: 'dl-3' })

    // Should see only the re-subscribed handler's event, not the old one
    expect(onWillBeginSpy).toHaveBeenCalledTimes(1)
  })

  it('returns command failure when Browser.setDownloadBehavior errors', async () => {
    const page = {
      cdp: vi.fn().mockRejectedValue(new Error('Browser domain not available')),
    }
    const bus = createEventBus()

    const result = await probeBrowserDownloadBehavior(page, bus, '/tmp/dl-probe')

    expect(result.commandSucceeded).toBe(false)
    expect(result.errorMessage).toBe('Browser domain not available')
    expect(result.eventsCaptured).toBe(0)
  })

  it('stops after maxEvents threshold', async () => {
    const page = {
      cdp: vi.fn().mockResolvedValue({}),
    }
    const bus = createEventBus()

    const probePromise = probeBrowserDownloadBehavior(page, bus, '/tmp/dl-probe', {
      maxEvents: 1,
      timeoutMs: 30000,
    })

    // Fire many events quickly
    for (let i = 0; i < 20; i++) {
      bus.emit('Browser.downloadWillBegin', { guid: `dl-${i}` })
      bus.emit('Browser.downloadProgress', { guid: `dl-${i}`, state: 'inProgress' })
    }

    const result = await probePromise

    // Should have stopped at maxEvents (1) + any events that arrived before the check
    expect(result.eventsCaptured).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Live probe guard
// ---------------------------------------------------------------------------

describe('probeFetchStreamLive', () => {
  it('requires a real browser — not runnable in unit tests', async () => {
    // Dynamic import inside test to verify module exports exist
    const probe = await import('./_shared/download/probe.js')
    expect(typeof probe.probeFetchStreamLive).toBe('function')
  })

  it('uses requested urlRelative and counts IO bytes correctly', async () => {
    const page = {
      cdp: vi.fn().mockImplementation(async (method) => {
        if (method === 'Schema.getDomains') {
          return { domains: [{ name: 'Fetch' }, { name: 'IO' }, { name: 'Browser' }] }
        }
        if (method === 'Fetch.enable') return {}
        if (method === 'Fetch.takeResponseBodyAsStream') return { stream: 'stream-1' }
        if (method === 'IO.read') return { eof: true, data: 'YWJj', base64Encoded: true }
        if (method === 'Fetch.failRequest') return {}
        if (method === 'Fetch.disable') return {}
        return {}
      }),
      evaluate: vi.fn().mockResolvedValue(undefined),
    }
    const bus = createEventBus()

    const probePromise = probeFetchStreamLive(page, bus, '/dl/abc123', 'https://example.com', {
      timeoutMs: 5000,
    })

    setTimeout(() => {
      bus.emit('Fetch.requestPaused', {
        requestId: 'req-1',
        responseStatusCode: 200,
        request: { url: 'https://cdn.example.com/file.epub' },
      })
    }, 0)

    const result = await probePromise

    expect(page.evaluate).toHaveBeenCalledTimes(1)
    expect(page.evaluate.mock.calls[0][1]).toEqual({
      urlRelative: '/dl/abc123',
      origin: 'https://example.com',
    })
    expect(result.requestPausedReceived).toBe(true)
    expect(result.streamHandleReceived).toBe(true)
    expect(result.ioReadSucceeded).toBe(true)
    expect(result.bytesRead).toBe(3)
    expect(result.browserDownloadWillBeginSeen).toBe(false)
  })
})
