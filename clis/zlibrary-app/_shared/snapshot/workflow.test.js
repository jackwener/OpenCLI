/**
 * Unit tests for snapshot-workflow.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { classifyFieldHealth, createSnapshotDriftAdapter } from './workflow.js'
import * as snapshotModule from './snapshot.js'

// ---------------------------------------------------------------------------
// classifyFieldHealth
// ---------------------------------------------------------------------------

describe('classifyFieldHealth', () => {
  it('should return pass when ratio is 1', () => {
    const r = classifyFieldHealth(10, 10)
    expect(r.status).toBe('pass')
    expect(r.message).toBe('')
  })

  it('should return warn when ratio > 0.5', () => {
    const r = classifyFieldHealth(6, 10)
    expect(r.status).toBe('warn')
    expect(r.message).toContain('60%')
  })

  it('should return fail when ratio <= 0.5 (critical)', () => {
    const r = classifyFieldHealth(3, 10, 'critical')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('mostly empty')
  })

  it('should return fail when ratio <= 0.5 (warning severity)', () => {
    const r = classifyFieldHealth(3, 10, 'warning')
    expect(r.status).toBe('fail')
    expect(r.message).toContain('low fill rate')
  })

  it('should return na when allowMissing and zero non-empty', () => {
    const r = classifyFieldHealth(0, 5, 'critical', true)
    expect(r.status).toBe('na')
  })

  it('should handle totalItems of 0 gracefully', () => {
    const r = classifyFieldHealth(0, 0)
    expect(r.status).toBe('fail')
  })

  it('should return fail for ratio < 0.5', () => {
    const r = classifyFieldHealth(1, 10)
    expect(r.status).toBe('fail')
  })
})

// ---------------------------------------------------------------------------
// createSnapshotDriftAdapter
// ---------------------------------------------------------------------------

describe('createSnapshotDriftAdapter', () => {
  const addRow = vi.fn()

  beforeEach(() => {
    addRow.mockClear()
  })

  it('should create adapter with all required methods', () => {
    const adapter = createSnapshotDriftAdapter({
      addRow,
      entryKey: 'quota',
      sourceKind: 'private-dom',
      locationFn: (e) => e.selector || '',
    })
    expect(adapter).toHaveProperty('recordedEntryMap')
    expect(adapter).toHaveProperty('recordDrift')
    expect(adapter).toHaveProperty('handleMissingProbe')
    expect(adapter).toHaveProperty('handleNoFixture')
  })

  describe('recordedEntryMap', () => {
    it('should map single entry correctly', () => {
      const adapter = createSnapshotDriftAdapter({
        addRow,
        entryKey: 'quota',
        sourceKind: 'private-dom',
        locationFn: (e) => e.selector || '',
      })
      const result = adapter.recordedEntryMap({
        quota: { selector: '.dstats', shape: 'countText,resetText', observedCount: '5', data: { x: 1 }, httpStatus: 200 },
      })
      expect(result.quota).toBeDefined()
      expect(result.quota.probeName).toBe('quota')
      expect(result.quota.sourceKind).toBe('private-dom')
      expect(result.quota.location).toBe('.dstats')
      expect(result.quota.shape).toBe('countText,resetText')
      expect(result.quota.observedCount).toBe('5')
      expect(result.quota.httpStatus).toBe(200)
    })

    it('should return empty when entryKey not found', () => {
      const adapter = createSnapshotDriftAdapter({
        addRow,
        entryKey: 'quota',
        sourceKind: 'private-dom',
      })
      const result = adapter.recordedEntryMap({ 'other-key': {} })
      expect(result).toEqual({})
    })

    it('should use fixtureAdapterMap when provided', () => {
      const adapter = createSnapshotDriftAdapter({
        addRow,
        entryKey: 'api-current-user',
        sourceKind: 'api',
        fixtureAdapterMap: (probeName, entry) => ({
          probeName,
          sourceKind: 'api',
          location: entry.endpoint || '',
          httpStatus: Number(entry.httpStatus ?? 200),
          shape: String(entry.shape || ''),
          observedCount: String(entry.observedCount || ''),
          payload: entry.data || {},
        }),
      })
      const result = adapter.recordedEntryMap({
        'api-current-user': { endpoint: '/api/user', shape: 'success,list', observedCount: '1', data: {} },
      })
      expect(result['api-current-user']).toBeDefined()
      expect(result['api-current-user'].location).toBe('/api/user')
    })
  })

  describe('recordDrift', () => {
    it('should call addRow with diffRecord', () => {
      const adapter = createSnapshotDriftAdapter({ addRow, entryKey: 'test', sourceKind: 'api' })
      adapter.recordDrift({ probe: 'test', severity: 'warn', message: 'drifted' })
      expect(addRow).toHaveBeenCalledWith({ probe: 'test', severity: 'warn', message: 'drifted' })
    })
  })

  describe('handleMissingProbe', () => {
    it('should call addRow with fixture- prefixed probe', () => {
      const adapter = createSnapshotDriftAdapter({ addRow, entryKey: 'test', sourceKind: 'api' })
      adapter.handleMissingProbe('quota', {}, 'path')
      expect(addRow).toHaveBeenCalledWith({
        probe: 'fixture-quota',
        severity: 'warn',
        message: expect.stringContaining('No fixture entry'),
      })
    })
  })

  describe('handleNoFixture', () => {
    it('should write hint to stdout', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => {})
      const adapter = createSnapshotDriftAdapter({ addRow, entryKey: 'test', sourceKind: 'api' })
      adapter.handleNoFixture('/path/to/fixture.json')
      expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('HINT'))
      writeSpy.mockRestore()
    })
  })
})

// ---------------------------------------------------------------------------
// saveSnapshotIfStable
// ---------------------------------------------------------------------------

describe('saveSnapshotIfStable', () => {
  // Dynamic import to allow mocking of dependencies
  let saveSnapshotIfStable

  beforeEach(async () => {
    vi.resetModules()
    vi.mock('./snapshot.js', () => ({
      saveSnapshotOrWarn: vi.fn(() => true),
      printSecurityWarning: vi.fn(),
    }))
    const mod = await import('./workflow.js')
    saveSnapshotIfStable = mod.saveSnapshotIfStable
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should save when allPass is true', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {})
    const result = saveSnapshotIfStable({ results: {} }, '/tmp/test.json', { allPass: true })
    expect(result).toBe(true)
    stderrSpy.mockRestore()
  })

  it('should skip save when allPass is false', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {})
    const result = saveSnapshotIfStable({ results: {} }, '/tmp/test.json', { allPass: false })
    expect(result).toBe(false)
    expect(stderrSpy).toHaveBeenCalled()
    stderrSpy.mockRestore()
  })

  it('should skip save when allPass is not provided', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {})
    const result = saveSnapshotIfStable({ results: {} }, '/tmp/test.json')
    expect(result).toBe(false)
    stderrSpy.mockRestore()
  })
})
