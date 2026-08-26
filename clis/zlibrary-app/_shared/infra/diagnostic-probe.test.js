import { describe, expect, it } from 'vitest'
import { urlProbe } from './diagnostic-probe.js'

// ---------------------------------------------------------------------------
// urlProbe
// ---------------------------------------------------------------------------

describe('urlProbe', () => {
  it('has correct name', () => {
    expect(urlProbe.name).toBe('url')
  })

  it('sanitize redacts /dl/<token> from URLs', () => {
    const result = urlProbe.sanitize({
      origin: 'https://1lib.sk',
      href: 'https://1lib.sk/dl/secretToken123/file.epub',
      dlLinks: [
        'https://1lib.sk/dl/token456/file.pdf',
        'https://cdn.example.com/file.epub',
      ],
    })
    expect(result.origin).toBe('https://1lib.sk')
    expect(result.hrefSanitized).toContain('/dl/...')
    expect(result.hrefSanitized).not.toContain('secretToken123')
    expect(result.dlLinksSanitized[0]).toContain('/dl/...')
    expect(result.dlLinksSanitized[1]).toBe('https://cdn.example.com/file.epub')
  })

  it('toSnapshotEntry wraps data with metadata', () => {
    const entry = urlProbe.toSnapshotEntry('test-url', { origin: 'https://1lib.sk' })
    expect(entry).toHaveProperty('test-url')
    expect(entry['test-url'].kind).toBe('url')
    expect(entry['test-url'].capturedAt).toBeTruthy()
    expect(entry['test-url'].data.origin).toBe('https://1lib.sk')
  })

  it('compare detects origin mismatch', () => {
    const rows = urlProbe.compare(
      { origin: 'https://z-lib.org', hrefSanitized: '' },
      { origin: 'https://1lib.sk', hrefSanitized: '' },
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].status).toBe('fail')
  })

  it('compare returns empty for matching data', () => {
    const rows = urlProbe.compare(
      { origin: 'https://1lib.sk', hrefSanitized: '' },
      { origin: 'https://1lib.sk', hrefSanitized: '' },
    )
    expect(rows).toHaveLength(0)
  })

  it('toDoctorRows converts compare results', () => {
    const results = [
      { probe: 'url-origin', status: 'fail', count: 1, sampleValue: 'https://z-lib.org', message: 'Origin mismatch' },
    ]
    const rows = urlProbe.toDoctorRows(results)
    expect(rows).toHaveLength(1)
    expect(rows[0].probe).toBe('url-origin')
    expect(rows[0].status).toBe('fail')
  })
})


