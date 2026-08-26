/**
 * Shared fixture primitives for write-action fixture recorders.
 *
 * Pure functions: no state, no class, no inheritance.
 * Each recorder imports only what it needs.
 *
 * @module output
 */
import fs from 'node:fs'
import path from 'node:path'
import { sanitiseBookId } from '../infra/manifest-helpers.js'

/**
 * Atomic JSON write: mkdir → tmp write → rename.
 *
 * Creates parent directories if needed. Writes to .tmp first, then
 * renames atomically to prevent partial writes on crash.
 *
 * @param {string} filePath — absolute path for output
 * @param {*} data — JSON-serializable value
 */
export function writeJsonAtomic (filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

/**
 * Format a Date as ISO8601 without colons/dots for safe filenames.
 *
 * Accepts Date, ISO string, or undefined (defaults to now).
 *
 * @param {Date|string|undefined} date
 * @returns {string} e.g. '2026-07-06T124816971'
 */
export function formatFixtureTimestamp (date) {
  const d = !date
    ? new Date()
    : typeof date === 'string'
      ? new Date(date)
      : date
  return d.toISOString().replace(/[:.]/g, '').replace('Z', '')
}

/**
 * Sanitise a bookId for safe use in fixture filenames.
 *
 * Replaces any non-alphanumeric character (except _ and -) with _,
 * preventing path traversal via crafted IDs.
 *
 * @param {*} id — raw book identifier
 * @returns {string} sanitised, or 'unknown' if result is empty
 */
export function sanitiseFixtureId (id) {
  return sanitiseBookId(id) || 'unknown'
}