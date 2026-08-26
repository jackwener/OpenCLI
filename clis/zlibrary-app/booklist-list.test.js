import { describe, expect, it } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { EmptyResultError } from '@jackwener/opencli/errors'
import { createBooklistListPage } from './_shared/test/booklist-test-utils.js'
import './booklist-list.js'

describe('zlibrary-app booklist-list', () => {
  it('returns list of booklists', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-list')
    const page = createBooklistListPage({
      booklists: [
        { id: 1, title: 'First', description: 'My first list', bookCount: 5, createdAt: '2024-01-01' },
        { id: 2, title: 'Second', description: '', bookCount: 3, createdAt: '2024-02-01' }
      ]
    })
    const result = await command.func(page, {})
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'First', books: 5, description: 'My first list' })
    expect(result[1]).toMatchObject({ name: 'Second', books: 3 })
  })

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-list')
    const page = createBooklistListPage({
      booklists: [{ id: 1, title: 'My List', description: '', bookCount: 5, createdAt: '2024-01-01' }]
    })
    const [row] = await command.func(page, {})
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })

  it('throws EmptyResultError when no booklists exist', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-list')
    const page = createBooklistListPage({ booklists: [] })
    await expect(
      command.func(page, {})
    ).rejects.toBeInstanceOf(EmptyResultError)
  })
})
