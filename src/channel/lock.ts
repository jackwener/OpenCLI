/**
 * Single-instance lock for the channel server.
 *
 * Lock file: ~/.opencli/channel.lock
 * Format: JSON { pid: number, startedAt: number }
 * Stale detection: check if PID is alive via process.kill(pid, 0)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const LOCK_PATH = path.join(os.homedir(), '.opencli', 'channel.lock')

interface LockData {
  pid: number
  startedAt: number
}

/** Attempt to acquire the lock. Returns true if acquired. */
export function acquireLock(): boolean {
  // Check for existing lock
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf-8')
    const data: LockData = JSON.parse(raw)
    // Check if process is still alive
    try {
      process.kill(data.pid, 0)
      return false // Process is alive, lock is held
    } catch {
      // Process is dead, stale lock — overwrite
    }
  } catch {
    // No lock file or invalid — proceed
  }

  // Write lock
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true })
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
  return true
}

/** Release the lock (only if we own it). */
export function releaseLock(): void {
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf-8')
    const data: LockData = JSON.parse(raw)
    if (data.pid === process.pid) {
      fs.unlinkSync(LOCK_PATH)
    }
  } catch {
    // Lock file already gone or unreadable — no-op
  }
}

/** Read lock info (for `channel status`). Returns null if no active lock. */
export function readLockInfo(): LockData | null {
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf-8')
    const data: LockData = JSON.parse(raw)
    try {
      process.kill(data.pid, 0)
      return data
    } catch {
      return null // Stale
    }
  } catch {
    return null
  }
}
