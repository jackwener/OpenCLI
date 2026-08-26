import { describe, expect, it } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'

import './booklist-download.js'

describe('zlibrary-app booklist-download', () => {
  it('exports a func command', () => {
    const command = getRegistry().get('zlibrary-app/booklist-download')
    expect(command.func).toBeDefined()
  })
})
