import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Import the module under test
import './pid-lock.js'

describe('zlibrary-app pid-lock', () => {
  let tmpDir
  let originalHome

  beforeEach(() => {
    const testRoot = path.join(process.cwd(), '.test-tmp-pidlock')
    fs.mkdirSync(testRoot, { recursive: true })
    tmpDir = fs.mkdtempSync(path.join(testRoot, 'test-'))
    originalHome = process.env.HOME
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
    vi.restoreAllMocks()
  })

  describe('PidLock class', () => {
    it('creates lock file with current PID', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock = new PidLock(tmpDir)
      const acquired = await lock.acquire()
      expect(acquired).toBe(true)

      const lockPath = path.join(tmpDir, '.pidlock')
      expect(fs.existsSync(lockPath)).toBe(true)
      const content = fs.readFileSync(lockPath, 'utf-8').trim()
      expect(Number(content)).toBe(process.pid)
    })

    it('returns false when lock already held by alive process', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock1 = new PidLock(tmpDir)
      const lock2 = new PidLock(tmpDir)

      await lock1.acquire()
      const acquired = await lock2.acquire()
      expect(acquired).toBe(false)
    })

    it('releases lock correctly', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock = new PidLock(tmpDir)
      await lock.acquire()
      await lock.release()

      const lockPath = path.join(tmpDir, '.pidlock')
      expect(fs.existsSync(lockPath)).toBe(false)
    })

    it('detects stale PID (process not alive) and allows acquisition', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock1 = new PidLock(tmpDir)
      const lock2 = new PidLock(tmpDir)

      await lock1.acquire()

      // Manually write a stale PID (non-existent process)
      const lockPath = path.join(tmpDir, '.pidlock')
      fs.writeFileSync(lockPath, '999999', 'utf-8') // PID that doesn't exist

      const acquired = await lock2.acquire()
      expect(acquired).toBe(true)
    })

    it('isLocked() returns true when lock file exists', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock = new PidLock(tmpDir)

      expect(lock.isLocked()).toBe(false)
      await lock.acquire()
      expect(lock.isLocked()).toBe(true)
      await lock.release()
      expect(lock.isLocked()).toBe(false)
    })

    it('isStale() returns true for non-existent PID', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock = new PidLock(tmpDir)

      // Write a non-existent PID
      const lockPath = path.join(tmpDir, '.pidlock')
      fs.writeFileSync(lockPath, '999999', 'utf-8')

      expect(lock.isStale()).toBe(true)
    })

    it('isStale() returns false for current process PID', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock = new PidLock(tmpDir)

      await lock.acquire()
      expect(lock.isStale()).toBe(false)
    })

    it('handles missing lock directory gracefully', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const nonExistentDir = path.join(tmpDir, 'nonexistent')
      const lock = new PidLock(nonExistentDir)

      const acquired = await lock.acquire()
      expect(acquired).toBe(true)

      const lockPath = path.join(nonExistentDir, '.pidlock')
      expect(fs.existsSync(lockPath)).toBe(true)
    })

    it('handles corrupt lock file gracefully', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock = new PidLock(tmpDir)

      // Write invalid content
      const lockPath = path.join(tmpDir, '.pidlock')
      fs.writeFileSync(lockPath, 'not-a-number', 'utf-8')

      const acquired = await lock.acquire()
      expect(acquired).toBe(true) // Should treat as stale and acquire
    })

    it('release() is idempotent', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock = new PidLock(tmpDir)

      await lock.acquire()
      await lock.release()
      await lock.release() // Should not throw
      expect(lock.isLocked()).toBe(false)
    })

    it('acquire() returns false if already held by this instance', async () => {
      const { PidLock } = await import('./pid-lock.js')
      const lock = new PidLock(tmpDir)

      await lock.acquire()
      const acquired = await lock.acquire() // Second acquire on same instance
      expect(acquired).toBe(false) // Already held
    })
  })
})
