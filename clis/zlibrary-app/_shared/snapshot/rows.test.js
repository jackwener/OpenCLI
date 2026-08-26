/**
 * Tests for snapshot-rows.js  -  universal 5-key row helper
 */

import { describe, it, expect } from 'vitest'
import { DOCTOR_OUTPUT_COLUMNS, doctorRow, doctorNavRow } from './rows.js'

describe('DOCTOR_OUTPUT_COLUMNS', () => {
  it('should have exactly 5 keys', () => {
    expect(DOCTOR_OUTPUT_COLUMNS).toEqual(['probe', 'status', 'count', 'sampleValue', 'message'])
  })
})

describe('doctorRow', () => {
  it('should produce row with exactly 5 keys', () => {
    const r = doctorRow({ probe: 'p1', status: 'pass', count: 3, sampleValue: 'val', message: 'ok' })
    expect(Object.keys(r)).toHaveLength(5)
    expect(r).toEqual({ probe: 'p1', status: 'pass', count: '3', sampleValue: 'val', message: 'ok' })
  })

  it('should handle empty/null args gracefully', () => {
    const r = doctorRow({})
    expect(r.probe).toBe('')
    expect(r.status).toBe('')
    expect(r.count).toBe('')
    expect(r.sampleValue).toBe('')
    expect(r.message).toBe('')
  })

  it('should handle undefined args gracefully', () => {
    const r = doctorRow({ probe: 'p1' })
    expect(r.probe).toBe('p1')
    expect(r.status).toBe('')
    expect(r.count).toBe('')
  })
})

describe('doctorNavRow', () => {
  it('should produce nav row with modeName-navigation probe', () => {
    const n = doctorNavRow('quota', 'pass', 'navigated OK')
    expect(Object.keys(n)).toHaveLength(5)
    expect(n.probe).toBe('quota-navigation')
    expect(n.status).toBe('pass')
    expect(n.count).toBe('')
    expect(n.sampleValue).toBe('')
    expect(n.message).toBe('navigated OK')
  })

  it('should handle empty modeName', () => {
    const n = doctorNavRow('', 'fail', 'err')
    expect(n.probe).toBe('')
    expect(n.status).toBe('fail')
  })
})
