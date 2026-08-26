import { describe, expect, it } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { createPageMock } from '../test-utils.js'
import './status.js'

describe('zlibrary-app status', () => {
  it('returns connection details from the Electron renderer', async () => {
    const command = getRegistry().get('zlibrary-app/status')
    const page = createPageMock([
      'https://zlibrary.local/main',
      'Z-Library — Search',
      'v2.1.2'
    ])

    const result = await command.func(page, {})

    expect(result).toEqual([{
      Status: 'Connected',
      Url: 'https://zlibrary.local/main',
      Title: 'Z-Library — Search',
      Version: 'v2.1.2'
    }])
  })

  it('sanitizes non-http URLs by default (e.g. electron://)', async () => {
    const command = getRegistry().get('zlibrary-app/status')
    const page = createPageMock([
      'electron://zlibrary-desktop/home',
      'Z-Library Desktop',
      'v3.0.0'
    ])

    const result = await command.func(page, {})

    expect(result[0].Url).toBe('(non-http)')
    expect(result[0].Status).toBe('Connected')
  })

  it('shows raw non-http URL when --url flag is provided', async () => {
    const command = getRegistry().get('zlibrary-app/status')
    const page = createPageMock([
      'electron://zlibrary-desktop/home',
      'Z-Library Desktop',
      'v3.0.0'
    ])

    const result = await command.func(page, { url: true })

    expect(result[0].Url).toBe('electron://zlibrary-desktop/home')
  })

  it('handles empty URL gracefully', async () => {
    const command = getRegistry().get('zlibrary-app/status')
    const page = createPageMock([
      '',
      'Z-Library Desktop',
      ''
    ])

    const result = await command.func(page, {})

    expect(result[0].Url).toBe('(empty)')
  })

  it('declared columns match returned object keys', async () => {
    const command = getRegistry().get('zlibrary-app/status')
    const page = createPageMock([
      'https://z-lib.gl',
      'Z-Library',
      'v2.0'
    ])
    const [row] = await command.func(page, {})
    const returnedKeys = Object.keys(row).sort()
    const declaredColumns = [...command.columns].sort()
    expect(returnedKeys).toEqual(declaredColumns)
  })
})
