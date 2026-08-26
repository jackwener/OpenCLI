/**
 * ManageMutationTraceRecorder captures mutation trace for --fixture mode.
 *
 * Produces mutation-trace fixtures (schemaVersion: 1,
 * fixtureKind: 'zlibrary-app.booklist-manage.mutation-trace').
 *
 * Unified schema for add and delete. No cookies or session tokens stored.
 *
 * @module manage-recorder
 */
import path from 'node:path'
import { writeJsonAtomic, formatFixtureTimestamp, sanitiseFixtureId } from './output.js'

class ManageMutationTraceRecorder {
  constructor({ enabled, operation, booklistName, bookId, fixtureDir }) {
    this.enabled = enabled
    this.fixtureDir = fixtureDir || null
    this.data = {
      schemaVersion: 1,
      fixtureKind: 'zlibrary-app.booklist-manage.mutation-trace',
      operation: operation || '',
      input: { booklistName: booklistName || '', bookId: bookId || '' },
      booklist: null,
      phases: [],
      assertions: [],
      error: null,
      elapsedMs: 0,
    }
    this.startTime = Date.now()
  }

  /**
   * Record an API call phase.
   * @param {string} name  -  unique phase name
   * @param {object} details  -  { method, url, httpStatus, body, elapsedMs }
   */
  recordApiPhase(name, details) {
    if (!this.enabled) return
    this.data.phases.push({
      name,
      kind: 'api',
      request: { method: details.method || 'GET', url: details.url || '' },
      response: { httpStatus: details.httpStatus || 0, body: details.body || null },
      elapsedMs: details.elapsedMs || 0,
    })
  }

  /**
   * Record a DOM state phase after mutation.
   * @param {string} name  -  phase name
   * @param {object} domState  -  { urlOrigin, urlPath, targetBookId, targetBookPresent, visibleTexts, bookcardsCount, errors, htmlSnapshot? }
   */
  recordDomPhase(name, domState) {
    if (!this.enabled) return
    const phase = {
      name,
      kind: 'dom',
      state: {
        urlOrigin: domState.urlOrigin || '',
        urlPath: domState.urlPath || '',
        targetBookId: domState.targetBookId || '',
        targetBookPresent: Boolean(domState.targetBookPresent),
        visibleTexts: Array.isArray(domState.visibleTexts) ? domState.visibleTexts : [],
        bookcardsCount: typeof domState.bookcardsCount === 'number' ? domState.bookcardsCount : 0,
        errors: Array.isArray(domState.errors) ? domState.errors : [],
      },
    }
    if (domState.htmlSnapshot) {
      phase.htmlSnapshot = domState.htmlSnapshot
    }
    this.data.phases.push(phase)
  }

  /**
   * Record an assertion with auto pass/fail.
   * @param {string} name  -  assertion name
   * @param {string} status  -  'pass' or 'fail'
   * @param {string} message  -  human-readable description
   */
  recordAssertion(name, status, message) {
    if (!this.enabled) return
    this.data.assertions.push({ name, status, message: message || '' })
  }

  /** Record the resolved booklist metadata. */
  setBooklist(booklist) {
    if (!this.enabled) return
    this.data.booklist = booklist || null
  }

  /** Record a structured error. */
  setError(error) {
    if (!this.enabled) return
    this.data.error = {
      phase: error.phase || '',
      type: error.type || typeof error,
      message: error.message || String(error || ''),
    }
  }

  /**
   * Save the fixture to disk.
   * @returns {string|null}  Path to saved fixture file, or null if disabled
   */
  save() {
    if (!this.enabled || !this.fixtureDir) return null

    this.data.elapsedMs = Date.now() - this.startTime

    const filename = buildManageFixtureFilename(this.data.operation, this.data.input.bookId)
    const filepath = path.join(this.fixtureDir, filename)
    writeJsonAtomic(filepath, this.data)
    return filepath
  }
}

function buildManageFixtureFilename(operation, bookId) {
  const safeId = sanitiseFixtureId(bookId)
  return `booklist-manage-${operation}-${safeId}-${formatFixtureTimestamp(new Date())}.manage.fixture.json`
}

export { ManageMutationTraceRecorder, buildManageFixtureFilename }
