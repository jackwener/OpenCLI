import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPageMock } from '../test-utils.js'

vi.mock('@jackwener/opencli/errors', () => {
  class CommandExecutionError extends Error {}
  class ArgumentError extends Error {}
  return { CommandExecutionError, ArgumentError }
})

vi.mock('@jackwener/opencli/registry', () => ({
  Strategy: { UI: 'UI' },
}))

vi.mock('./_shared/snapshot/workflow.js', async () => {
  const actual = await vi.importActual('./_shared/snapshot/workflow.js')
  return {
    ...actual,
    runSnapshotWorkflow: vi.fn(),
  }
})

vi.mock('./_shared/booklist/api.js', () => ({
  requestBooklistApi: vi.fn(),
  diagnoseExtractBookRows: vi.fn(),
  diagnoseClickLoadMore: vi.fn(),
}))

describe('doctor-booklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('waits for hydrated bookcards before extraction', async () => {
    const events = []
    const page = createPageMock([false, true], {
      wait: vi.fn(async () => {
        events.push('wait')
      }),
    })

    const snapshotWorkflow = await import('./_shared/snapshot/workflow.js')
    const booklistApi = await import('./_shared/booklist/api.js')
    const { execDomPhase } = await import('./doctor-booklist.js')

    booklistApi.diagnoseExtractBookRows.mockImplementation(async () => {
      events.push('extract')
      return [{ bookId: '1', url: 'https://z-lib.gl/book/1/a.html', title: 'Book A', author: 'Author A' }]
    })

    snapshotWorkflow.runSnapshotWorkflow.mockImplementation(async function (options) {
      events.push('workflow')
      await options.capture(page, 'https://z-lib.gl')
      return { rows: [], success: true, fixtureSaved: false }
    })

    await execDomPhase(page, { 'save-fixture': false })

    expect(page.wait).toHaveBeenCalledWith(1500)
    expect(events.indexOf('wait')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('extract')).toBeGreaterThan(events.indexOf('wait'))
  })
})
