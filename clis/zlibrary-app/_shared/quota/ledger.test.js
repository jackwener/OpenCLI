import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('zlibrary-app quota-ledger', () => {
  let tmpDir

  beforeEach(() => {
    const testRoot = path.join(process.cwd(), '.test-tmp-ledger')
    fs.mkdirSync(testRoot, { recursive: true })
    tmpDir = fs.mkdtempSync(path.join(testRoot, 'test-'))
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  })

  describe('QuotaLedger class', () => {
    it('load() returns null when no file exists', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      expect(ledger.load()).toBeNull()
    })

    it('bootstrap() creates ledger with correct schema', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)

      const result = ledger.bootstrap(10, '2026-06-07T08:05:00.000Z')

      expect(result.version).toBe(1)
      expect(result.dailyLimit).toBe(10)
      expect(result.downloadedToday).toBe(0)
      expect(result.resetAt).toBe('2026-06-07T08:05:00.000Z')
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(result.updatedAt).toBeDefined()
    })

    it('bootstrap() without resetAt stores null', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)

      ledger.bootstrap(10)
      expect(ledger.ledger.resetAt).toBeNull()
    })

    it('save() writes ledger atomically with correct permissions', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)

      ledger.bootstrap(10, '2026-06-07T08:05:00.000Z')
      ledger.consume(3)
      ledger.save()

      const ledgerPath = path.join(tmpDir, 'quota-ledger.json')
      expect(fs.existsSync(ledgerPath)).toBe(true)

      // Temp file should be cleaned up
      expect(fs.existsSync(path.join(tmpDir, 'quota-ledger.json.tmp'))).toBe(false)

      // Verify content
      const content = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'))
      expect(content.version).toBe(1)
      expect(content.dailyLimit).toBe(10)
      expect(content.downloadedToday).toBe(3)

      // Verify permissions (0o600)
      const stat = fs.statSync(ledgerPath)
      const mode = stat.mode & 0o777
      expect(mode).toBe(0o600)
    })

    it('save() creates site directory if missing', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const deepDir = path.join(tmpDir, 'deep', 'nested', 'sites')
      const ledger = new QuotaLedger(deepDir)

      ledger.bootstrap(5)
      ledger.save()

      const ledgerPath = path.join(deepDir, 'quota-ledger.json')
      expect(fs.existsSync(ledgerPath)).toBe(true)
    })

    it('save() does not throw when ledger is null', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      expect(() => ledger.save()).not.toThrow()
    })

    it('load() reads previously saved ledger', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger1 = new QuotaLedger(tmpDir)
      ledger1.bootstrap(10, '2026-06-07T08:05:00.000Z')
      ledger1.ledger.downloadedToday = 4
      ledger1.save()

      const ledger2 = new QuotaLedger(tmpDir)
      const loaded = ledger2.load()
      expect(loaded).not.toBeNull()
      expect(loaded.dailyLimit).toBe(10)
      expect(loaded.downloadedToday).toBe(4)
      expect(loaded.resetAt).toBe('2026-06-07T08:05:00.000Z')
      expect(loaded.version).toBe(1)
    })

    it('load() returns null for corrupt JSON', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledgerPath = path.join(tmpDir, 'quota-ledger.json')
      fs.writeFileSync(ledgerPath, '{invalid json}', 'utf-8')

      const ledger = new QuotaLedger(tmpDir)
      expect(ledger.load()).toBeNull()
    })

    it('load() returns null for missing version field', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledgerPath = path.join(tmpDir, 'quota-ledger.json')
      fs.writeFileSync(ledgerPath, JSON.stringify({ dailyLimit: 10 }), 'utf-8')

      const ledger = new QuotaLedger(tmpDir)
      expect(ledger.load()).toBeNull()
    })

    it('load() returns null for wrong version', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledgerPath = path.join(tmpDir, 'quota-ledger.json')
      fs.writeFileSync(ledgerPath, JSON.stringify({ version: 2, dailyLimit: 10 }), 'utf-8')

      const ledger = new QuotaLedger(tmpDir)
      expect(ledger.load()).toBeNull()
    })

    it('load() returns null for missing dailyLimit', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledgerPath = path.join(tmpDir, 'quota-ledger.json')
      fs.writeFileSync(ledgerPath, JSON.stringify({ version: 1 }), 'utf-8')

      const ledger = new QuotaLedger(tmpDir)
      expect(ledger.load()).toBeNull()
    })

    it('consume() increments downloadedToday', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(10)

      ledger.consume(1)
      expect(ledger.ledger.downloadedToday).toBe(1)

      ledger.consume(3)
      expect(ledger.ledger.downloadedToday).toBe(4)
    })

    it('consume() with no argument defaults to 1', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(10)

      ledger.consume()
      expect(ledger.ledger.downloadedToday).toBe(1)
    })

    it('consume() does not throw on null ledger', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      expect(() => ledger.consume(1)).not.toThrow()
    })

    it('getRemaining() returns dailyLimit - Max(domUsed, downloadedToday)', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(10)

      // No DOM used, no downloadedToday
      expect(ledger.getRemaining()).toBe(10)

      // Downloaded 3 from ledger
      ledger.consume(3)
      expect(ledger.getRemaining()).toBe(7)

      // DOM says 5 (higher), should use 5
      ledger.setDomUsed(5)
      expect(ledger.getRemaining()).toBe(5) // max(5, 3) = 5

      // DOM says 2 (lower), should use 3 (from ledger)
      ledger.setDomUsed(2)
      expect(ledger.getRemaining()).toBe(7) // max(2, 3) = 3
    })

    it('getRemaining() returns null when no ledger', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      expect(ledger.getRemaining()).toBeNull()
    })

    it('getRemaining() floor at 0', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(3)
      ledger.consume(5) // Over-consume
      expect(ledger.getRemaining()).toBe(0)
    })

    it('ensureResetRollover() resets when resetAt has passed', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      const pastDate = new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      ledger.bootstrap(10, pastDate)
      ledger.consume(4)

      const didRollover = ledger.ensureResetRollover()
      expect(didRollover).toBe(true)
      expect(ledger.ledger.downloadedToday).toBe(0)
      expect(ledger.ledger.resetAt).toBeNull()
      expect(ledger.ledger.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('ensureResetRollover() does not reset when resetAt is in future', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      const futureDate = new Date(Date.now() + 86400000).toISOString() // 1 day from now
      ledger.bootstrap(10, futureDate)
      ledger.consume(4)

      const didRollover = ledger.ensureResetRollover()
      expect(didRollover).toBe(false)
      expect(ledger.ledger.downloadedToday).toBe(4)
    })

    it('ensureResetRollover() does not throw when resetAt is null', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(10)

      expect(() => ledger.ensureResetRollover()).not.toThrow()
      expect(ledger.ensureResetRollover()).toBe(false)
    })

    it('ensureResetRollover() does not throw when ledger is null', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      expect(() => ledger.ensureResetRollover()).not.toThrow()
      expect(ledger.ensureResetRollover()).toBe(false)
    })

    it('ensureResetRollover() persists reset via save()', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      const pastDate = new Date(Date.now() - 3600000).toISOString()
      ledger.bootstrap(10, pastDate)
      ledger.consume(4)

      ledger.ensureResetRollover()

      // Verify on-disk state
      const ledgerPath = path.join(tmpDir, 'quota-ledger.json')
      const content = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'))
      expect(content.downloadedToday).toBe(0)
      expect(content.resetAt).toBeNull()
    })

    it('getStats() returns available=false when no ledger', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      const stats = ledger.getStats()
      expect(stats.available).toBe(false)
      expect(stats.dailyLimit).toBeNull()
    })

    it('getStats() returns correct values when ledger exists', async () => {
      const { QuotaLedger } = await import('./ledger.js')
      const ledger = new QuotaLedger(tmpDir)
      ledger.bootstrap(10, '2026-06-07T08:05:00.000Z')
      ledger.consume(3)
      ledger.setDomUsed(2)

      const stats = ledger.getStats()
      expect(stats.available).toBe(true)
      expect(stats.dailyLimit).toBe(10)
      expect(stats.downloadedToday).toBe(3)
      expect(stats.remaining).toBe(7) // max(2, 3) = 3, 10 - 3 = 7
      expect(stats.resetAt).toBe('2026-06-07T08:05:00.000Z')
    })
  })

  describe('createOrLoadLedger', () => {
    it('creates new ledger from DOM data when no existing file', async () => {
      const { createOrLoadLedger } = await import('./ledger.js')
      const ledger = createOrLoadLedger(
        { dailyLimit: 10, dailyUsed: 3, resetAt: '2026-06-07T08:05:00.000Z' },
        tmpDir
      )

      expect(ledger.ledger).not.toBeNull()
      expect(ledger.ledger.dailyLimit).toBe(10)
      expect(ledger.ledger.downloadedToday).toBe(0)
      expect(ledger.domUsed).toBe(3)

      // Verify persisted
      const ledgerPath = path.join(tmpDir, 'quota-ledger.json')
      expect(fs.existsSync(ledgerPath)).toBe(true)
    })

    it('loads existing ledger ignoring DOM data', async () => {
      const { createOrLoadLedger, QuotaLedger } = await import('./ledger.js')

      // First, save a ledger
      const ledger1 = new QuotaLedger(tmpDir)
      ledger1.bootstrap(10)
      ledger1.ledger.downloadedToday = 4
      ledger1.save()

      // Now createOrLoad with different DOM data
      const ledger2 = createOrLoadLedger(
        { dailyLimit: 20, dailyUsed: 0 },
        tmpDir
      )

      // Should have loaded existing, not re-bootstrapped
      expect(ledger2.ledger.downloadedToday).toBe(4)
      expect(ledger2.ledger.dailyLimit).toBe(10)
      // DOM used should still be set
      expect(ledger2.domUsed).toBe(0)
    })

    it('returns empty ledger when no DOM data and no existing file', async () => {
      const { createOrLoadLedger } = await import('./ledger.js')
      const ledger = createOrLoadLedger(null, tmpDir)
      expect(ledger.ledger).toBeNull()
    })
  })
})
