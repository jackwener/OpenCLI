import { describe, expect, it } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import { createPageMock } from '../test-utils.js'
import { createBooklistDeletePage } from './_shared/test/booklist-test-utils.js'
import './booklist-delete.js'

describe('zlibrary-app booklist-delete', () => {
  it('deletes a booklist with --force', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-delete')
    const page = createBooklistDeletePage({
      booklists: [{ id: 1, title: 'Delete Me', bookCount: 0 }],
      deleteResult: { success: true }
    })
    const result = await command.func(page, { name: 'Delete Me', force: true })
    expect(result[0]).toMatchObject({ name: 'Delete Me', deleted: true })
  })

  it('returns not deleted without --force', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-delete')
    const page = createPageMock([])
    const result = await command.func(page, { name: 'Safe List' })
    expect(result[0]).toMatchObject({ deleted: false, reason: 'Use --force to confirm deletion' })
  })

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-delete')
    const page = createBooklistDeletePage({
      booklists: [{ id: 1, title: 'Test Del' }],
      deleteResult: { success: true }
    })
    const [row] = await command.func(page, { name: 'Test Del', force: true })
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })

  it('throws CommandExecutionError when delete API returns transport error', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-delete')
    const page = createBooklistDeletePage({
      booklists: [{ id: 1, title: 'Fail Delete' }],
      deleteResult: { error: 'HTTP 503: Service Unavailable' }
    })
    await expect(
      command.func(page, { name: 'Fail Delete', force: true })
    ).rejects.toBeInstanceOf(CommandExecutionError)
  })

  it('returns idempotent no-op row when API returns { success: false } without error', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-delete')
    const page = createBooklistDeletePage({
      booklists: [{ id: 1, title: 'Already Deleted' }],
      deleteResult: { success: false }
    })
    const result = await command.func(page, { name: 'Already Deleted', force: true })
    expect(result[0]).toMatchObject({
      name: 'Already Deleted',
      deleted: false,
      reason: 'already_deleted'
    })
  })

  it('refuses empty name', async () => {
    const command = getRegistry().get('zlibrary-app/booklist-delete')
    await expect(
      command.func(createPageMock([]), { name: '' })
    ).rejects.toBeInstanceOf(ArgumentError)
  })
})
