import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createPageMock } from '../../../test-utils.js'
import quotaFixture from '../../fixture/quota-default.json'

// Import the module under test
import './checker.js'

describe('zlibrary-app quota-checker', () => {
  let tmpDir

  beforeEach(() => {
    const testRoot = path.join(process.cwd(), '.test-tmp-quota')
    fs.mkdirSync(testRoot, { recursive: true })
    tmpDir = fs.mkdtempSync(path.join(testRoot, 'test-'))
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  })

  describe('extractQuotaFromDom', () => {
    it('extractQuotaSnapshotFromDom returns fixture-shaped quota payload', async () => {
      const { extractQuotaSnapshotFromDom } = await import('./checker.js')
      const fixtureData = quotaFixture.results.quota.data

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        fixtureData
      ])

      const result = await extractQuotaSnapshotFromDom(page)

      expect(result).toEqual(fixtureData)
    })

    it('extracts quota from DOM with d-count and d-reset', async () => {
      const { extractQuotaFromDom } = await import('./checker.js')

      const page =       createPageMock([
        // First call: window.location.origin
        'https://z-lib.fm',
        // Second call: window.location.href after navigation to /users/downloads
        'https://z-lib.fm/users/downloads',
        // DOM extraction result  -  now uses filenameFormatText from evaluate,
        // with hasMd5InFilenameFormat computed in Node space
        {
          countText: '3 / 10',
          resetText: 'Downloads will be reset in 14h 5m',
          progressExists: true,
          progressAriaNow: 30,
          filenameFormatText: ''
        }
      ])

      const result = await extractQuotaFromDom(page)

      expect(result).toEqual({
        dailyUsed: 3,
        dailyLimit: 10,
        dailyRemaining: 7,
        resetText: 'Downloads will be reset in 14h 5m',
        progressAriaNow: 30,
        filenameFormatText: '',
        hasMd5InFilenameFormat: false
      })
    })

    it('handles missing d-count element gracefully', async () => {
      const { extractQuotaFromDom } = await import('./checker.js')

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '',
          resetText: '',
          progressExists: false,
          progressAriaNow: null
        }
      ])

      const result = await extractQuotaFromDom(page)

      expect(result.dailyUsed).toBeNull()
      expect(result.dailyLimit).toBeNull()
      expect(result.dailyRemaining).toBeNull()
    })

    it('handles missing d-reset element gracefully', async () => {
      const { extractQuotaFromDom } = await import('./checker.js')

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '5 / 10',
          resetText: '',
          progressExists: true,
          progressAriaNow: 50
        }
      ])

      const result = await extractQuotaFromDom(page)

      expect(result.dailyUsed).toBe(5)
      expect(result.dailyLimit).toBe(10)
      expect(result.dailyRemaining).toBe(5)
      expect(result.resetText).toBe('')
    })

    it('parses various d-count formats', async () => {
      const { extractQuotaFromDom } = await import('./checker.js')

      const testCases = [
        { countText: '0/10', expected: { used: 0, limit: 10, remaining: 10 } },
        { countText: '5/10', expected: { used: 5, limit: 10, remaining: 5 } },
        { countText: '10/10', expected: { used: 10, limit: 10, remaining: 0 } },
        { countText: '  3 / 10  ', expected: { used: 3, limit: 10, remaining: 7 } },
      ]

      for (const tc of testCases) {
        const page = createPageMock([
          'https://z-lib.fm',
          'https://z-lib.fm/users/downloads',
          {
            countText: tc.countText,
            resetText: 'Downloads will be reset in 14h 5m',
            progressExists: true,
            progressAriaNow: Math.round(tc.expected.used / tc.expected.limit * 100)
          }
        ])

        const result = await extractQuotaFromDom(page)
        expect(result.dailyUsed).toBe(tc.expected.used)
        expect(result.dailyLimit).toBe(tc.expected.limit)
        expect(result.dailyRemaining).toBe(tc.expected.remaining)
      }
    })

    it('navigates to /users/downloads before extraction', async () => {
      const { extractQuotaFromDom } = await import('./checker.js')

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '3 / 10',
          resetText: 'Downloads will be reset in 14h 5m',
          progressExists: true,
          progressAriaNow: 30,
          filenameFormatText: '%t (%a)_MD5_%m_'
        }
      ])

      await extractQuotaFromDom(page)

      // First call: window.location.origin
      // Second call: window.location.href (assertSameOriginNotLoginWall)
      // Third call: DOM extraction
      expect(page.goto).toHaveBeenCalledWith('https://z-lib.fm/users/downloads', { waitUntil: 'load', settleMs: 3000 })
    })

    it('extracts hasMd5InFilenameFormat when MD5 tag present in template', async () => {
      const { extractQuotaFromDom } = await import('./checker.js')

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '3 / 10',
          resetText: 'Downloads will be reset in 14h 5m',
          progressExists: true,
          progressAriaNow: 30,
          filenameFormatText: '%t (%a)_MD5_%m_'
        }
      ])

      const result = await extractQuotaFromDom(page)

      expect(result.hasMd5InFilenameFormat).toBe(true)
    })

    it('extracts hasMd5InFilenameFormat as false when MD5 tag absent', async () => {
      const { extractQuotaFromDom } = await import('./checker.js')

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '3 / 10',
          resetText: 'Downloads will be reset in 14h 5m',
          progressExists: true,
          progressAriaNow: 30,
          filenameFormatText: '%t (%a)'
        }
      ])

      const result = await extractQuotaFromDom(page)

      expect(result.hasMd5InFilenameFormat).toBe(false)
    })

    it('handles missing filename format element gracefully', async () => {
      const { extractQuotaFromDom } = await import('./checker.js')

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '3 / 10',
          resetText: 'Downloads will be reset in 14h 5m',
          progressExists: true,
          progressAriaNow: 30,
          filenameFormatText: ''
        }
      ])

      const result = await extractQuotaFromDom(page)

      expect(result.hasMd5InFilenameFormat).toBe(false)
    })
  })

  describe('parseResetTextToAbsolute', () => {
    it('parses "Xh Ym" format', async () => {
      const { parseResetTextToAbsolute } = await import('./checker.js')

      const result = parseResetTextToAbsolute('Downloads will be reset in 14h 5m')
      expect(result).not.toBeNull()
      // Should be ~14h5m in the future
      const future = new Date(result).getTime()
      const now = Date.now()
      expect(future - now).toBeGreaterThan(14 * 3600000 - 60000) // ~14h - 1min tolerance
      expect(future - now).toBeLessThan(14 * 3600000 + 5 * 60000 + 60000) // ~14h5m + 1min tolerance
    })

    it('parses "X hours Y minutes" format', async () => {
      const { parseResetTextToAbsolute } = await import('./checker.js')

      const result = parseResetTextToAbsolute('Reset in 2 hours 30 minutes')
      expect(result).not.toBeNull()
      const future = new Date(result).getTime()
      const now = Date.now()
      expect(future - now).toBeGreaterThan(2 * 3600000 - 60000)
      expect(future - now).toBeLessThan(2 * 3600000 + 30 * 60000 + 60000)
    })

    it('parses "Xh" only format', async () => {
      const { parseResetTextToAbsolute } = await import('./checker.js')

      const result = parseResetTextToAbsolute('Reset in 5h')
      expect(result).not.toBeNull()
      const future = new Date(result).getTime()
      const now = Date.now()
      expect(future - now).toBeGreaterThan(5 * 3600000 - 60000)
      expect(future - now).toBeLessThan(5 * 3600000 + 60000)
    })

    it('returns null for empty string', async () => {
      const { parseResetTextToAbsolute } = await import('./checker.js')
      expect(parseResetTextToAbsolute('')).toBeNull()
    })

    it('returns null for unparseable text', async () => {
      const { parseResetTextToAbsolute } = await import('./checker.js')
      expect(parseResetTextToAbsolute('No reset info available')).toBeNull()
    })

    it('returns null for null/undefined', async () => {
      const { parseResetTextToAbsolute } = await import('./checker.js')
      expect(parseResetTextToAbsolute(null)).toBeNull()
      expect(parseResetTextToAbsolute(undefined)).toBeNull()
    })
  })

  describe('createQuotaTracker', () => {
    it('creates tracker with initial state', async () => {
      const { createQuotaTracker } = await import('./checker.js')

      const tracker = createQuotaTracker()

      expect(tracker.remaining).toBeNull()
      expect(tracker.lastSync).toBeNull()
      expect(tracker.quotaExpired).toBe(false)
      expect(tracker.consumeCount).toBe(0)
    })

    it('sync() fetches quota from DOM and initializes counter', async () => {
      const { createQuotaTracker } = await import('./checker.js')

      const tracker = createQuotaTracker()
      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '3 / 10',
          resetText: 'Downloads will be reset in 14h 5m',
          progressExists: true,
          progressAriaNow: 30
        }
      ])

      await tracker.sync(page)

      expect(tracker.remaining).toBe(7)
      expect(tracker.dailyLimit).toBe(10)
      expect(tracker.dailyUsed).toBe(3)
      expect(tracker.resetText).toBe('Downloads will be reset in 14h 5m')
      expect(tracker.lastSync).not.toBeNull()
      expect(tracker.consumeCount).toBe(0)
    })

    it('consume() decrements remaining counter', async () => {
      const { createQuotaTracker } = await import('./checker.js')

      const tracker = createQuotaTracker()
      tracker.remaining = 7
      tracker.dailyLimit = 10
      tracker.dailyUsed = 3

      tracker.consume(1)
      expect(tracker.remaining).toBe(6)
      expect(tracker.consumeCount).toBe(1)

      tracker.consume(2)
      expect(tracker.remaining).toBe(4)
      expect(tracker.consumeCount).toBe(3)
    })

    it('isExhausted() returns true when remaining <= 0', async () => {
      const { createQuotaTracker } = await import('./checker.js')

      const tracker = createQuotaTracker()
      tracker.remaining = 0
      expect(tracker.isExhausted()).toBe(true)

      tracker.remaining = -1
      expect(tracker.isExhausted()).toBe(true)

      tracker.remaining = 1
      expect(tracker.isExhausted()).toBe(false)

      tracker.remaining = null
      expect(tracker.isExhausted()).toBe(false) // Unknown quota - don't block
    })

    it('ensure() syncs on first call', async () => {
      const { createQuotaTracker } = await import('./checker.js')

      const tracker = createQuotaTracker()
      const page = createPageMock([])

      // Mock sync to update tracker state
      tracker.sync = vi.fn().mockImplementation(async () => {
        tracker.lastSync = Date.now()
        tracker.remaining = 7
        tracker.dailyLimit = 10
        tracker.dailyUsed = 3
        tracker.consumeCount = 0
        tracker.resetText = 'Downloads will be reset in 14h 5m'
      })
      tracker.remaining = 7

      await tracker.ensure(page)

      expect(tracker.sync).toHaveBeenCalledWith(page)
    })

    it('ensure() resyncs after every 5 consumes', async () => {
      const { createQuotaTracker } = await import('./checker.js')

      const tracker = createQuotaTracker()
      const page = createPageMock([])

      tracker.remaining = 10
      let syncCount = 0
      tracker.sync = vi.fn().mockImplementation(async () => {
        syncCount++
        tracker.lastSync = Date.now()
        tracker.remaining = 10 - (syncCount < 2 ? 0 : 2) // After 2nd sync, remaining = 8
        tracker.dailyLimit = 10
        tracker.dailyUsed = syncCount < 2 ? 0 : 2
        tracker.consumeCount = 0
        tracker.resetText = ''
      })

      // First ensure - syncs
      await tracker.ensure(page)
      expect(tracker.sync).toHaveBeenCalledTimes(1)

      // Consume 4 times - no resync
      for (let i = 0; i < 4; i++) {
        tracker.consume(1)
        await tracker.ensure(page)
      }
      expect(tracker.sync).toHaveBeenCalledTimes(1)

      // 5th consume - should trigger resync
      tracker.consume(1)
      await tracker.ensure(page)
      expect(tracker.sync).toHaveBeenCalledTimes(2)
    })

    it('ensure() does not resync if quota already exhausted', async () => {
      const { createQuotaTracker } = await import('./checker.js')

      const tracker = createQuotaTracker()
      const page = createPageMock([])

      tracker.sync = vi.fn().mockResolvedValue(undefined)
      tracker.remaining = 0
      tracker.quotaExpired = true

      await tracker.ensure(page)
      expect(tracker.sync).not.toHaveBeenCalled()
    })

    it('handles sync errors gracefully', async () => {
      const { createQuotaTracker } = await import('./checker.js')

      const tracker = createQuotaTracker()
      const page = createPageMock(['https://z-lib.fm'])

      tracker.sync = vi.fn().mockRejectedValue(new Error('Navigation failed'))

      await expect(tracker.ensure(page)).rejects.toThrow('Navigation failed')
    })
  })

  describe('createQuotaLedgerTracker', () => {
    let tmpDir

    beforeEach(() => {
      const testRoot = path.join(process.cwd(), '.test-tmp-quota')
      fs.mkdirSync(testRoot, { recursive: true })
      tmpDir = fs.mkdtempSync(path.join(testRoot, 'ledger-'))
    })

    afterEach(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
    })

    it('bootstraps ledger from DOM on first sync', async () => {
      const { createQuotaLedgerTracker } = await import('./checker.js')
      const { QuotaLedger } = await import('./ledger.js')

      const ledger = new QuotaLedger(tmpDir)
      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '3 / 10',
          resetText: 'Downloads will be reset in 14h 5m',
          progressExists: true,
          progressAriaNow: 30
        }
      ])

      const tracker = await createQuotaLedgerTracker(page, ledger)
      expect(tracker.remaining).toBeNull() // No sync yet

      await tracker.sync(page)

      expect(tracker.remaining).toBe(7) // max(3, 0) → 3, 10-3=7
      expect(tracker.dailyLimit).toBe(10)
      expect(tracker.dailyUsed).toBe(3)
      expect(ledger.ledger).not.toBeNull()
      expect(ledger.ledger.dailyLimit).toBe(10)
      expect(ledger.ledger.downloadedToday).toBe(0) // No consume yet
    })

    it('sync() updates domUsed on the ledger', async () => {
      const { createQuotaLedgerTracker } = await import('./checker.js')
      const { QuotaLedger } = await import('./ledger.js')

      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(10, null)
      ledger.consume(2) // ledger says 2
      ledger.save()

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '5 / 10',
          resetText: 'Downloads will be reset in 14h 5m',
          progressExists: true,
          progressAriaNow: 50
        }
      ])

      const tracker = await createQuotaLedgerTracker(page, ledger)
      await tracker.sync(page)

      // MAX(domUsed=5, ledger.downloadedToday=2) = 5 → remaining = 5
      expect(tracker.remaining).toBe(5)
      expect(ledger.domUsed).toBe(5)
    })

    it('consume() persists to ledger', async () => {
      const { createQuotaLedgerTracker } = await import('./checker.js')
      const { QuotaLedger } = await import('./ledger.js')

      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(10, null)
      ledger.save()

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '0 / 10',
          resetText: 'Downloads will be reset in 14h 5m',
          progressExists: true,
          progressAriaNow: 0
        }
      ])

      const tracker = await createQuotaLedgerTracker(page, ledger)
      await tracker.sync(page)
      expect(tracker.remaining).toBe(10)

      tracker.consume(1)
      expect(tracker.remaining).toBe(9)
      expect(ledger.ledger.downloadedToday).toBe(1)

      // Verify persisted to disk
      const ledgerPath = path.join(tmpDir, 'quota-ledger.json')
      const content = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'))
      expect(content.downloadedToday).toBe(1)
    })

    it('isExhausted() returns correct state', async () => {
      const { createQuotaLedgerTracker } = await import('./checker.js')
      const { QuotaLedger } = await import('./ledger.js')

      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(2, null)
      ledger.save()

      const page = createPageMock([
        'https://z-lib.fm',
        'https://z-lib.fm/users/downloads',
        {
          countText: '0 / 2',
          resetText: '',
          progressExists: true,
          progressAriaNow: 0
        }
      ])

      const tracker = await createQuotaLedgerTracker(page, ledger)
      await tracker.sync(page)

      expect(tracker.isExhausted()).toBe(false)
      tracker.consume(1)
      expect(tracker.isExhausted()).toBe(false)
      tracker.consume(1)
      expect(tracker.isExhausted()).toBe(true)
    })

    it('ensure() checks resetAt rollover without DOM navigation', async () => {
      const { createQuotaLedgerTracker } = await import('./checker.js')
      const { QuotaLedger } = await import('./ledger.js')

      const pastDate = new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(10, pastDate)
      ledger.consume(4)
      ledger.save()

      // Page mock provides DOM data for sync (first ensure always syncs)
      const page = createPageMock([
        'https://z-lib.org',
        'https://z-lib.org/profile',
        { countText: '0 / 10', resetText: '', progressExists: true, progressAriaNow: 0 },
      ])
      const tracker = await createQuotaLedgerTracker(page, ledger)

      // Run ensure  -  should detect rollover and reset
      await tracker.ensure(page)
      expect(tracker.remaining).toBe(10) // Reset to full
      expect(ledger.ledger.downloadedToday).toBe(0)
    })

    it('ensure() skips sync when quota already expired', async () => {
      const { createQuotaLedgerTracker } = await import('./checker.js')
      const { QuotaLedger } = await import('./ledger.js')

      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(1, null)
      ledger.consume(1)
      ledger.save()

      const page = createPageMock([])

      const tracker = await createQuotaLedgerTracker(page, ledger)
      tracker.quotaExpired = true
      tracker.remaining = 0

      await tracker.ensure(page)
      expect(tracker.remaining).toBe(0)
    })
  })
})
