import { describe, expect, it } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import { createPageMock } from '../test-utils.js'
import { createBooklistCreatePage } from './_shared/test/booklist-test-utils.js'
import './booklist-create.js'

describe('zlibrary-app booklist-create', () => {
  it('creates a booklist with a valid name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [],
      createResult: { success: 1, readlist: { id: '10', title: 'My New List', description: '' } }
    })
    const result = await command.func(page, { name: 'My New List' })
    expect(result[0]).toMatchObject({ name: 'My New List', created: true })
    expect(result[0].id).toBe(10)
  })

  it('throws CommandExecutionError for duplicate name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [{ id: 1, title: 'Existing' }]
    })
    await expect(
      command.func(page, { name: 'Existing' })
    ).rejects.toBeInstanceOf(CommandExecutionError)
  })

  it('throws CommandExecutionError for duplicate name with --query (no partial state)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [{ id: 1, title: 'Existing' }]
    })
    await expect(
      command.func(page, { name: 'Existing', query: 'python' })
    ).rejects.toBeInstanceOf(CommandExecutionError)

    // Verify no create/search API call was made (no partial state)
    const scripts = page.evaluate.mock.calls.map(function (c) { return c[0] })
    const createCall = scripts.find(function (s) { return s.includes('/papi/booklist/create') })
    const searchCall = scripts.find(function (s) { return s.includes('/s/') || s.includes('submitSearch') })
    expect(createCall).toBeUndefined()
    expect(searchCall).toBeUndefined()
  })

  it('creates and populates with --query', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [],
      createResult: { success: 1, readlist: { id: '10', title: 'My List', description: '' } },
      hasQuery: true,
      searchResults: [
        { id: '100', title: 'Book A', author: 'Author A' },
        { id: '200', title: 'Book B', author: 'Author B' }
      ],
      addResponses: [
        { readlistBookId: 10 },
        { readlistBookId: 20 }
      ]
    })
    const result = await command.func(page, { name: 'My List', query: 'python' })
    expect(result[0]).toMatchObject({ name: 'My List', created: true, added: 2, skipped: 0, total: 2 })
  })

  it('returns per-book rows for --list add', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [],
      createResult: { success: 1, readlist: { id: '10', title: 'My List', description: '' } },
      hasQuery: true,
      searchResults: [
        { id: '100', title: 'Book A', author: 'Author A', year: '2020', language: 'English', size: '1 MB', extension: 'pdf', isbn: '123', url: 'https://z-lib.org/book/100' },
        { title: 'No ID Book', author: 'Author B', year: '2021', language: 'English', size: '2 MB', extension: 'epub', isbn: '456', url: 'https://z-lib.org/book/na' },
        { id: '200', title: 'Book B', author: 'Author C', year: '2022', language: 'Japanese', size: '3 MB', extension: 'epub', isbn: '789', url: 'https://z-lib.org/book/200' }
      ],
      addResponses: [
        { success: 1, book: { id: '10', readlist_id: 10, book_id: 100 } },
        { success: 1, book: { id: '20', readlist_id: 10, book_id: 200 } }
      ]
    })

    const result = await command.func(page, { name: 'My List', query: 'python', list: 'add' })
    expect(result).toHaveLength(3)
    expect(result.map(function (r) { return r.status })).toEqual(['added', 'added', '2 added / 1 skipped / 3 total'])
  })

  it('returns only skipped rows for --list skip', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [],
      createResult: { success: 1, readlist: { id: '10', title: 'My List', description: '' } },
      hasQuery: true,
      searchResults: [
        { title: 'No ID Book', author: 'Author A', url: 'https://z-lib.org/book/na' },
        { id: '200', title: 'API Fails Book', author: 'Author B', url: 'https://z-lib.org/book/200' },
        { id: '300', title: 'Added Book', author: 'Author C', url: 'https://z-lib.org/book/300' }
      ],
      addResponses: [
        { error: 'Server error' },
        { success: 1, book: { id: '30', readlist_id: 10, book_id: 300 } }
      ]
    })

    const result = await command.func(page, { name: 'My List', query: 'python', list: 'skip' })
    expect(result).toHaveLength(3)
    expect(result[0].status).toMatch(/^skipped \(empty ID\)$/)
    expect(result[1].status).toMatch(/^skipped \(API error: Server error\)$/)
    expect(result[2].status).toMatch(/\d+ added \/ 2 skipped \/ 3 total/)
  })

  it('creates and populates with --query and --filter-lang-codes', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [{ id: 0, title: 'Other' }], // have existing to resolve id=0≠existing name
      createResult: { success: 1, readlist: { id: '20', title: 'My Lang List', description: '' } },
      hasQuery: true,
      searchResults: [
        { id: '100', title: 'English Book', author: 'Author A', language: 'English' }
      ],
      addResponses: [
        { readlistBookId: 30 }
      ]
    })
    const result = await command.func(page, { name: 'My Lang List', query: 'python', 'filter-lang-codes': 'en' })
    expect(result[0]).toMatchObject({ name: 'My Lang List', created: true })
  })

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [],
      createResult: { success: 1, readlist: { id: '10', title: 'Test', description: '' } }
    })
    const [row] = await command.func(page, { name: 'Test' })
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })

  it('refuses empty name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    await expect(
      command.func(createPageMock([]), { name: '' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })

  it('throws CommandExecutionError when API returns error', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [],
      createResult: { error: 'API unavailable' }
    })
    await expect(
      command.func(page, { name: 'Failing List' })
    ).rejects.toBeInstanceOf(CommandExecutionError)
  })

  it('throws CommandExecutionError when API returns no ID', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [],
      createResult: { success: true }
    })
    await expect(
      command.func(page, { name: 'No ID List' })
    ).rejects.toBeInstanceOf(CommandExecutionError)
  })

  it('does NOT create booklist when --query has invalid filter (no partial state)', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-create')
    const page = createBooklistCreatePage({
      booklists: [],
      createResult: { success: 1, readlist: { id: '10', title: 'Test', description: '' } }
    })
    // Pass --query with an invalid filter-ext — validation should throw
    // BEFORE createBooklist is called
    await expect(
      command.func(page, { name: 'Test', query: 'python', 'filter-ext': 'exe' })
    ).rejects.toBeInstanceOf(ArgumentError)

    // Verify zero evaluate calls — validation threw before any CDP/API work
    expect(page.evaluate.mock.calls.length).toBe(0)
  })
})
