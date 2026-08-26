import { describe, it, expect } from 'vitest'
import { createSnapshotSanitizer } from './sanitizer.js'

describe('createSnapshotSanitizer', () => {
  it('masks selected keys while preserving nested shape', () => {
    const sanitize = createSnapshotSanitizer({
      valueByKey: {
        id: 0,
        title: '[REDACTED]',
      },
    })

    const payload = {
      success: 1,
      list: [
        { id: 3641118, title: 'Live title', nested: { id: 7, title: 'Nested title' } },
      ],
    }

    const sanitized = sanitize(payload)

    expect(sanitized).toEqual({
      success: 1,
      list: [
        { id: 0, title: '[REDACTED]', nested: { id: 0, title: '[REDACTED]' } },
      ],
    })
    expect(payload.list[0].title).toBe('Live title')
  })

  it('supports path-specific masking for nested sensitive values', () => {
    const sanitize = createSnapshotSanitizer({
      valueByPath: {
        'user.email': '[REDACTED]',
        'user.profile.url': '',
      },
    })

    const payload = {
      user: {
        id: 9,
        email: 'person@example.com',
        profile: {
          url: 'https://example.com/avatar.png',
          name: 'Person',
        },
      },
    }

    const sanitized = sanitize(payload)

    expect(sanitized).toEqual({
      user: {
        id: 9,
        email: '[REDACTED]',
        profile: {
          url: '',
          name: 'Person',
        },
      },
    })
  })
})
