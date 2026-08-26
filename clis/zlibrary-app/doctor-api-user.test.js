import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@jackwener/opencli/registry', () => ({
  Strategy: { UI: 'UI' },
}))

import { doctorApiUserCommand } from './doctor-api-user.js'

describe('doctor-api-user', () => {
  let stderrWriteSpy

  beforeEach(() => {
    vi.clearAllMocks()
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrWriteSpy.mockRestore()
  })

  it('returns explicit na row in normal mode', async () => {
    const rows = await doctorApiUserCommand.func({}, {})

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      probe: 'api-user-disabled',
      endpoint: '/eapi/user/update',
      status: 'na',
    })
  })

  it('warns and returns no rows when save-fixture is requested', async () => {
    const rows = await doctorApiUserCommand.func({}, { 'save-fixture': true })

    expect(rows).toEqual([])
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      expect.stringMatching(/doctor-api-user does not support --save-fixture/i)
    )
  })
})
