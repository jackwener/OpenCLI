/**
 * ApiCallRecorder — pure-observer fixture recorder for booklist API calls.
 *
 * Injected into requestBooklistApi() via options.recorder. Records every
 */
import path from 'node:path'
import { writeJsonAtomic, formatFixtureTimestamp } from './output.js'

class ApiCallRecorder {
  /**
   * @param {{ enabled?: boolean, fixtureDir?: string }} opts
   */
  constructor ({ enabled, fixtureDir } = {}) {
    this.enabled = enabled !== false
    this.fixtureDir = fixtureDir || null
    this.entries = []
    this.startTime = Date.now()
    this._savedFilePath = null
  }

  /**
   * Record one API call.
   *
   * Stores raw responseBody (no sanitize — fixture/ is gitignored).
   *
   * @param {{ endpoint: string, method?: string, requestBody?: *, httpStatus?: number, responseBody?: * }} entry
   */
  record ({ endpoint, method, requestBody, httpStatus, responseBody }) {
    if (!this.enabled) return
    this.entries.push({
      endpoint,
      method: method || 'GET',
      requestBody: requestBody != null ? requestBody : null,
      httpStatus: httpStatus != null ? httpStatus : 200,
      responseBody,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Save recorded fixture to disk.
   *
   * @param {string} commandName — e.g. 'booklist-list'
   * @param {object} [argv] — command kwargs for traceability
   * @returns {string|null} saved file path, or null if disabled
   */
  save (commandName, argv) {
    if (!this.enabled || !this.fixtureDir) return null

    const data = {
      schemaVersion: 1,
      fixtureKind: 'zlibrary-app.booklist-api-calls',
      command: commandName,
      argv: argv || {},
      apiCalls: this.entries,
      elapsedMs: Date.now() - this.startTime,
    }

    const filename = commandName + '-' + formatFixtureTimestamp(new Date()) + '.fixture.json'
    const filepath = path.join(this.fixtureDir, filename)

    writeJsonAtomic(filepath, data)

    this._savedFilePath = filepath
    return filepath
  }
}

export { ApiCallRecorder }