/**
 * PID Lock for Z-Library Desktop App.
 *
 * Ensures only one CLI process operates on the zlibrary-app session at a time.
 * Uses a PID file at ~/.opencli/sites/zlibrary-app/.pidlock with stale PID detection.
 *
 * Lock scope: all commands that need browser/session interaction:
 *   - booklist-download
 *   - booklist-add
 *   - download
 *   - quota-status
 *   - profile
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { CommandExecutionError, SessionBusyError } from '@jackwener/opencli/errors'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCK_FILENAME = '.pidlock'
const OPENCLI_DIR = path.join(os.homedir(), '.opencli')
const SITE_DIR = path.join(OPENCLI_DIR, 'sites', 'zlibrary-app')

// ---------------------------------------------------------------------------
// PidLock Class
// ---------------------------------------------------------------------------

/**
 * PID Lock implementation with stale process detection.
 */
export class PidLock {
  /**
   * @param {string} [siteDir] - Custom site directory (defaults to ~/.opencli/sites/zlibrary-app)
   */
  constructor(siteDir = SITE_DIR) {
    this.siteDir = siteDir
    this.lockPath = path.join(siteDir, LOCK_FILENAME)
    this.held = false
  }

  /**
   * Acquire the lock.
   * Returns true if acquired, false if held by another alive process.
   * Automatically cleans up stale locks (dead PIDs).
   *
   * @returns {Promise<boolean>}
   */
  async acquire() {
    // Already held by this instance
    if (this.held) {
      return false
    }

    // Ensure directory exists
    await this.ensureDir()

    // Try to acquire lock atomically with exclusive create
    // 'wx' ensures only one process creates the file (race-free)
    let acquired = this.tryAcquireExclusive()
    if (!acquired) {
      // Lock file exists  -  check if stale
      const existingPid = this.readPid()
      if (existingPid !== null && this.isProcessAlive(existingPid)) {
        return false // Held by alive process
      }
      // Stale lock  -  remove and retry once
      try { fs.unlinkSync(this.lockPath) } catch (_) { /* best-effort cleanup */ }
      acquired = this.tryAcquireExclusive()
    }

    return acquired
  }

  /**
   * Try to acquire lock exclusively using O_CREAT | O_EXCL ('wx').
   *
   * @returns {boolean} true if lock acquired
   */
  tryAcquireExclusive() {
    try {
      fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' })
      this.held = true
      return true
    } catch (err) {
      if (err.code === 'EEXIST') return false
      throw new CommandExecutionError(`Failed to acquire PID lock: ${err.message}`)
    }
  }

  /**
   * Release the lock.
   * Only releases if held by this instance.
   *
   * @returns {Promise<void>}
   */
  async release() {
    if (!this.held) {
      return
    }

    // Verify we still own the lock before releasing
    const currentPid = this.readPid()
    if (currentPid === process.pid) {
      try {
        fs.unlinkSync(this.lockPath)
      } catch (_) {
        // Ignore - lock may have been stolen/cleaned up
      }
    }
    this.held = false
  }

  /**
   * Check if lock file exists (regardless of PID validity).
   *
   * @returns {boolean}
   */
  isLocked() {
    return fs.existsSync(this.lockPath)
  }

  /**
   * Check if the current lock is stale (process not alive).
   *
   * @returns {boolean}
   */
  isStale() {
    const pid = this.readPid()
    if (pid === null) {
      return false // No lock file or unreadable
    }
    return !this.isProcessAlive(pid)
  }

  /**
   * Read PID from lock file.
   *
   * @returns {number|null} PID or null if invalid/missing
   */
  readPid() {
    try {
      const content = fs.readFileSync(this.lockPath, 'utf-8').trim()
      const pid = Number(content)
      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch (_) {
      return null
    }
  }

  /**
   * Check if a process is alive using kill(0) signal.
   *
   * @param {number} pid
   * @returns {boolean}
   */
  isProcessAlive(pid) {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      // ESRCH = no such process
      // EPERM = process exists but we can't signal it (still alive)
      return error.code === 'EPERM'
    }
  }

  /**
   * Ensure the site directory exists.
   *
   * @returns {Promise<void>}
   */
  async ensureDir() {
    try {
      fs.mkdirSync(this.siteDir, { recursive: true })
    } catch (_) {
      // Directory may already exist
    }
  }
}

/**
 * Default lock instance for zlibrary-app.
 */
export const defaultPidLock = new PidLock()

/**
 * Acquire the default lock with a descriptive error on failure.
 *
 * @param {string} commandName - Name of the command for error messages
 * @returns {Promise<PidLock>} The lock instance (held)
 * @throws {Error} If lock cannot be acquired
 */
export async function acquireLockOrThrow(commandName) {
  // In test mode, return a held in-memory lock without filesystem access
  // to avoid conflicts between parallel vitest workers.
  if (process.env.VITEST) {
    const lock = new PidLock()
    lock.held = true
    return lock
  }

  const lock = new PidLock()
  const acquired = await lock.acquire()
  if (!acquired) {
    const existingPid = lock.readPid()
    throw new SessionBusyError(
      `Another ${commandName} process is already running (PID: ${existingPid || 'unknown'}). ` +
      `Wait for it to complete or run 'zlibrary-app quota-status' to check status.`
    )
  }
  return lock
}
