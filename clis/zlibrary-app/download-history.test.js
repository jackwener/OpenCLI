import { describe, expect, it, vi } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors'
import { createPageMock } from '../test-utils.js'
import { createDownloadsPage } from './_shared/test/test-utils-download.js'
import './download-history.js'

describe('zlibrary-app download-history', () => {
  it('returns parsed download history rows', async () => {
    const command = getRegistry().get('zlibrary-app/download-history')
    const page = createDownloadsPage([
      { rank: '1', title: 'Book One', url: 'https://z-lib.gl/book/1', date: '21.05.2026 17:27' },
      { rank: '2', title: 'Book Two', url: 'https://z-lib.gl/book/2', date: '20.05.2026 14:30' },
      { rank: '3', title: 'Book Three', url: 'https://z-lib.gl/book/3', date: '19.05.2026 09:15' }
    ])

    const result = await command.func(page, {})

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ rank: '1', title: 'Book One', date: '21.05.2026 17:27' })
    expect(result[1]).toMatchObject({ rank: '2', title: 'Book Two' })
    expect(result[2]).toMatchObject({ rank: '3', title: 'Book Three' })
  })

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/download-history')
    const page = createDownloadsPage([
      { rank: '1', title: 'Test', url: 'https://z-lib.gl/book/1', date: '21.05.2026' }
    ])
    const [row] = await command.func(page, {})
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })

  it('all result urls are absolute HTTP(S) URLs', async () => {
    const command = getRegistry().get('zlibrary-app/download-history')
    const page = createDownloadsPage([
      { rank: '1', title: 'First', url: 'https://z-lib.gl/book/1', date: '21.05.2026' },
      { rank: '2', title: 'Second', url: 'https://z-lib.gl/book/2', date: '20.05.2026' }
    ])
    const results = await command.func(page, {})
    for (const row of results) {
      expect(row.url).toMatch(/^https?:\/\//)
    }
  })

  it('throws EmptyResultError when no download history found', async () => {
    const command = getRegistry().get('zlibrary-app/download-history')
    const page = createDownloadsPage([])

    await expect(
      command.func(page, {})
    ).rejects.toBeInstanceOf(EmptyResultError)
  })

  it('CLI arg --limit has default 20', () => {
    const cmd = getRegistry().get('zlibrary-app/download-history')
    const limitArg = cmd.args.find(a => a.name === 'limit')
    expect(limitArg).toBeDefined()
    expect(limitArg.default).toBe(20)
  })

  it('--page 2 navigates to the correct page', async () => {
    const command = getRegistry().get('zlibrary-app/download-history')
    const page = createDownloadsPage([
      { rank: '1', title: 'Page 2 Book', url: 'https://z-lib.gl/book/42', date: '21.05.2026' }
    ])

    await command.func(page, { page: 2 })
    expect(page.goto.mock.calls[0][0]).toContain('page=2')
  })

  it('rejects --limit below 1', async () => {
    const command = getRegistry().get('zlibrary-app/download-history')
    const page = createPageMock([])
    await expect(
      command.func(page, { limit: 0 })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('rejects --limit above 50', async () => {
    const command = getRegistry().get('zlibrary-app/download-history')
    const page = createPageMock([])
    await expect(
      command.func(page, { limit: 999 })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('rejects --page below 1', async () => {
    const command = getRegistry().get('zlibrary-app/download-history')
    const page = createPageMock([])
    await expect(
      command.func(page, { page: 0 })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('throws CommandExecutionError on unexpected DOM error', async () => {
    const command = getRegistry().get('zlibrary-app/download-history')
    const page = createPageMock([], {
      evaluate: vi.fn().mockRejectedValue(new Error('DOM access denied'))
    })

    await expect(
      command.func(page, {})
    ).rejects.toBeInstanceOf(CommandExecutionError)
  })
})
