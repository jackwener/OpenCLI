import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPageMock } from '../test-utils.js'

vi.mock('@jackwener/opencli/registry', () => ({
  Strategy: { UI: 'UI' },
}))

vi.mock('@jackwener/opencli/errors', () => {
  class ArgumentError extends Error {}
  class CommandExecutionError extends Error {}
  class LoginWallError extends Error {}
  return {
    ArgumentError,
    CommandExecutionError,
    LoginWallError,
  }
})

vi.mock('./_shared/snapshot/workflow.js', async () => {
  const actual = await vi.importActual('./_shared/snapshot/workflow.js')
  return {
    ...actual,
    runSnapshotWorkflow: vi.fn(),
  }
})

vi.mock('./_shared/infra/search-pipeline.js', async () => {
  const actual = await vi.importActual('./_shared/infra/search-pipeline.js')
  return {
    ...actual,
    collectSearchResultsPage: vi.fn(),
  }
})

describe('doctor-dom-search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes startOrigin object to search pipeline in normal flow', async () => {
    const page = createPageMock([])
    const snapshotWorkflow = await import('./_shared/snapshot/workflow.js')
    const searchPipeline = await import('./_shared/infra/search-pipeline.js')
    const { doctorDomSearchCommand } = await import('./doctor-dom-search.js')

    searchPipeline.collectSearchResultsPage.mockResolvedValue({
      searchPath: '/s/Python?languages[]=chinese',
      searchUrl: 'https://z-lib.gl/s/Python?languages[]=chinese',
      results: [{ title: 'Book A' }],
    })

    snapshotWorkflow.runSnapshotWorkflow.mockImplementation(async function (options) {
      await options.capture(page, 'https://z-lib.gl/')
      return {
        rows: [
          { probe: 'search-navigation', status: 'pass', count: '', sampleValue: '', message: 'navigated' },
          { probe: 'search-results-count', status: 'pass', count: 1, sampleValue: 'Book A', message: '' },
        ],
        success: true,
        fixtureSaved: false,
      }
    })

    const rows = await doctorDomSearchCommand.func(page, { query: 'Python', 'save-fixture': false })

    expect(searchPipeline.collectSearchResultsPage).toHaveBeenCalledWith(
      page,
      { origin: 'https://z-lib.gl' },
      'Python',
      expect.objectContaining({
        limit: 100,
        contextName: 'zlibrary-app doctor-dom-search',
      })
    )
    expect(snapshotWorkflow.runSnapshotWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ saveFixture: false })
    )
    expect(rows).toEqual([
      { probe: 'search-navigation', status: 'pass', count: '', sampleValue: '', message: 'navigated' },
      { probe: 'search-results-count', status: 'pass', count: 1, sampleValue: 'Book A', message: '' },
    ])
  })

  it('keeps same origin shape when save-fixture enabled', async () => {
    const page = createPageMock([])
    const snapshotWorkflow = await import('./_shared/snapshot/workflow.js')
    const searchPipeline = await import('./_shared/infra/search-pipeline.js')
    const { doctorDomSearchCommand } = await import('./doctor-dom-search.js')

    searchPipeline.collectSearchResultsPage.mockResolvedValue({
      searchPath: '/s/Python',
      searchUrl: 'https://z-lib.gl/s/Python',
      results: [{ title: 'Book A' }],
    })

    snapshotWorkflow.runSnapshotWorkflow.mockImplementation(async function (options) {
      await options.capture(page, 'https://z-lib.gl/')
      return {
        rows: [],
        success: true,
        fixtureSaved: true,
      }
    })

    await doctorDomSearchCommand.func(page, { query: 'Python', 'save-fixture': true })

    expect(searchPipeline.collectSearchResultsPage).toHaveBeenCalledWith(
      page,
      { origin: 'https://z-lib.gl' },
      'Python',
      expect.objectContaining({
        limit: 100,
        contextName: 'zlibrary-app doctor-dom-search',
      })
    )
    expect(snapshotWorkflow.runSnapshotWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ saveFixture: true })
    )
  })
})
