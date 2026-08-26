import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  saveSnapshot, loadSnapshot, compareShape,
  classifyProbeDiff, adaptProbeEntry, saveSnapshotOrWarn,
  printSecurityWarning, detectProbeDrift,
} from './snapshot.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function tmpPath(name) {
  return path.join(tmpDir, name)
}

// ---------------------------------------------------------------------------
// Scenario 13: Snapshot round-trips correctly
// ---------------------------------------------------------------------------

describe('saveSnapshot / loadSnapshot', () => {
  it('round-trips probe results', () => {
    const results = {
      'api-current-user': {
        endpoint: '/papi/booklist/current-user/',
        httpStatus: 200,
        shape: 'array<id,name,product,productStatus>',
        observedCount: 5,
        response: { success: 1, list: [{ id: 1, title: 'Favorites' }] },
      },
    }

    const saveRes = saveSnapshot(results, tmpPath('test.json'))
    expect(saveRes.success).toBe(true)

    const loaded = loadSnapshot(tmpPath('test.json'))
    expect(loaded).toBeTruthy()
    expect(loaded._meta).toBeUndefined()
    expect(loaded.results['api-current-user'].shape).toBe('array<id,name,product,productStatus>')
    expect(loaded.results['api-current-user'].response).toEqual(results['api-current-user'].response)
  })

  it('round-trips probe results without sanitize metadata', () => {
    const results = {
      'api-current-user': {
        endpoint: '/papi/booklist/current-user/',
        httpStatus: 200,
        shape: 'list<id,title>',
        observedCount: 2,
        response: {
          success: 1,
          list: [
            { id: 1, title: 'Book 1', token: '[REDACTED]', email: '[REDACTED]' },
            { id: 2, title: 'Book 2', token: '[REDACTED]', phone: '[REDACTED]' },
          ],
        },
      },
    }

    const saveRes = saveSnapshot(results, tmpPath('test-sanitize.json'))
    expect(saveRes.success).toBe(true)

    const loaded = loadSnapshot(tmpPath('test-sanitize.json'))
    expect(loaded).toBeTruthy()
    expect(loaded.results['api-current-user'].sanitize).toBeUndefined()
    // Verify masked values are preserved in response
    expect(loaded.results['api-current-user'].response.list[0].token).toBe('[REDACTED]')
    expect(loaded.results['api-current-user'].response.list[0].email).toBe('[REDACTED]')
    expect(loaded.results['api-current-user'].response.list[0].id).toBe(1)
    expect(loaded.results['api-current-user'].response.list[0].title).toBe('Book 1')
  })

  it('loadSnapshot returns null for missing file', () => {
    const loaded = loadSnapshot(tmpPath('nonexistent.json'))
    expect(loaded).toBeNull()
  })

  it('loadSnapshot returns null for corrupt JSON', () => {
    fs.writeFileSync(tmpPath('corrupt.json'), '{not valid json}', 'utf-8')
    const loaded = loadSnapshot(tmpPath('corrupt.json'))
    expect(loaded).toBeNull()
  })

  it('saveSnapshot handles write errors gracefully', () => {
    const results = { 'test-probe': { endpoint: '/test', httpStatus: 200, shape: 'object', observedCount: 1, data: {} } }

    // Create a file at the parent path so mkdir/write fails
    fs.writeFileSync(tmpPath('blocked-file'), 'not-a-directory', 'utf-8')
    const saveRes = saveSnapshot(results, tmpPath('blocked-file/test.json'))
    expect(saveRes.success).toBe(false)
    expect(saveRes.error).toBeTruthy()
  })

  it('saveSnapshot handles empty results gracefully', () => {
    const saveRes = saveSnapshot({}, tmpPath('empty.json'))
    expect(saveRes.success).toBe(true)

    const loaded = loadSnapshot(tmpPath('empty.json'))
    expect(loaded.results).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// Scenario 14-16: compareShape
// ---------------------------------------------------------------------------

describe('compareShape', () => {
  it('returns isIdentical for matching shapes', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'array<id,name>' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: 'array<id,name>' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(true)
    expect(diff.addedKeys).toEqual([])
    expect(diff.missingKeys).toEqual([])
    expect(diff.endpointChanged).toBe(false)
    expect(diff.httpStatusChanged).toBe(false)
  })

  it('detects added keys in shape', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'array<id,name>' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: 'array<id,name,email>' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(false)
    expect(diff.addedKeys).toContain('email')
    expect(diff.missingKeys).toEqual([])
  })

  it('detects missing keys in shape', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'array<id,name,email>' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: 'array<id,name>' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(false)
    expect(diff.missingKeys).toContain('email')
    expect(diff.addedKeys).toEqual([])
  })

  it('detects endpoint URL change', () => {
    const recorded = { endpoint: '/papi/booklist/current-user/', httpStatus: 200, shape: 'object' }
    const current = { endpoint: '/papi/booklist/v2/current-user/', httpStatus: 200, shape: 'object' }
    const diff = compareShape(recorded, current)
    expect(diff.endpointChanged).toBe(true)
    expect(diff.isIdentical).toBe(false)
  })

  it('detects HTTP status change', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'object' }
    const current = { endpoint: '/api/test', httpStatus: 404, shape: 'object' }
    const diff = compareShape(recorded, current)
    expect(diff.httpStatusChanged).toBe(true)
    expect(diff.isIdentical).toBe(false)
  })

  it('detects shape + endpoint dual change', () => {
    const recorded = { endpoint: '/api/v1', httpStatus: 200, shape: 'array<id,name>' }
    const current = { endpoint: '/api/v2', httpStatus: 200, shape: 'array<id,name,email>' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(false)
    expect(diff.endpointChanged).toBe(true)
    expect(diff.addedKeys).toContain('email')
    expect(diff.missingKeys).toEqual([])
  })

  it('detects type change array→object', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'array<id,name>' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: 'object' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(false)
  })

  it('handles empty arrays as identical', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'array<empty>' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: 'array<empty>' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(true)
  })

  it('handles new probe not in snapshot', () => {
    const recorded = { endpoint: '/api/old', httpStatus: 200, shape: 'object' }
    const current = { endpoint: '/api/new', httpStatus: 200, shape: 'object' }
    // If the probe name doesn't exist in the fixture, the caller handles it.
    // compareShape itself just compares the two entries.
    const diff = compareShape(recorded, current)
    expect(diff.endpointChanged).toBe(true)
  })

  // Flat object shape tests (new format)
  it('handles flat object shape comparison', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'id,name,product' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: 'id,name,product' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(true)
    expect(diff.addedKeys).toEqual([])
    expect(diff.missingKeys).toEqual([])
  })

  it('detects added keys in flat object shape', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'id,name' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: 'id,name,email,slug' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(false)
    expect(diff.addedKeys).toContain('email')
    expect(diff.addedKeys).toContain('slug')
    expect(diff.missingKeys).toEqual([])
  })

  it('detects missing keys in flat object shape', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'id,name,email,slug' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: 'id,name' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(false)
    expect(diff.missingKeys).toContain('email')
    expect(diff.missingKeys).toContain('slug')
    expect(diff.addedKeys).toEqual([])
  })

  it('detects array to flat object type change', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: 'array<id,name>' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: 'id,name,product' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(false)
    // array<id,name> has keys {id,name}, flat object has keys {id,name,product}
    expect(diff.addedKeys).toContain('product')
  })

  it('handles empty flat object shape', () => {
    const recorded = { endpoint: '/api/test', httpStatus: 200, shape: '(empty)' }
    const current = { endpoint: '/api/test', httpStatus: 200, shape: '(empty)' }
    const diff = compareShape(recorded, current)
    expect(diff.isIdentical).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// classifyProbeDiff
// ---------------------------------------------------------------------------

describe('classifyProbeDiff', () => {
  const recordedEntry = { location: '/api/v1', httpStatus: 200, shape: 'id,name' }
  const currentEntry = { location: '/api/v1', httpStatus: 200, shape: 'id,name' }

  it('returns warn for added keys only', () => {
    const diff = { addedKeys: ['email'], missingKeys: [], endpointChanged: false, httpStatusChanged: false }
    const result = classifyProbeDiff(diff, 'test-probe', currentEntry, recordedEntry)
    expect(result.severity).toBe('warn')
    expect(result.probe).toBe('fixture-test-probe')
    expect(result.message).toContain('added: email')
  })

  it('returns fail for missing keys', () => {
    const diff = { addedKeys: [], missingKeys: ['name'], endpointChanged: false, httpStatusChanged: false }
    const result = classifyProbeDiff(diff, 'test-probe', currentEntry, recordedEntry)
    expect(result.severity).toBe('fail')
    expect(result.message).toContain('missing: name')
  })

  it('returns fail for location change', () => {
    const diff = { addedKeys: [], missingKeys: [], endpointChanged: true, httpStatusChanged: false }
    const result = classifyProbeDiff(diff, 'test-probe', currentEntry, recordedEntry)
    expect(result.severity).toBe('fail')
    expect(result.message).toContain('location changed')
  })

  it('returns fail for HTTP status drift to failing status', () => {
    const currentEntryFail = { location: '/api/v1', httpStatus: 500, shape: 'id,name' }
    const diff = { addedKeys: [], missingKeys: [], endpointChanged: false, httpStatusChanged: true }
    const result = classifyProbeDiff(diff, 'test-probe', currentEntryFail, recordedEntry)
    expect(result.severity).toBe('fail')
    expect(result.message).toContain('http status changed')
  })

  it('returns warn for HTTP status drift between healthy statuses', () => {
    const currentEntryRedirect = { location: '/api/v1', httpStatus: 302, shape: 'id,name' }
    const diff = { addedKeys: [], missingKeys: [], endpointChanged: false, httpStatusChanged: true }
    const result = classifyProbeDiff(diff, 'test-probe', currentEntryRedirect, recordedEntry)
    expect(result.severity).toBe('warn')
  })

  it('includes diffDetail in result', () => {
    const diff = { addedKeys: ['x'], missingKeys: ['y'], endpointChanged: true, httpStatusChanged: true }
    const result = classifyProbeDiff(diff, 'p', currentEntry, recordedEntry)
    expect(result.diffDetail).toEqual({ addedKeys: ['x'], missingKeys: ['y'], endpointChanged: true, httpStatusChanged: true })
  })
})

// ---------------------------------------------------------------------------
// adaptProbeEntry
// ---------------------------------------------------------------------------

describe('adaptProbeEntry', () => {
  it('maps physical entry to normalized ProbeEntry', () => {
    const entry = { endpoint: '/api/test', httpStatus: 200, shape: 'id,name', observedCount: '5', response: { id: 1 } }
    const mapping = { probeName: 'api-probe', sourceKind: 'api', locationKey: 'endpoint', shapeKey: 'shape', observedCountKey: 'observedCount', payloadKey: 'response' }
    const result = adaptProbeEntry(entry, mapping)
    expect(result.probeName).toBe('api-probe')
    expect(result.sourceKind).toBe('api')
    expect(result.location).toBe('/api/test')
    expect(result.httpStatus).toBe(200)
    expect(result.shape).toBe('id,name')
    expect(result.observedCount).toBe('5')
    expect(result.payload).toEqual({ id: 1 })
  })

  it('maps DOM entry with selector as location', () => {
    const entry = { selector: '.my-selector', shape: 'a,b', observedCount: '2', data: { a: 1 } }
    const mapping = { probeName: 'dom-probe', sourceKind: 'private-dom', locationKey: 'selector', shapeKey: 'shape', observedCountKey: 'observedCount', payloadKey: 'data' }
    const result = adaptProbeEntry(entry, mapping)
    expect(result.location).toBe('.my-selector')
    expect(result.sourceKind).toBe('private-dom')
  })

  it('handles missing fields gracefully', () => {
    const result = adaptProbeEntry({}, { probeName: 'empty', sourceKind: 'api', locationKey: 'endpoint', shapeKey: 'shape', observedCountKey: 'observedCount', payloadKey: 'data' })
    expect(result.location).toBe('')
    expect(result.httpStatus).toBe(200)
    expect(result.shape).toBe('')
    expect(result.observedCount).toBe('')
    expect(result.payload).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// saveSnapshotOrWarn
// ---------------------------------------------------------------------------

describe('saveSnapshotOrWarn', () => {
  let stdoutWrite
  let stderrWrite

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stdoutWrite.mockRestore()
    stderrWrite.mockRestore()
  })

  it('returns true and prints saved message on successful write', () => {
    const results = { probe: { shape: 'a' } }
    const result = saveSnapshotOrWarn(results, tmpPath('success.json'))
    expect(result).toBe(true)
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Behavior snapshot saved'))
    expect(stderrWrite).not.toHaveBeenCalled()
  })

  it('returns false and prints WARN on write failure', () => {
    const results = { probe: { shape: 'a' } }
    fs.writeFileSync(tmpPath('block'), 'x', 'utf-8')
    const result = saveSnapshotOrWarn(results, tmpPath('block/nope.json'))
    expect(result).toBe(false)
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('WARN'))
  })
})

// ---------------------------------------------------------------------------
// printSecurityWarning
// ---------------------------------------------------------------------------

describe('printSecurityWarning', () => {
  it('prints the exact shared warning text', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    printSecurityWarning()
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('may contain sensitive data'))
    writeSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// detectProbeDrift
// ---------------------------------------------------------------------------

describe('detectProbeDrift', () => {
  it('calls handleNoFixture when fixture missing', () => {
    const handleNoFixture = vi.fn()
    const result = detectProbeDrift({ p: {} }, tmpPath('nonexist.json'), {
      recordedEntryMap: () => ({}),
      recordDrift: vi.fn(),
      handleMissingProbe: vi.fn(),
      handleNoFixture,
    })
    expect(result).toBe(false)
    expect(handleNoFixture).toHaveBeenCalled()
  })

  it('calls handleMissingProbe when current probe has no recorded match', () => {
    const fixturePath = tmpPath('missing-probe.json')
    saveSnapshot({ existing: { shape: 'a' } }, fixturePath)
    const handleMissingProbe = vi.fn()
    const result = detectProbeDrift(
      { newProbe: { location: '/x', httpStatus: 200, shape: 'a' } },
      fixturePath,
      {
        recordedEntryMap: () => ({ existing: { location: '/x', httpStatus: 200, shape: 'a' } }),
        recordDrift: vi.fn(),
        handleMissingProbe,
      }
    )
    expect(result).toBe(true)
    expect(handleMissingProbe).toHaveBeenCalledWith('newProbe', expect.any(Object), fixturePath)
  })

  it('calls recordDrift with diff record when shape differs', () => {
    const fixturePath = tmpPath('drift-test.json')
    saveSnapshot({ probe1: { endpoint: '/old', httpStatus: 200, shape: 'a,b' } }, fixturePath)
    const recordDrift = vi.fn()
    const result = detectProbeDrift(
      { probe1: { location: '/old', httpStatus: 200, shape: 'a,b,c' } },
      fixturePath,
      {
        recordedEntryMap: (results) => ({
          probe1: { location: results.probe1.endpoint, httpStatus: results.probe1.httpStatus, shape: results.probe1.shape },
        }),
        recordDrift,
        handleMissingProbe: vi.fn(),
      }
    )
    expect(result).toBe(true)
    expect(recordDrift).toHaveBeenCalled()
    const callArg = recordDrift.mock.calls[0][0]
    expect(callArg.probe).toBe('fixture-probe1')
    expect(callArg.severity).toBe('warn')
    expect(callArg.message).toContain('added: c')
  })

  it('throws TypeError when adapter lacks required methods', () => {
    expect(() => detectProbeDrift({ p: {} }, tmpPath('x.json'), { recordedEntryMap: null, recordDrift: null, handleMissingProbe: null }))
      .toThrow(TypeError)
  })

  it('returns false for empty currentEntries', () => {
    const result = detectProbeDrift({}, tmpPath('x.json'), {
      recordedEntryMap: () => ({}),
      recordDrift: vi.fn(),
      handleMissingProbe: vi.fn(),
    })
    expect(result).toBe(false)
  })

  it('returns false when all probes match', () => {
    const fixturePath = tmpPath('match.json')
    saveSnapshot({ p: { endpoint: '/x', httpStatus: 200, shape: 'a,b' } }, fixturePath)
    const recordDrift = vi.fn()
    const result = detectProbeDrift(
      { p: { location: '/x', httpStatus: 200, shape: 'a,b' } },
      fixturePath,
      {
        recordedEntryMap: (r) => ({ p: { location: r.p.endpoint, httpStatus: r.p.httpStatus, shape: r.p.shape } }),
        recordDrift,
        handleMissingProbe: vi.fn(),
      }
    )
    expect(result).toBe(false)
    expect(recordDrift).not.toHaveBeenCalled()
  })
})
